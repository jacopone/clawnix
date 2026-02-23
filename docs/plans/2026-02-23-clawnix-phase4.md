# ClawNix Phase 4: MCP Tool Servers — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add three MCP tool servers (browser, documents, email) so ClawNix agents can search the web, create documents, and manage email — all accessible from Telegram.

**Architecture:** Each MCP server is a standalone Python application using FastMCP, communicating via stdio transport. The existing `McpClientManager` spawns them as child processes — no TypeScript changes needed. Each server is packaged as a Nix derivation and referenced in the NixOS module config.

**Tech Stack:** Python 3.12, FastMCP, httpx, beautifulsoup4, duckduckgo-search, python-pptx, openpyxl, reportlab, imaplib/smtplib (stdlib)

---

## Task 1: MCP server project structure and mcp-browser

Create the directory structure for MCP servers and implement the browser server (highest value — enables research use case).

**Files:**
- Create: `mcp-servers/browser/server.py`
- Create: `mcp-servers/browser/test_server.py`
- Create: `mcp-servers/browser/pyproject.toml`

**Step 1: Create pyproject.toml**

```toml
# mcp-servers/browser/pyproject.toml
[project]
name = "clawnix-mcp-browser"
version = "0.1.0"
description = "ClawNix MCP server for web search and page reading"
requires-python = ">=3.11"
dependencies = [
    "fastmcp>=2.0.0",
    "httpx>=0.27.0",
    "beautifulsoup4>=4.12.0",
    "duckduckgo-search>=7.0.0",
]

[project.optional-dependencies]
dev = ["pytest>=8.0.0", "pytest-asyncio>=0.24.0"]

[project.scripts]
clawnix-mcp-browser = "server:main"
```

**Step 2: Write the test**

```python
# mcp-servers/browser/test_server.py
import pytest
from unittest.mock import patch, AsyncMock, MagicMock
from server import search_web, read_page


def test_search_web_returns_results():
    mock_results = [
        {"title": "Example", "href": "https://example.com", "body": "A snippet"},
        {"title": "Test", "href": "https://test.com", "body": "Another snippet"},
    ]
    with patch("server.DDGS") as MockDDGS:
        instance = MockDDGS.return_value
        instance.text.return_value = mock_results
        result = search_web("test query", max_results=2)

    assert "Example" in result
    assert "https://example.com" in result
    assert "A snippet" in result


def test_search_web_handles_empty_results():
    with patch("server.DDGS") as MockDDGS:
        instance = MockDDGS.return_value
        instance.text.return_value = []
        result = search_web("obscure query", max_results=5)

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
        result = read_page("https://example.com")

    assert "Main content" in result


def test_read_page_handles_errors():
    with patch("server.httpx") as mock_httpx:
        mock_httpx.get.side_effect = Exception("Connection failed")
        result = read_page("https://nonexistent.example.com")

    assert "Error" in result
```

**Step 3: Run test to verify it fails**

Run: `cd /home/guyfawkes/nixclaw/mcp-servers/browser && python -m pytest test_server.py -v`
Expected: FAIL — module `server` not found.

**Step 4: Implement the server**

```python
# mcp-servers/browser/server.py
"""ClawNix MCP server for web search and page reading."""

import httpx
from bs4 import BeautifulSoup
from duckduckgo_search import DDGS
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
    """Fetch a web page and extract its main text content as markdown."""
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
```

**Step 5: Run tests**

Run: `cd /home/guyfawkes/nixclaw/mcp-servers/browser && python -m pytest test_server.py -v`
Expected: All 4 tests pass.

**Step 6: Commit**

```bash
git add mcp-servers/browser/
git commit -m "feat: add mcp-browser server with web search and page reading"
```

---

## Task 2: mcp-documents server

Create a FastMCP server that generates PPTX, XLSX, and PDF files.

**Files:**
- Create: `mcp-servers/documents/server.py`
- Create: `mcp-servers/documents/test_server.py`
- Create: `mcp-servers/documents/pyproject.toml`

