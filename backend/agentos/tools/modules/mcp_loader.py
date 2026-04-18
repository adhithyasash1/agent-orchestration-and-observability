from __future__ import annotations

import asyncio
import concurrent.futures
import logging
import os
import re
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Literal
from urllib.parse import urlparse

import httpx

try:
    from mcp import ClientSession
    from mcp.client.stdio import StdioServerParameters, stdio_client
    from mcp.client.streamable_http import streamable_http_client

    _MCP_AVAILABLE = True
except ImportError:
    _MCP_AVAILABLE = False

from ..core import Tool
from .workspace import WORKSPACE_DIR, relativize_workspace_path

logger = logging.getLogger("agentos.mcp")

Transport = Literal["stdio", "streamable_http"]

_PATH_ARG_NAMES = {
    "path",
    "paths",
    "file",
    "files",
    "filepath",
    "file_path",
    "source",
    "source_file",
    "source_path",
    "target",
    "target_file",
    "target_path",
    "output_file",
    "output_path",
}


@dataclass(frozen=True)
class MCPServerSpec:
    key: str
    command: str
    args: tuple[str, ...] = field(default_factory=tuple)
    transport: Transport = "stdio"
    requires_internet: bool = False
    enabled_flag: str = ""
    profiles: tuple[str, ...] = ("full",)
    env: dict[str, str] = field(default_factory=dict)
    cwd: str | None = None
    timeout: float = 30.0
    tool_allowlist: tuple[str, ...] | None = None
    workspace_root: str | None = None
    healthcheck: str | None = None
    url: str | None = None


@dataclass(frozen=True)
class MCPDiscoveredTool:
    local_name: str
    remote_name: str
    description: str
    args_schema: dict[str, Any]
    requires_internet: bool
    timeout: float | None


