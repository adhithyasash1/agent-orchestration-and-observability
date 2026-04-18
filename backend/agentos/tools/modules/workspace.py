import base64
import mimetypes
from pathlib import Path

import httpx

from ..core import tool

# Ensure sandbox exists
WORKSPACE_DIR = Path("data/workspace").resolve()
WORKSPACE_DIR.mkdir(parents=True, exist_ok=True)
MAX_READ_BYTES = 1024 * 1024

def _is_within_workspace(path: Path) -> bool:
    try:
        path.relative_to(WORKSPACE_DIR)
        return True
    except ValueError:
        return False


def _resolve_safe_path(requested_path: str) -> Path | None:
    """Resolve and validate a path to ensure it stays within the workspace sandbox."""
    try:
        target = (WORKSPACE_DIR / requested_path).resolve()
        if not _is_within_workspace(target):
            return None
        return target
    except Exception:
        return None


def resolve_workspace_path(requested_path: str) -> Path | None:
    """Public helper for other modules that need sandboxed workspace paths."""
    return _resolve_safe_path(requested_path)


def relativize_workspace_path(requested_path: str | Path) -> str | None:
    """Return a workspace-relative path if the target stays inside the sandbox."""
    try:
        candidate = Path(requested_path)
        target = candidate if candidate.is_absolute() else (WORKSPACE_DIR / candidate)
        resolved = target.resolve()
        if not _is_within_workspace(resolved):
            return None
        return str(resolved.relative_to(WORKSPACE_DIR))
    except Exception:
        return None


@tool(
    name="read_file",
    description="Read the contents of a file within the workspace sandbox.",
    args_schema={
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "Relative path to file (e.g. 'notes.txt')"}
        },
        "required": ["path"]
    },
    profiles=["full"],
    timeout=20,
)
async def _read_file(args: dict, ctx: dict) -> dict:
    path_str = (args or {}).get("path", "")
    if not path_str:
        return {"status": "error", "error": "path is required"}
        
    target = _resolve_safe_path(path_str)
    if not target or not target.exists() or not target.is_file():
        return {"status": "error", "error": f"File not found or access denied: {path_str}"}
        
    try:
        if target.stat().st_size > MAX_READ_BYTES:
            return {
                "status": "error",
                "error": f"File too large to read safely (max {MAX_READ_BYTES} bytes): {path_str}",
            }
        content = target.read_text(encoding="utf-8")
        return {"status": "ok", "output": content}
    except Exception as e:
        return {"status": "error", "error": str(e)}

@tool(
    name="write_file",
    description="Write contents to a file within the workspace sandbox.",
    args_schema={
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "Relative path to file"},
            "content": {"type": "string", "description": "Text content to write"}
        },
        "required": ["path", "content"]
    },
    profiles=["full"],
    timeout=20,
)
async def _write_file(args: dict, ctx: dict) -> dict:
    path_str = (args or {}).get("path", "")
    content = (args or {}).get("content", "")
    
    if not path_str:
        return {"status": "error", "error": "path is required"}
        
    target = _resolve_safe_path(path_str)
    if not target:
        return {"status": "error", "error": f"Access denied. Path escapes workspace sandbox: {path_str}"}
        
    try:
        # Create parent directories inside sandbox if needed
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        return {"status": "ok", "output": f"Successfully wrote to {path_str}"}
    except Exception as e:
        return {"status": "error", "error": str(e)}


@tool(
    name="describe_image",
    description="Describe an uploaded image in the workspace using the configured vision-capable Ollama model.",
    args_schema={
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "Relative path to image file in the workspace"},
            "prompt": {"type": "string", "description": "Optional analysis prompt for the image"},
        },
        "required": ["path"],
        "additionalProperties": False,
    },
    profiles=["full"],
    timeout=120,
    retry_budget=1,
)
async def _describe_image(args: dict, ctx: dict) -> dict:
    path_str = (args or {}).get("path", "")
    prompt = ((args or {}).get("prompt") or "Describe the image in detail.").strip()
    cfg = (ctx or {}).get("config")
    if not path_str:
        return {"status": "error", "error": "path is required"}
    if cfg is None:
        return {"status": "error", "error": "tool config missing"}

    target = _resolve_safe_path(path_str)
    if not target or not target.exists() or not target.is_file():
        return {"status": "error", "error": f"File not found or access denied: {path_str}"}

    media_type, _ = mimetypes.guess_type(target.name)
    if not media_type or not media_type.startswith("image/"):
        return {"status": "error", "error": f"Unsupported image type: {target.suffix}"}

    image_b64 = base64.b64encode(target.read_bytes()).decode("utf-8")
    payload = {
        "model": getattr(cfg, "vision_model", "llava"),
        "messages": [
            {
                "role": "user",
                "content": prompt,
                "images": [image_b64],
            }
        ],
        "stream": False,
    }

    headers: dict[str, str] = {}
    api_key = getattr(cfg, "ollama_api_key", "")
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    try:
        async with httpx.AsyncClient(timeout=float(getattr(cfg, "vision_timeout_seconds", 120.0))) as client:
            response = await client.post(
                f"{cfg.ollama_base_url.rstrip('/')}/api/chat",
                json=payload,
                headers=headers,
            )
            response.raise_for_status()
            data = response.json()
    except Exception as exc:
        return {"status": "error", "error": str(exc)}

    output = ((data.get("message") or {}).get("content") or "").strip()
    if not output:
        return {"status": "error", "error": "vision model returned an empty response"}
    return {"status": "ok", "output": output}