**Step 1: Create pyproject.toml**

```toml
# mcp-servers/documents/pyproject.toml
[project]
name = "clawnix-mcp-documents"
version = "0.1.0"
description = "ClawNix MCP server for document creation (PPTX, XLSX, PDF)"
requires-python = ">=3.11"
dependencies = [
    "fastmcp>=2.0.0",
    "python-pptx>=1.0.0",
    "openpyxl>=3.1.0",
    "reportlab>=4.0.0",
]

[project.optional-dependencies]
dev = ["pytest>=8.0.0"]

[project.scripts]
clawnix-mcp-documents = "server:main"
```

**Step 2: Write the tests**

```python
# mcp-servers/documents/test_server.py
import json
import os
import tempfile
import pytest
from server import create_presentation, create_spreadsheet, create_pdf


@pytest.fixture
def output_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("CLAWNIX_DOCUMENTS_DIR", str(tmp_path))
    return tmp_path


def test_create_presentation(output_dir):
    result = create_presentation(
        title="Test Deck",
        slides=[
            {"title": "Slide 1", "content": "Hello world"},
            {"title": "Slide 2", "content": "Second slide content"},
        ],
    )
    parsed = json.loads(result)
    assert parsed["status"] == "created"
    assert parsed["file"].endswith(".pptx")
    assert os.path.exists(parsed["file"])


def test_create_presentation_empty_slides(output_dir):
    result = create_presentation(title="Empty", slides=[])
    parsed = json.loads(result)
    assert parsed["status"] == "created"


def test_create_spreadsheet(output_dir):
    result = create_spreadsheet(
        name="test_data",
        sheets={
            "Sales": [
                ["Product", "Revenue"],
                ["Widget A", 1500],
                ["Widget B", 2300],
            ],
        },
    )
    parsed = json.loads(result)
    assert parsed["status"] == "created"
    assert parsed["file"].endswith(".xlsx")
    assert os.path.exists(parsed["file"])


def test_create_spreadsheet_multiple_sheets(output_dir):
    result = create_spreadsheet(
        name="multi",
        sheets={
            "Sheet1": [["A", "B"], [1, 2]],
            "Sheet2": [["C", "D"], [3, 4]],
        },
    )
    parsed = json.loads(result)
    assert parsed["sheets"] == 2


def test_create_pdf(output_dir):
    result = create_pdf(
        title="Test Document",
        content="This is the body of the PDF document.\n\nIt has multiple paragraphs.",
    )
    parsed = json.loads(result)
    assert parsed["status"] == "created"
    assert parsed["file"].endswith(".pdf")
    assert os.path.exists(parsed["file"])
```

**Step 3: Run test to verify it fails**

Run: `cd /home/guyfawkes/nixclaw/mcp-servers/documents && python -m pytest test_server.py -v`
Expected: FAIL — module `server` not found.

**Step 4: Implement the server**