class MCPBridge:
    """Create short-lived MCP sessions to discover or invoke remote tools."""

    def __init__(self, spec: MCPServerSpec):
        self.spec = spec

    async def list_tools(self) -> list[MCPDiscoveredTool]:
        if not _MCP_AVAILABLE:
            return []

        async with self._session() as session:
            response = await asyncio.wait_for(session.list_tools(), timeout=self.spec.timeout)

        remote_tools = list(getattr(response, "tools", []) or [])
        allowed = set(self.spec.tool_allowlist or [])
        visible_tools = [
            tool_obj
            for tool_obj in remote_tools
            if not allowed or getattr(tool_obj, "name", "") in allowed
        ]
        total_tools = len(visible_tools)
        discovered: list[MCPDiscoveredTool] = []
        used_names: set[str] = set()
        for tool_obj in visible_tools:
            local_name = _build_local_tool_name(
                spec=self.spec,
                remote_name=getattr(tool_obj, "name", "tool"),
                total_tools=total_tools,
                used_names=used_names,
            )
            description = (getattr(tool_obj, "description", None) or "").strip()
            if self.spec.workspace_root:
                description = (
                    f"{description} File paths must stay inside the workspace sandbox and be relative to "
                    f"`data/workspace`."
                ).strip()
            discovered.append(
                MCPDiscoveredTool(
                    local_name=local_name,
                    remote_name=getattr(tool_obj, "name", "tool"),
                    description=description or f"MCP tool `{getattr(tool_obj, 'name', 'tool')}`.",
                    args_schema=_coerce_schema(getattr(tool_obj, "inputSchema", None)),
                    requires_internet=self.spec.requires_internet,
                    timeout=self.spec.timeout,
                )
            )
        return discovered

    async def call_tool(self, tool_name: str, arguments: dict[str, Any] | None = None) -> dict[str, Any]:
        if not _MCP_AVAILABLE:
            return {"status": "error", "error": "mcp package not installed"}

        try:
            normalized_args = _normalize_workspace_arguments(arguments or {}, self.spec.workspace_root)
        except ValueError as exc:
            return {"status": "error", "error": str(exc)}

        try:
            async with self._session() as session:
                result = await asyncio.wait_for(
                    session.call_tool(tool_name, arguments=normalized_args),
                    timeout=self.spec.timeout,
                )
        except Exception as exc:
            logger.error(
                "Failed to execute MCP tool %s on %s: %s",
                tool_name,
                self.spec.key,
                exc,
            )
            return {"status": "error", "error": f"MCP Connect Failure: {exc}"}

        if getattr(result, "isError", False):
            return {"status": "error", "error": _summarize_mcp_content(result)}

        output: Any = None
        structured = getattr(result, "structuredContent", None)
        text = _summarize_mcp_content(result)
        if structured is not None and text:
            output = {"structured": structured, "text": text}
        elif structured is not None:
            output = structured
        else:
            output = text or "Success (no text output)"
        return {"status": "ok", "output": output}

    @asynccontextmanager
    async def _session(self) -> AsyncIterator[Any]:
        if self.spec.transport == "stdio":
            async with self._stdio_session() as session:
                yield session
            return

        async with self._streamable_http_session() as session:
            yield session

    @asynccontextmanager
    async def _stdio_session(self) -> AsyncIterator[Any]:
        server_params = StdioServerParameters(
            command=self.spec.command,
            args=list(self.spec.args),
            env={**os.environ, **self.spec.env},
            cwd=self.spec.cwd,
        )
        async with stdio_client(server_params) as (read, write):
            async with ClientSession(read, write) as session:
                await asyncio.wait_for(session.initialize(), timeout=self.spec.timeout)
                yield session

    @asynccontextmanager
    async def _streamable_http_session(self) -> AsyncIterator[Any]:
        if not self.spec.url:
            raise RuntimeError(f"MCP server '{self.spec.key}' is missing a streamable HTTP URL")

        process = await asyncio.create_subprocess_exec(
            self.spec.command,
            *self.spec.args,
            cwd=self.spec.cwd,
            env={**os.environ, **self.spec.env},
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        try:
            await self._wait_for_http_ready(process)
            async with streamable_http_client(self.spec.url) as (read, write, _):
                async with ClientSession(read, write) as session:
                    await asyncio.wait_for(session.initialize(), timeout=self.spec.timeout)
                    yield session
        finally:
            if process.returncode is None:
                process.terminate()
                try:
                    await asyncio.wait_for(process.wait(), timeout=3)
                except asyncio.TimeoutError:
                    process.kill()
                    await process.wait()

    async def _wait_for_http_ready(self, process: asyncio.subprocess.Process) -> None:
        if self.spec.healthcheck:
            deadline = asyncio.get_running_loop().time() + self.spec.timeout
            async with httpx.AsyncClient(timeout=1.0) as client:
                while asyncio.get_running_loop().time() < deadline:
                    if process.returncode is not None:
                        raise RuntimeError(
                            f"MCP server '{self.spec.key}' exited before it became ready"
                        )
                    try:
                        response = await client.get(self.spec.healthcheck)
                        if response.status_code < 500:
                            return
                    except Exception:
                        pass
                    await asyncio.sleep(0.2)
            raise TimeoutError(f"Timed out waiting for MCP server '{self.spec.key}' healthcheck")

        parsed = urlparse(self.spec.url or "")
        if not parsed.hostname or not parsed.port:
            await asyncio.sleep(0.5)
            return

        deadline = asyncio.get_running_loop().time() + self.spec.timeout
        while asyncio.get_running_loop().time() < deadline:
            if process.returncode is not None:
                raise RuntimeError(f"MCP server '{self.spec.key}' exited before it opened its port")
            try:
                reader, writer = await asyncio.open_connection(parsed.hostname, parsed.port)
                writer.close()
                await writer.wait_closed()
                return
            except Exception:
                await asyncio.sleep(0.2)
        raise TimeoutError(f"Timed out waiting for MCP server '{self.spec.key}' on {parsed.netloc}")


def build_mcp_server_specs(settings: Any) -> dict[str, dict[str, MCPServerSpec]]:
    workspace_root = str(WORKSPACE_DIR)
    process_cwd = str(WORKSPACE_DIR.parent.parent)

    return {
        "local_mcp": {
            "sequential_thinking": MCPServerSpec(
                key="sequential_thinking",
                command="npx",
                args=("-y", "@modelcontextprotocol/server-sequential-thinking"),
                enabled_flag="enable_sequential_thinking_mcp",
                requires_internet=False,
                cwd=process_cwd,
            ),
            "excel": MCPServerSpec(
                key="excel",
                command="uvx",
                args=("excel-mcp-server", "streamable-http"),
                transport="streamable_http",
                enabled_flag="enable_excel_mcp",
                env={
                    "EXCEL_FILES_PATH": "data/workspace",
                    "FASTMCP_PORT": "8017",
                },
                cwd=process_cwd,
                timeout=45.0,
                workspace_root=workspace_root,
                url="http://127.0.0.1:8017/mcp",
                healthcheck="http://127.0.0.1:8017/mcp",
            ),
            "markdownify": MCPServerSpec(
                key="markdownify",
                command="npx",
                args=("-y", "mcp-markdownify-server"),
                enabled_flag="enable_markdownify_mcp",
                env={"MD_SHARE_DIR": "data/workspace"},
                cwd=process_cwd,
                timeout=60.0,
                tool_allowlist=(
                    "pdf-to-markdown",
                    "image-to-markdown",
                    "audio-to-markdown",
                    "docx-to-markdown",
                    "xlsx-to-markdown",
                    "pptx-to-markdown",
                    "get-markdown-file",
                ),
                workspace_root=workspace_root,
            ),
        },
        "internet_mcp": {
            "playwright": MCPServerSpec(
                key="playwright",
                command="npx",
                args=("-y", "@playwright/mcp@latest"),
                enabled_flag="enable_playwright_mcp",
                requires_internet=True,
                cwd=process_cwd,
                timeout=60.0,
            ),
        },
    }


def load_mcp_tools(settings: Any) -> list[Tool]:
    if not _MCP_AVAILABLE:
        logger.info("MCP client libraries not found. Skipping MCP tool discovery.")
        return []

    enabled_specs = _enabled_mcp_specs(settings)
    if not enabled_specs:
        return []

    timeout = max(5.0, sum(spec.timeout for spec in enabled_specs))
    try:
        discovered = _run_async_blocking(_discover_mcp_tools(enabled_specs), timeout=timeout)
    except Exception as exc:
        logger.warning("MCP tool discovery failed: %s", exc)
        return []

    tools: list[Tool] = []
    for spec, discovered_tools in discovered:
        bridge = MCPBridge(spec)
        for remote_tool in discovered_tools:
            tools.append(
                _build_wrapped_mcp_tool(
                    bridge=bridge,
                    spec=spec,
                    discovered_tool=remote_tool,
                )
            )
    return tools


def _enabled_mcp_specs(settings: Any) -> list[MCPServerSpec]:
    if not getattr(settings, "enable_mcp_plugins", False):
        return []

    groups = build_mcp_server_specs(settings)
    enabled: list[MCPServerSpec] = []
    for group_name, specs in groups.items():
        for spec in specs.values():
            if not _profile_allows_spec(settings, spec):
                continue
            if spec.requires_internet:
                if getattr(settings, "force_local_only", False):
                    continue
                if not getattr(settings, "allow_internet_mcp", False):
                    continue
            if spec.enabled_flag and not getattr(settings, spec.enabled_flag, False):
                continue
            if group_name == "internet_mcp" and not getattr(settings, "allow_internet_mcp", False):
                continue
            enabled.append(spec)
    return enabled


def _profile_allows_spec(settings: Any, spec: MCPServerSpec) -> bool:
    return settings.profile in spec.profiles or "full" in spec.profiles


def _run_async_blocking(coro: Any, *, timeout: float) -> Any:
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(asyncio.run, coro)
        return future.result(timeout=timeout)


async def _discover_mcp_tools(
    specs: list[MCPServerSpec],
) -> list[tuple[MCPServerSpec, list[MCPDiscoveredTool]]]:
    discovered: list[tuple[MCPServerSpec, list[MCPDiscoveredTool]]] = []
    for spec in specs:
        try:
            tools = await MCPBridge(spec).list_tools()
        except Exception as exc:
            logger.warning("Skipping MCP server '%s': %s", spec.key, exc)
            continue
        discovered.append((spec, tools))
    return discovered


def _build_wrapped_mcp_tool(
    bridge: MCPBridge,
    spec: MCPServerSpec,
    discovered_tool: MCPDiscoveredTool,
) -> Tool:
    async def _mcp_fn(args: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
        return await bridge.call_tool(discovered_tool.remote_name, args)

    return Tool(
        name=discovered_tool.local_name,
        description=discovered_tool.description,
        args_schema=discovered_tool.args_schema,
        fn=_mcp_fn,
        profiles=list(spec.profiles),
        requires_internet=spec.requires_internet,
        timeout=discovered_tool.timeout,
    )


def _build_local_tool_name(
    spec: MCPServerSpec,
    remote_name: str,
    total_tools: int,
    used_names: set[str],
) -> str:
    normalized_remote = _normalize_tool_name(remote_name)
    normalized_spec = _normalize_tool_name(spec.key)
    if total_tools == 1 and normalized_remote in {normalized_spec, "sequentialthinking"}:
        base_name = f"mcp_{normalized_spec}"
    else:
        base_name = f"mcp_{normalized_spec}_{normalized_remote}"

    candidate = base_name
    suffix = 2
    while candidate in used_names:
        candidate = f"{base_name}_{suffix}"
        suffix += 1
    used_names.add(candidate)
    return candidate


def _normalize_tool_name(value: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9]+", "_", value).strip("_").lower()
    return normalized or "tool"


def _coerce_schema(schema: Any) -> dict[str, Any]:
    if isinstance(schema, dict):
        return schema
    if hasattr(schema, "model_dump"):
        return schema.model_dump()
    return {"type": "object", "additionalProperties": True}


def _summarize_mcp_content(result: Any) -> str:
    parts: list[str] = []
    for content in getattr(result, "content", []) or []:
        text = getattr(content, "text", None)
        if text:
            parts.append(text)
    return "\n".join(parts).strip()


def _normalize_workspace_arguments(
    arguments: dict[str, Any],
    workspace_root: str | None,
) -> dict[str, Any]:
    if not workspace_root:
        return arguments
    return {
        key: _normalize_workspace_value(key, value)
        for key, value in arguments.items()
    }


def _normalize_workspace_value(key: str, value: Any) -> Any:
    if isinstance(value, dict):
        return {child_key: _normalize_workspace_value(child_key, child_value) for child_key, child_value in value.items()}
    if isinstance(value, list):
        return [_normalize_workspace_value(key, item) for item in value]
    if isinstance(value, str) and _looks_like_path_argument(key) and not value.startswith(("http://", "https://")):
        relative_path = relativize_workspace_path(value)
        if relative_path is None:
            raise ValueError(f"Workspace path is outside the sandbox: {value}")
        return relative_path
    return value


def _looks_like_path_argument(key: str) -> bool:
    lowered = key.lower()
    return (
        lowered in _PATH_ARG_NAMES
        or lowered.endswith("_path")
        or lowered.endswith("path")
        or lowered.endswith("_file")
        or lowered.endswith("file")
    )
