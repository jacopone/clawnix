"""ClawNix MCP server for web search and page reading."""

import httpx
from bs4 import BeautifulSoup
from ddgs import DDGS
from fastmcp import FastMCP

mcp = FastMCP(
    name="clawnix-mcp-browser",
    instructions="Search the web and read web pages. Returns plain text content.",
)

HEADERS = {
    "User-Agent": "ClawNix/0.2.0 (personal AI assistant)",
}


@mcp.tool
def search_web(query: str, max_results: int = 10) -> str:
    """Search the web using DuckDuckGo. Returns titles, URLs, and snippets."""
    max_results = min(max_results, 50)
    try:
        results = DDGS().text(query, max_results=max_results)
    except Exception as e:
        return f"Error searching: {e}"

    if not results:
        return "No results found."

    lines = []
    for r in results:
        lines.append(f"**{r.get('title', 'Untitled')}**")
        lines.append(f"  URL: {r.get('href', 'N/A')}")
        lines.append(f"  {r.get('body', '')}")
        lines.append("")
    return "\n".join(lines)


@mcp.tool
def read_page(url: str) -> str:
    """Fetch a web page and extract its main text content."""
    if not url.startswith(("http://", "https://")):
        return "Error: only http and https URLs are supported."
    try:
        response = httpx.get(url, headers=HEADERS, timeout=30, follow_redirects=True)
        response.raise_for_status()
    except Exception as e:
        return f"Error fetching {url}: {e}"

    soup = BeautifulSoup(response.text, "html.parser")

    # Remove non-content elements
    for tag in soup(["script", "style", "nav", "footer", "header", "aside"]):
        tag.decompose()

    # Prefer article/main content
    main = soup.find("article") or soup.find("main") or soup.find("body")
    if not main:
        return "Could not extract content from page."

    text = main.get_text(separator="\n", strip=True)
    # Limit to ~10k chars to avoid overwhelming the agent
    if len(text) > 10000:
        text = text[:10000] + "\n\n[Content truncated at 10,000 characters]"

    return text


def main():
    mcp.run()


if __name__ == "__main__":
    main()