```python
# mcp-servers/documents/server.py
"""ClawNix MCP server for document creation (PPTX, XLSX, PDF)."""

import json
import os
from datetime import datetime

from fastmcp import FastMCP
from openpyxl import Workbook
from pptx import Presentation
from pptx.util import Inches, Pt
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer

mcp = FastMCP(
    name="clawnix-mcp-documents",
    instructions="Create PPTX presentations, XLSX spreadsheets, and PDF documents.",
)


def _output_dir() -> str:
    d = os.environ.get("CLAWNIX_DOCUMENTS_DIR", "/tmp/clawnix-documents")
    os.makedirs(d, exist_ok=True)
    return d


def _timestamp() -> str:
    return datetime.now().strftime("%Y%m%d-%H%M%S")


@mcp.tool
def create_presentation(title: str, slides: list[dict]) -> str:
    """Create a PowerPoint presentation.

    Each slide dict should have 'title' (str) and 'content' (str) keys.
    Returns JSON with file path and metadata.
    """
    prs = Presentation()

    # Title slide
    layout = prs.slide_layouts[0]
    slide = prs.slides.add_slide(layout)
    slide.shapes.title.text = title
    if slide.placeholders[1]:
        slide.placeholders[1].text = f"Generated by ClawNix"

    # Content slides
    layout = prs.slide_layouts[1]
    for s in slides:
        slide = prs.slides.add_slide(layout)
        slide.shapes.title.text = s.get("title", "")
        if slide.placeholders[1]:
            slide.placeholders[1].text = s.get("content", "")

    filename = f"{_timestamp()}-{title.replace(' ', '_')[:30]}.pptx"
    filepath = os.path.join(_output_dir(), filename)
    prs.save(filepath)

    return json.dumps({
        "status": "created",
        "file": filepath,
        "slides": len(slides) + 1,
        "title": title,
    })


@mcp.tool
def create_spreadsheet(name: str, sheets: dict[str, list[list]]) -> str:
    """Create an Excel spreadsheet.

    sheets is a dict of sheet_name -> list of rows. Each row is a list of cell values.
    Returns JSON with file path and metadata.
    """
    wb = Workbook()
    # Remove default sheet
    wb.remove(wb.active)

    for sheet_name, rows in sheets.items():
        ws = wb.create_sheet(title=sheet_name[:31])  # Excel limits to 31 chars
        for row in rows:
            ws.append(row)

    if not sheets:
        wb.create_sheet(title="Sheet1")

    filename = f"{_timestamp()}-{name.replace(' ', '_')[:30]}.xlsx"
    filepath = os.path.join(_output_dir(), filename)
    wb.save(filepath)

    return json.dumps({
        "status": "created",
        "file": filepath,
        "sheets": max(len(sheets), 1),
        "name": name,
    })


@mcp.tool
def create_pdf(title: str, content: str) -> str:
    """Create a PDF document from text content.

    Content can include newlines for paragraph breaks.
    Returns JSON with file path and metadata.
    """
    filename = f"{_timestamp()}-{title.replace(' ', '_')[:30]}.pdf"
    filepath = os.path.join(_output_dir(), filename)

    doc = SimpleDocTemplate(filepath, pagesize=A4)
    styles = getSampleStyleSheet()
    story = []

    # Title
    story.append(Paragraph(title, styles["Title"]))
    story.append(Spacer(1, 12))

    # Content paragraphs
    for paragraph in content.split("\n\n"):
        paragraph = paragraph.strip()
        if paragraph:
            story.append(Paragraph(paragraph, styles["BodyText"]))
            story.append(Spacer(1, 6))

    doc.build(story)

    return json.dumps({
        "status": "created",
        "file": filepath,
        "title": title,
    })


def main():
    mcp.run()


if __name__ == "__main__":
    main()
```

**Step 5: Run tests**

Run: `cd /home/guyfawkes/nixclaw/mcp-servers/documents && python -m pytest test_server.py -v`
Expected: All 5 tests pass.

**Step 6: Commit**

```bash
git add mcp-servers/documents/
git commit -m "feat: add mcp-documents server for PPTX, XLSX, and PDF creation"
```

---

## Task 3: mcp-email server

Create a FastMCP server for email management with draft-then-send workflow.

**Files:**
- Create: `mcp-servers/email/server.py`
- Create: `mcp-servers/email/test_server.py`
- Create: `mcp-servers/email/pyproject.toml`

**Step 1: Create pyproject.toml**

```toml
# mcp-servers/email/pyproject.toml
[project]
name = "clawnix-mcp-email"
version = "0.1.0"
description = "ClawNix MCP server for email (IMAP/SMTP)"
requires-python = ">=3.11"
dependencies = [
    "fastmcp>=2.0.0",
]

[project.optional-dependencies]
dev = ["pytest>=8.0.0"]

[project.scripts]
clawnix-mcp-email = "server:main"
```

