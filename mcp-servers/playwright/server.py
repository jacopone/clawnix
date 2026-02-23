"""ClawNix MCP server for headless browser automation via Playwright."""

import base64
from playwright.sync_api import sync_playwright, Page, Browser

from fastmcp import FastMCP

mcp = FastMCP(
    name="clawnix-mcp-playwright",
    instructions="Headless browser automation. Navigate pages, fill forms, click elements, take screenshots.",
)

_browser: Browser | None = None
_page: Page | None = None


def _get_page() -> Page:
    global _browser, _page
    if _page is None:
        pw = sync_playwright().start()
        _browser = pw.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage"],
        )
        context = _browser.new_context(
            user_agent="ClawNix/0.2.0 (headless browser automation)",
        )
        _page = context.new_page()
    return _page


@mcp.tool
def navigate(url: str) -> str:
    """Navigate to a URL and wait for the page to load. Returns page title and URL."""
    if not url.startswith(("http://", "https://")):
        return "Error: only http and https URLs are supported."
    page = _get_page()
    try:
        page.goto(url, wait_until="networkidle")
        return f"Navigated to: {page.url}\nTitle: {page.title()}"
    except Exception as e:
        return f"Error navigating to {url}: {e}"


@mcp.tool
def click(selector: str) -> str:
    """Click an element on the page by CSS selector."""
    page = _get_page()
    try:
        page.click(selector)
        return f"Clicked: {selector}\nCurrent URL: {page.url}"
    except Exception as e:
        return f"Error clicking {selector}: {e}"


@mcp.tool
def fill_form(selector: str, value: str) -> str:
    """Fill a form field with a value by CSS selector."""
    page = _get_page()
    try:
        page.fill(selector, value)
        return f"Filled {selector} with value"
    except Exception as e:
        return f"Error filling {selector}: {e}"


@mcp.tool
def screenshot() -> str:
    """Take a screenshot of the current page. Returns base64-encoded PNG."""
    page = _get_page()
    try:
        data = page.screenshot(full_page=True)
        encoded = base64.b64encode(data).decode("utf-8")
        return f"Screenshot captured ({len(data)} bytes).\nBase64: {encoded[:100]}..."
    except Exception as e:
        return f"Error taking screenshot: {e}"


@mcp.tool
def extract_data(selector: str) -> str:
    """Extract text content from an element by CSS selector."""
    page = _get_page()
    try:
        text = page.inner_text(selector)
        if len(text) > 10000:
            text = text[:10000] + "\n\n[Content truncated at 10,000 characters]"
        return text
    except Exception as e:
        return f"Error extracting from {selector}: {e}"


def main():
    mcp.run()


if __name__ == "__main__":
    main()
