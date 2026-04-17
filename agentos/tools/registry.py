"""Tool registry.

Dynamically mounts tools tagged with `@tool`, handles contextual filtering based
on profiles, and implements Circuit Breaker fallback logic.
"""
from __future__ import annotations

import importlib
import inspect
import pkgutil
import time
from collections import defaultdict
from typing import Any

from .core import Tool, _REGISTERED_TOOLS


class ToolRegistry:
    def __init__(self, profile: str):
        self.profile = profile
        self._tools: dict[str, Tool] = {}
        
        # Circuit Breaker state
        self._failures: dict[str, int] = defaultdict(int)
        self._disabled_until: dict[str, float] = {}

    def register(self, tool: Tool) -> None:
        self._tools[tool.name] = tool

    def list(self) -> list[Tool]:
        return list(self._tools.values())

    def names(self) -> list[str]:
        return list(self._tools.keys())

    def describe(self) -> str:
        if not self._tools:
            return ""
        out = []
        for t in self._tools.values():
            args = ", ".join(f"{k}: {v}" for k, v in t.args_schema.items()) or "(no args)"
            out.append(f"- {t.name}({args}) — {t.description}")
        return "\n".join(out)

    async def call(self, name: str, args: dict, context: dict | None = None) -> dict:
        tool = self._tools.get(name)
        if not tool:
            return {"status": "error", "output": None,
                    "error": f"unknown tool: {name}"}
                    
        # Circuit Breaker Check
        if name in self._disabled_until:
            if time.time() < self._disabled_until[name]:
                return {
                    "status": "error",
                    "output": None,
                    "error": f"Circuit breaker tripped. Tool '{name}' is temporarily disabled due to overwhelming errors."
                }
            else:
                del self._disabled_until[name]
                self._failures[name] = 0

        # Execute Tool
        result = await tool.fn(args or {}, context or {})
        
        # Adjust Circuit Breaker
        if result.get("status") == "error":
            self._failures[name] += 1
            if self._failures[name] >= 3:
                self._disabled_until[name] = time.time() + 300  # 5 minutes
        else:
            self._failures[name] = 0

        return result


def build_default_registry(settings) -> ToolRegistry:
    """Assemble the registry dynamically based on profiles and feature flags."""
    reg = ToolRegistry(profile=settings.profile)
    
    if not settings.enable_tools:
        return reg

    # Core Auto-Discovery
    _REGISTERED_TOOLS.clear()
    
    import agentos.tools.modules as modules_pkg
    
    # 1. Discover all modules in `agentos/tools/modules`
    for _, module_name, _ in pkgutil.iter_modules(modules_pkg.__path__):
        try:
            importlib.import_module(f"agentos.tools.modules.{module_name}")
        except Exception as e:
            print(f"Warning: Failed to load module {module_name}: {e}")
            
    # 2. Register tools that match current profile
    for t in _REGISTERED_TOOLS:
        if settings.profile in t.profiles or "full" in t.profiles:
            # Special toggle switches overriding profiles
            if t.name == "http_fetch" and not settings.enable_http_fetch:
                continue
            if t.name == "tavily_search" and not (settings.enable_tavily and settings.tavily_api_key):
                continue
            
            # Note: MCP Plugins are hot-loaded by mcp_loader.py, but they add to _REGISTERED_TOOLS.
            # So if `enable_mcp_plugins` is false, we should block any tools from mcp_loader.
            # But the loader itself handles that internally or we filter here:
            if t.name.endswith("_mcp") and not getattr(settings, "enable_mcp_plugins", False):
                continue

            reg.register(t)

    return reg