No external email libraries needed — Python stdlib `imaplib`, `smtplib`, `email` cover everything.

**Step 2: Write the tests**

```python
# mcp-servers/email/test_server.py
import json
import os
import tempfile
import pytest
from unittest.mock import patch, MagicMock
from server import list_emails, read_email, draft_reply, send_email, _load_credentials


@pytest.fixture
def mock_creds(tmp_path, monkeypatch):
    user_file = tmp_path / "user"
    user_file.write_text("test@example.com")
    pass_file = tmp_path / "pass"
    pass_file.write_text("secret123")
    monkeypatch.setenv("CLAWNIX_EMAIL_USER_FILE", str(user_file))
    monkeypatch.setenv("CLAWNIX_EMAIL_PASS_FILE", str(pass_file))
    monkeypatch.setenv("CLAWNIX_EMAIL_IMAP_HOST", "imap.example.com")
    monkeypatch.setenv("CLAWNIX_EMAIL_SMTP_HOST", "smtp.example.com")
    monkeypatch.setenv("CLAWNIX_DRAFTS_DIR", str(tmp_path / "drafts"))


def test_load_credentials(mock_creds):
    creds = _load_credentials()
    assert creds["user"] == "test@example.com"
    assert creds["password"] == "secret123"
    assert creds["imap_host"] == "imap.example.com"
    assert creds["smtp_host"] == "smtp.example.com"


def test_list_emails_returns_summary(mock_creds):
    mock_mail = MagicMock()
    mock_mail.search.return_value = ("OK", [b"1 2 3"])
    mock_mail.fetch.return_value = ("OK", [
        (b"1", b'From: sender@example.com\r\nSubject: Test\r\nDate: Mon, 1 Jan 2026 00:00:00 +0000\r\n\r\nBody'),
    ])

    with patch("server.imaplib.IMAP4_SSL", return_value=mock_mail):
        mock_mail.__enter__ = MagicMock(return_value=mock_mail)
        mock_mail.__exit__ = MagicMock(return_value=False)
        result = list_emails(folder="INBOX", limit=3)

    assert "sender@example.com" in result or "Test" in result


def test_draft_reply_saves_file(mock_creds):
    result = draft_reply(
        to="client@example.com",
        subject="Re: Invoice",
        body="Thanks for reaching out. The invoice is attached.",
    )
    parsed = json.loads(result)
    assert parsed["status"] == "drafted"
    assert os.path.exists(parsed["file"])


def test_send_email_reads_draft(mock_creds):
    # First create a draft
    draft_result = json.loads(draft_reply(
        to="client@example.com",
        subject="Re: Test",
        body="Test body",
    ))

    mock_smtp = MagicMock()
    with patch("server.smtplib.SMTP_SSL", return_value=mock_smtp):
        mock_smtp.__enter__ = MagicMock(return_value=mock_smtp)
        mock_smtp.__exit__ = MagicMock(return_value=False)
        result = send_email(draft_id=draft_result["draft_id"])

    parsed = json.loads(result)
    assert parsed["status"] == "sent"
```

**Step 3: Run test to verify it fails**

Run: `cd /home/guyfawkes/nixclaw/mcp-servers/email && python -m pytest test_server.py -v`
Expected: FAIL — module `server` not found.

**Step 4: Implement the server**

