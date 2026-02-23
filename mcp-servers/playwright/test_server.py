import sys
import pytest
from unittest.mock import patch, MagicMock

# Mock playwright before importing server so the module-level import succeeds
# even when playwright is not installed (e.g., in CI or system Python).
if "playwright" not in sys.modules:
    _pw_mock = MagicMock()
    sys.modules["playwright"] = _pw_mock
    sys.modules["playwright.sync_api"] = _pw_mock.sync_api

# Mock fastmcp if not installed
if "fastmcp" not in sys.modules:
    _fmcp_mock = MagicMock()
    # FastMCP().tool decorator should return the function wrapped with a .fn attr
    def _tool_decorator(func):
        func.fn = func
        return func
    _fmcp_mock.FastMCP.return_value.tool = _tool_decorator
    sys.modules["fastmcp"] = _fmcp_mock

import server  # noqa: E402 — must come after mocking


@pytest.fixture
def mock_page():
    """Mock the playwright page."""
    with patch("server._get_page") as mock_get:
        page = MagicMock()
        page.title.return_value = "Test Page"
        page.url = "https://example.com"
        page.content.return_value = "<html><body>Hello</body></html>"
        page.inner_text.return_value = "Hello"
        page.screenshot.return_value = b"fake-png-data"
        mock_get.return_value = page
        yield page


def test_navigate(mock_page):
    result = server.navigate.fn(url="https://example.com")
    mock_page.goto.assert_called_once_with("https://example.com", wait_until="networkidle")
    assert "Navigated to" in result


def test_navigate_invalid_url(mock_page):
    result = server.navigate.fn(url="ftp://invalid")
    assert "Error" in result


def test_click(mock_page):
    result = server.click.fn(selector="button.submit")
    mock_page.click.assert_called_once_with("button.submit")
    assert "Clicked" in result


def test_fill_form(mock_page):
    result = server.fill_form.fn(selector="input[name=email]", value="test@example.com")
    mock_page.fill.assert_called_once_with("input[name=email]", "test@example.com")
    assert "Filled" in result


def test_screenshot(mock_page):
    result = server.screenshot.fn()
    mock_page.screenshot.assert_called_once()
    assert "Screenshot captured" in result


def test_extract_data(mock_page):
    result = server.extract_data.fn(selector="body")
    mock_page.inner_text.assert_called_once_with("body")
    assert result == "Hello"
