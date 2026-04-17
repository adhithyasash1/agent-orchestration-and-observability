"""
FastMCP Server for Hacker News.
Queries the Algolia JSON API to avoid HTML parsing issues.
"""
import httpx
from fastmcp import FastMCP

mcp = FastMCP("HackerNews")

@mcp.tool()
async def get_top_hn_articles(limit: int = 10) -> str:
    """Fetch the top Hacker News articles currently on the front page. Returns clear, structured text."""
    url = "https://hn.algolia.com/api/v1/search?tags=front_page"
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(url)
        r.raise_for_status()
        data = r.json()

    articles = data.get("hits", [])[:limit]
    
    # We return a formatted string because MCP transports text gracefully to the LLM context.
    output = []
    for i, a in enumerate(articles, 1):
        title = a.get("title", "No Title")
        url = a.get("url", "No URL")
        points = a.get("points", 0)
        comments = a.get("num_comments", 0)
        output.append(f"{i}. {title}")
        output.append(f"   URL: {url}")
        output.append(f"   Score: {points} points | Comments: {comments}")
        output.append("")
        
    if not output:
        return "No articles found."
        
    return "\n".join(output)

if __name__ == "__main__":
    mcp.run()