```python
# mcp-servers/email/server.py
"""ClawNix MCP server for email (IMAP read, draft, SMTP send)."""

import email
import email.mime.text
import imaplib
import json
import os
import smtplib
import uuid
from datetime import datetime
from email.header import decode_header

from fastmcp import FastMCP

mcp = FastMCP(
    name="clawnix-mcp-email",
    instructions="Read emails, draft replies, and send messages. Sending requires approval.",
)


def _load_credentials() -> dict:
    user_file = os.environ.get("CLAWNIX_EMAIL_USER_FILE", "")
    pass_file = os.environ.get("CLAWNIX_EMAIL_PASS_FILE", "")
    user = open(user_file).read().strip() if user_file and os.path.exists(user_file) else ""
    password = open(pass_file).read().strip() if pass_file and os.path.exists(pass_file) else ""
    return {
        "user": user,
        "password": password,
        "imap_host": os.environ.get("CLAWNIX_EMAIL_IMAP_HOST", "imap.gmail.com"),
        "smtp_host": os.environ.get("CLAWNIX_EMAIL_SMTP_HOST", "smtp.gmail.com"),
        "smtp_port": int(os.environ.get("CLAWNIX_EMAIL_SMTP_PORT", "465")),
    }


def _drafts_dir() -> str:
    d = os.environ.get("CLAWNIX_DRAFTS_DIR", "/tmp/clawnix-drafts")
    os.makedirs(d, exist_ok=True)
    return d


def _decode_header_value(value: str) -> str:
    if not value:
        return ""
    decoded_parts = decode_header(value)
    result = []
    for part, charset in decoded_parts:
        if isinstance(part, bytes):
            result.append(part.decode(charset or "utf-8", errors="replace"))
        else:
            result.append(part)
    return " ".join(result)


@mcp.tool
def list_emails(folder: str = "INBOX", limit: int = 20) -> str:
    """List recent emails from a folder. Returns subject, sender, date for each."""
    creds = _load_credentials()
    try:
        with imaplib.IMAP4_SSL(creds["imap_host"]) as mail:
            mail.login(creds["user"], creds["password"])
            mail.select(folder, readonly=True)
            _, data = mail.search(None, "ALL")
            ids = data[0].split()
            # Get most recent emails
            ids = ids[-limit:] if len(ids) > limit else ids
            ids.reverse()

            results = []
            for eid in ids:
                _, msg_data = mail.fetch(eid, "(BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)])")
                if msg_data[0] is None:
                    continue
                raw = msg_data[0][1] if isinstance(msg_data[0], tuple) else msg_data[0]
                msg = email.message_from_bytes(raw)
                results.append({
                    "id": eid.decode(),
                    "from": _decode_header_value(msg.get("From", "")),
                    "subject": _decode_header_value(msg.get("Subject", "")),
                    "date": msg.get("Date", ""),
                })

            return json.dumps(results, indent=2)
    except Exception as e:
        return f"Error listing emails: {e}"


@mcp.tool
def read_email(email_id: str, folder: str = "INBOX") -> str:
    """Read the full content of a specific email by ID."""
    creds = _load_credentials()
    try:
        with imaplib.IMAP4_SSL(creds["imap_host"]) as mail:
            mail.login(creds["user"], creds["password"])
            mail.select(folder, readonly=True)
            _, msg_data = mail.fetch(email_id.encode(), "(RFC822)")
            if msg_data[0] is None:
                return f"Email {email_id} not found."

            raw = msg_data[0][1] if isinstance(msg_data[0], tuple) else msg_data[0]
            msg = email.message_from_bytes(raw)

            body = ""
            if msg.is_multipart():
                for part in msg.walk():
                    if part.get_content_type() == "text/plain":
                        payload = part.get_payload(decode=True)
                        if payload:
                            body = payload.decode(errors="replace")
                            break
            else:
                payload = msg.get_payload(decode=True)
                if payload:
                    body = payload.decode(errors="replace")

            return json.dumps({
                "id": email_id,
                "from": _decode_header_value(msg.get("From", "")),
                "to": _decode_header_value(msg.get("To", "")),
                "subject": _decode_header_value(msg.get("Subject", "")),
                "date": msg.get("Date", ""),
                "body": body[:5000],
            }, indent=2)
    except Exception as e:
        return f"Error reading email: {e}"


@mcp.tool
def draft_reply(to: str, subject: str, body: str) -> str:
    """Draft an email reply. Saves to drafts folder, does NOT send.

    Returns a draft_id that can be passed to send_email.
    """
    creds = _load_credentials()
    draft_id = str(uuid.uuid4())[:8]

    msg = email.mime.text.MIMEText(body)
    msg["From"] = creds["user"]
    msg["To"] = to
    msg["Subject"] = subject
    msg["Date"] = email.utils.formatdate(localtime=True)

    filepath = os.path.join(_drafts_dir(), f"{draft_id}.eml")
    with open(filepath, "w") as f:
        f.write(msg.as_string())

    return json.dumps({
        "status": "drafted",
        "draft_id": draft_id,
        "file": filepath,
        "to": to,
        "subject": subject,
    })


@mcp.tool
def send_email(draft_id: str) -> str:
    """Send a previously drafted email. Requires approval.

    Pass the draft_id from draft_reply to send the email.
    """
    creds = _load_credentials()
    filepath = os.path.join(_drafts_dir(), f"{draft_id}.eml")

    if not os.path.exists(filepath):
        return json.dumps({"status": "error", "message": f"Draft {draft_id} not found."})

    with open(filepath) as f:
        msg = email.message_from_string(f.read())

    try:
        with smtplib.SMTP_SSL(creds["smtp_host"], creds["smtp_port"]) as smtp:
            smtp.login(creds["user"], creds["password"])
            smtp.send_message(msg)
    except Exception as e:
        return json.dumps({"status": "error", "message": f"Failed to send: {e}"})

    # Remove draft after sending
    os.remove(filepath)

    return json.dumps({
        "status": "sent",
        "to": msg["To"],
        "subject": msg["Subject"],
    })


def main():
    mcp.run()


if __name__ == "__main__":
    main()
```

