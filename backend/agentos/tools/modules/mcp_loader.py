import glob
import os
from mcp import ClientSession
from mcp.client.stdio import StdioServerParameters, stdio_client
from ..core import _REGISTERED_TOOLS, Tool

def _create_mcp_wrapper(executable_path: str, tool_name: str, server_name: str) -> None:
    """Factory to create an async wrapper for a dynamically discovered FastMCP script."""
    
    async def _fetch(args: dict, ctx: dict) -> dict:
        server_params = StdioServerParameters(
            command="./venv/bin/python",
            args=[executable_path]
        )
        try:
            async with stdio_client(server_params) as (read, write):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    res = await session.call_tool(tool_name, arguments=args or {})
                    
                    if res.isError:
                        return {"status": "error", "error": str(res.content)}
                    
                    text_out = " ".join([c.text for c in res.content if hasattr(c, "text")])
                    return {"status": "ok", "output": text_out}
        except Exception as e:
            return {"status": "error", "error": f"MCP Session Error: {str(e)}"}

    # Register it into the global core pool dynamically
    _REGISTERED_TOOLS.append(Tool(
        name=f"{server_name}_{tool_name}_mcp",
        description=f"Auto-loaded MCP tool '{tool_name}' from {server_name}",
        args_schema={"__dynamic__": "This tool is dynamically loaded. Send args per standard parameters."},
        fn=_fetch,
        profiles=["full"]
    ))

# Auto-execute on module import!
_MCP_DIR = "agentos/mcp_servers"
if os.path.isdir(_MCP_DIR):
    for f in glob.glob(f"{_MCP_DIR}/*.py"):
        basename = os.path.basename(f).replace(".py", "")
        if basename == "__init__":
            continue
            
        # Hardcoding the tools we specifically expect for safety in this POC:
        # In a fully productionized version, we could do `await session.list_tools()` 
        # asynchronously inside `build_components` via an async startup hook.
        # But since AgentOS tools are built synchronously, we statically map the ones we deploy.
        if basename == "hn_server":
            _create_mcp_wrapper(f, "get_top_hn_articles", basename)
