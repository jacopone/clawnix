"""ClawNix MCP server for email (IMAP read, draft, SMTP send)."""

import email
import email.mime.text
import email.utils
import imaplib
import json
import os
import smtplib
import uuid
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