**Step 5: Run tests**

Run: `cd /home/guyfawkes/nixclaw/mcp-servers/email && python -m pytest test_server.py -v`
Expected: All 4 tests pass.

**Step 6: Commit**

```bash
git add mcp-servers/email/
git commit -m "feat: add mcp-email server with IMAP read, draft, and SMTP send"
```

---

## Task 4: Nix packaging for all three MCP servers

Package each MCP server as a Nix derivation in the flake.

**Files:**
- Create: `nix/mcp-browser.nix`
- Create: `nix/mcp-documents.nix`
- Create: `nix/mcp-email.nix`
- Modify: `flake.nix` — add the three packages

**Step 1: Create nix/mcp-browser.nix**

```nix
# nix/mcp-browser.nix
{ python3, lib }:

python3.pkgs.buildPythonApplication {
  pname = "clawnix-mcp-browser";
  version = "0.1.0";
  src = ../mcp-servers/browser;
  format = "pyproject";

  nativeBuildInputs = with python3.pkgs; [
    setuptools
  ];

  propagatedBuildInputs = with python3.pkgs; [
    fastmcp
    httpx
    beautifulsoup4
    duckduckgo-search
  ];

  doCheck = false;  # Tests require network mocking setup

  meta = with lib; {
    description = "ClawNix MCP server for web search and page reading";
    license = licenses.mit;
  };
}
```

**Step 2: Create nix/mcp-documents.nix**

```nix
# nix/mcp-documents.nix
{ python3, lib }:

python3.pkgs.buildPythonApplication {
  pname = "clawnix-mcp-documents";
  version = "0.1.0";
  src = ../mcp-servers/documents;
  format = "pyproject";

  nativeBuildInputs = with python3.pkgs; [
    setuptools
  ];

  propagatedBuildInputs = with python3.pkgs; [
    fastmcp
    python-pptx
    openpyxl
    reportlab
  ];

  doCheck = false;

  meta = with lib; {
    description = "ClawNix MCP server for PPTX, XLSX, and PDF creation";
    license = licenses.mit;
  };
}
```

**Step 3: Create nix/mcp-email.nix**

