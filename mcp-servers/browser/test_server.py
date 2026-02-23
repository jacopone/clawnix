import pytest
from unittest.mock import patch, MagicMock
from server import search_web, read_page

# FastMCP @mcp.tool wraps functions in FunctionTool objects.
# Access the underlying function via .fn for direct testing.
_search_web = search_web.fn
_read_page = read_page.fn


def test_search_web_returns_results():
    mock_results = [
        {"title": "Example", "href": "https://example.com", "body": "A snippet"},
        {"title": "Test", "href": "https://test.com", "body": "Another snippet"},
    ]
    with patch("server.DDGS") as MockDDGS:
        mock_instance = MagicMock()
        mock_instance.text.return_value = mock_results
        MockDDGS.return_value = mock_instance
        result = _search_web("test query", max_results=2)

    assert "Example" in result
    assert "https://example.com" in result
    assert "A snippet" in result


def test_search_web_handles_empty_results():
    with patch("server.DDGS") as MockDDGS:
        mock_instance = MagicMock()
        mock_instance.text.return_value = []
        MockDDGS.return_value = mock_instance
        result = _search_web("obscure query", max_results=5)

    assert "No results" in result


def test_read_page_extracts_text():
    html = """
    <html><body>
        <article><h1>Title</h1><p>Main content here.</p></article>
        <nav>Navigation</nav>
    </body></html>
    """
    with patch("server.httpx") as mock_httpx:
        mock_response = MagicMock()
        mock_response.text = html
        mock_response.status_code = 200
        mock_response.raise_for_status = MagicMock()
        mock_httpx.get.return_value = mock_response
        result = _read_page("https://example.com")

    assert "Main content" in result


def test_read_page_strips_nav():
    html = """
    <html><body>
        <nav>Navigation links</nav>
        <article><p>Article content.</p></article>
        <footer>Footer stuff</footer>
    </body></html>
    """
    with patch("server.httpx") as mock_httpx:
        mock_response = MagicMock()
        mock_response.text = html
        mock_response.raise_for_status = MagicMock()
        mock_httpx.get.return_value = mock_response
        result = _read_page("https://example.com")

    assert "Article content" in result
    assert "Navigation" not in result
    assert "Footer" not in result


def test_read_page_truncates_long_content():
    long_text = "A" * 15000
    html = f"<html><body><article><p>{long_text}</p></article></body></html>"
    with patch("server.httpx") as mock_httpx:
        mock_response = MagicMock()
        mock_response.text = html
        mock_response.raise_for_status = MagicMock()
        mock_httpx.get.return_value = mock_response
        result = _read_page("https://example.com")

    assert len(result) < 15000
    assert "[Content truncated" in result


def test_read_page_rejects_non_http_url():
    result = _read_page("file:///etc/passwd")
    assert "Error" in result
    assert "http" in result


def test_read_page_handles_errors():
    with patch("server.httpx") as mock_httpx:
        mock_httpx.get.side_effect = Exception("Connection failed")
        result = _read_page("https://nonexistent.example.com")

    assert "Error" in result
