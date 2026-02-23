import json
import os
import pytest
from unittest.mock import patch, MagicMock
from server import list_emails, read_email, draft_reply, send_email, _load_credentials

# FastMCP 2.x wraps @mcp.tool functions in FunctionTool objects
_list_emails = list_emails.fn
_read_email = read_email.fn
_draft_reply = draft_reply.fn
_send_email = send_email.fn


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
        result = _list_emails(folder="INBOX", limit=3)

    assert "sender@example.com" in result or "Test" in result


def test_draft_reply_saves_file(mock_creds):
    result = _draft_reply(
        to="client@example.com",
        subject="Re: Invoice",
        body="Thanks for reaching out. The invoice is attached.",
    )
    parsed = json.loads(result)
    assert parsed["status"] == "drafted"
    assert os.path.exists(parsed["file"])


def test_send_email_reads_draft(mock_creds):
    # First create a draft
    draft_result = json.loads(_draft_reply(
        to="client@example.com",
        subject="Re: Test",
        body="Test body",
    ))

    mock_smtp = MagicMock()
    with patch("server.smtplib.SMTP_SSL", return_value=mock_smtp):
        mock_smtp.__enter__ = MagicMock(return_value=mock_smtp)
        mock_smtp.__exit__ = MagicMock(return_value=False)
        result = _send_email(draft_id=draft_result["draft_id"])

    parsed = json.loads(result)
    assert parsed["status"] == "sent"