```nix
# nix/mcp-email.nix
{ python3, lib }:

python3.pkgs.buildPythonApplication {
  pname = "clawnix-mcp-email";
  version = "0.1.0";
  src = ../mcp-servers/email;
  format = "pyproject";

  nativeBuildInputs = with python3.pkgs; [
    setuptools
  ];

  propagatedBuildInputs = with python3.pkgs; [
    fastmcp
  ];

  doCheck = false;

  meta = with lib; {
    description = "ClawNix MCP server for email (IMAP/SMTP)";
    license = licenses.mit;
  };
}
```

**Step 4: Update flake.nix**

Add the three packages to the `packages` output. Read the current flake.nix first, then add:

```nix
packages.${system} = {
  default = pkgs.buildNpmPackage { /* existing clawnix package */ };
  mcp-browser = pkgs.callPackage ./nix/mcp-browser.nix {};
  mcp-documents = pkgs.callPackage ./nix/mcp-documents.nix {};
  mcp-email = pkgs.callPackage ./nix/mcp-email.nix {};
};
```

**Step 5: Verify Nix evaluation**

Run: `cd /home/guyfawkes/nixclaw && nix flake check`
Expected: No evaluation errors. Note: actual builds may fail if Python packages aren't in nixpkgs — that's fine for now, we just need the derivations to evaluate.

If `fastmcp` is not in nixpkgs, use `fetchPypi` or `buildPythonPackage` with a direct source. Check first:
Run: `nix eval nixpkgs#python3Packages.fastmcp.version 2>&1`

If not available, add a local FastMCP derivation or use `pip` in a wrapped script instead of `buildPythonApplication`. The simplest fallback is a shell wrapper:

```nix
# Fallback: wrap the Python script with pip-installed deps
{ pkgs, lib }:
let
  pythonEnv = pkgs.python3.withPackages (ps: with ps; [
    httpx beautifulsoup4
    # fastmcp and duckduckgo-search via pip overlay or fetchPypi
  ]);
in pkgs.writeShellScriptBin "clawnix-mcp-browser" ''
  exec ${pythonEnv}/bin/python ${../mcp-servers/browser/server.py} "$@"
''
```

Adjust packaging approach based on what's available in nixpkgs. The key requirement is that each server can be run via `${package}/bin/clawnix-mcp-{name}`.

**Step 6: Commit**

```bash
git add nix/mcp-browser.nix nix/mcp-documents.nix nix/mcp-email.nix flake.nix
git commit -m "feat: add Nix packaging for MCP browser, documents, and email servers"
```

---

## Task 5: Update NixOS module and server example

Wire the MCP server packages into the NixOS module so agents can use them, and update the server example config.

**Files:**
- Modify: `nix/module.nix` — no structural changes needed (MCP servers already configurable)
- Modify: `nix/server-example.nix` — add MCP server configurations

**Step 1: Update server example with MCP server configs**

Read `nix/server-example.nix`, then add the MCP servers to the example:

```nix
services.clawnix = {
  # ... existing config ...

  mcp.servers = {
    browser = {
      command = "${pkgs.clawnix-mcp-browser}/bin/clawnix-mcp-browser";
    };
    documents = {
      command = "${pkgs.clawnix-mcp-documents}/bin/clawnix-mcp-documents";
      env.CLAWNIX_DOCUMENTS_DIR = "/var/lib/clawnix/documents";
    };
    email = {
      command = "${pkgs.clawnix-mcp-email}/bin/clawnix-mcp-email";
      env = {
        CLAWNIX_EMAIL_IMAP_HOST = "imap.gmail.com";
        CLAWNIX_EMAIL_SMTP_HOST = "smtp.gmail.com";
        # CLAWNIX_EMAIL_USER_FILE = config.sops.secrets."clawnix/email-user".path;
        # CLAWNIX_EMAIL_PASS_FILE = config.sops.secrets."clawnix/email-pass".path;
        CLAWNIX_EMAIL_USER_FILE = "/run/secrets/email-user";
        CLAWNIX_EMAIL_PASS_FILE = "/run/secrets/email-pass";
      };
    };
  };

  agents.personal = {
    # ... existing config ...
    mcp.servers = [ "browser" "documents" "email" ];

    security.toolPolicies = [
      # Browser: auto (read-only)
      { tool = "browser_search_web"; effect = "allow"; }
      { tool = "browser_read_page"; effect = "allow"; }
      # Documents: notify (creates files locally)
      { tool = "documents_create_presentation"; effect = "allow"; }
      { tool = "documents_create_spreadsheet"; effect = "allow"; }
      { tool = "documents_create_pdf"; effect = "allow"; }
      # Email: tiered
      { tool = "email_list_emails"; effect = "allow"; }
      { tool = "email_read_email"; effect = "allow"; }
      { tool = "email_draft_reply"; effect = "allow"; }
      { tool = "email_send_email"; effect = "approve"; }
    ];
  };
};
```

**Step 2: Add ReadWritePaths for documents output dir**

In `nix/module.nix`, ensure the documents output directory is writable. The agent service already has `PrivateTmp`, but the documents dir might be outside `/tmp`. Add `/var/lib/clawnix/documents` to the agent's `ReadWritePaths` in the module, or let the documents server use the agent's workspace dir.

The simplest approach: set `CLAWNIX_DOCUMENTS_DIR` to a path under the agent's state dir (already writable).

**Step 3: Verify Nix evaluation**

Run: `cd /home/guyfawkes/nixclaw && nix flake check`
Expected: No errors.

**Step 4: Commit**

```bash
git add nix/server-example.nix nix/module.nix
git commit -m "feat: wire MCP servers into NixOS module and server example"
```

---

## Task 6: Update README

Add a section about MCP tool servers to the README.

**Files:**
- Modify: `README.md`

**Step 1: Add MCP servers section**

After the existing "Server Deployment" section, add:

```markdown
## MCP Tool Servers

ClawNix agents gain capabilities through MCP (Model Context Protocol) tool servers. Each is a standalone Python server communicating via stdio.

| Server | Tools | Description |
|--------|-------|-------------|
| mcp-browser | `search_web`, `read_page` | Web search via DuckDuckGo, page reading with content extraction |
| mcp-documents | `create_presentation`, `create_spreadsheet`, `create_pdf` | PPTX, XLSX, PDF creation |
| mcp-email | `list_emails`, `read_email`, `draft_reply`, `send_email` | IMAP inbox reading, draft-then-send workflow |

Configure in NixOS:

\```nix
services.clawnix.mcp.servers = {
  browser.command = "${pkgs.clawnix-mcp-browser}/bin/clawnix-mcp-browser";
  documents.command = "${pkgs.clawnix-mcp-documents}/bin/clawnix-mcp-documents";
  email = {
    command = "${pkgs.clawnix-mcp-email}/bin/clawnix-mcp-email";
    env.CLAWNIX_EMAIL_USER_FILE = config.sops.secrets."clawnix/email-user".path;
    env.CLAWNIX_EMAIL_PASS_FILE = config.sops.secrets."clawnix/email-pass".path;
  };
};
\```
```

**Step 2: Run full test suite**

Run: `cd /home/guyfawkes/nixclaw && npx vitest run`
Expected: All tests pass.

**Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add MCP tool servers section to README"
```

---

## Summary

| Task | Description | New files | Modified files |
|------|-------------|-----------|----------------|
| 1 | mcp-browser (search + read) | server.py, test, pyproject.toml | — |
| 2 | mcp-documents (PPTX/XLSX/PDF) | server.py, test, pyproject.toml | — |
| 3 | mcp-email (IMAP/SMTP/draft) | server.py, test, pyproject.toml | — |
| 4 | Nix packaging | 3 .nix files | flake.nix |
| 5 | NixOS module + example | — | module.nix, server-example.nix |
| 6 | README update | — | README.md |

6 tasks. Browser first (highest value), then documents, email, packaging, wiring, docs.
