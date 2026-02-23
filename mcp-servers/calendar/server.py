"""ClawNix MCP server for Google Calendar."""

import json
import os
from datetime import datetime, timedelta

from fastmcp import FastMCP
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from googleapiclient.discovery import build

mcp = FastMCP(
    name="clawnix-mcp-calendar",
    instructions="Manage Google Calendar events. List, create, and find free time.",
)

SCOPES = ["https://www.googleapis.com/auth/calendar"]


def _get_calendar_service():
    creds_file = os.environ.get("CLAWNIX_GOOGLE_CREDENTIALS_FILE", "")
    token_file = os.environ.get("CLAWNIX_GOOGLE_TOKEN_FILE", "/tmp/clawnix-calendar-token.json")

    creds = None
    if os.path.exists(token_file):
        creds = Credentials.from_authorized_user_file(token_file, SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not creds_file or not os.path.exists(creds_file):
                raise RuntimeError(
                    "No Google credentials found. Set CLAWNIX_GOOGLE_CREDENTIALS_FILE "
                    "to path of OAuth client credentials JSON."
                )
            flow = InstalledAppFlow.from_client_secrets_file(creds_file, SCOPES)
            creds = flow.run_local_server(port=0)

        with open(token_file, "w") as f:
            f.write(creds.to_json())

    return build("calendar", "v3", credentials=creds)


@mcp.tool
def list_events(days: int = 7, calendar_id: str = "primary") -> str:
    """List upcoming calendar events for the next N days."""
    service = _get_calendar_service()
    now = datetime.utcnow()
    time_min = now.isoformat() + "Z"
    time_max = (now + timedelta(days=days)).isoformat() + "Z"

    result = service.events().list(
        calendarId=calendar_id,
        timeMin=time_min,
        timeMax=time_max,
        singleEvents=True,
        orderBy="startTime",
    ).execute()

    events = result.get("items", [])
    if not events:
        return f"No events in the next {days} days."

    lines = []
    for event in events:
        start = event["start"].get("dateTime", event["start"].get("date"))
        end = event["end"].get("dateTime", event["end"].get("date"))
        summary = event.get("summary", "Untitled")
        lines.append(f"- {start} → {end}: {summary}")

    return "\n".join(lines)


@mcp.tool
def create_event(
    summary: str,
    start: str,
    end: str,
    description: str = "",
    calendar_id: str = "primary",
) -> str:
    """Create a calendar event.

    Start and end should be ISO 8601 datetime strings (e.g. '2026-02-24T10:00:00').
    """
    service = _get_calendar_service()
    event_body = {
        "summary": summary,
        "start": {"dateTime": start, "timeZone": "Europe/Rome"},
        "end": {"dateTime": end, "timeZone": "Europe/Rome"},
    }
    if description:
        event_body["description"] = description

    event = service.events().insert(calendarId=calendar_id, body=event_body).execute()

    return json.dumps({
        "status": "created",
        "id": event.get("id"),
        "htmlLink": event.get("htmlLink"),
        "summary": summary,
    })


@mcp.tool
def find_free_time(date: str, duration_minutes: int = 60, calendar_id: str = "primary") -> str:
    """Find available time slots on a given date.

    Date should be YYYY-MM-DD format. Returns free slots of at least duration_minutes.
    """
    service = _get_calendar_service()
    day_start = datetime.fromisoformat(f"{date}T08:00:00")
    day_end = datetime.fromisoformat(f"{date}T18:00:00")

    result = service.events().list(
        calendarId=calendar_id,
        timeMin=day_start.isoformat() + "Z",
        timeMax=day_end.isoformat() + "Z",
        singleEvents=True,
        orderBy="startTime",
    ).execute()

    events = result.get("items", [])

    busy = []
    for event in events:
        start_str = event["start"].get("dateTime")
        end_str = event["end"].get("dateTime")
        if start_str and end_str:
            busy.append((
                datetime.fromisoformat(start_str.replace("Z", "+00:00")),
                datetime.fromisoformat(end_str.replace("Z", "+00:00")),
            ))

    busy.sort(key=lambda x: x[0])

    free_slots = []
    current = day_start
    for b_start, b_end in busy:
        b_start_naive = b_start.replace(tzinfo=None)
        b_end_naive = b_end.replace(tzinfo=None)
        if (b_start_naive - current).total_seconds() >= duration_minutes * 60:
            free_slots.append(f"  {current.strftime('%H:%M')} → {b_start_naive.strftime('%H:%M')}")
        current = max(current, b_end_naive)

    if (day_end - current).total_seconds() >= duration_minutes * 60:
        free_slots.append(f"  {current.strftime('%H:%M')} → {day_end.strftime('%H:%M')}")

    if not free_slots:
        return f"No free slots of {duration_minutes}+ minutes on {date}."

    return f"Available slots on {date} ({duration_minutes}+ min):\n" + "\n".join(free_slots)


def main():
    mcp.run()


if __name__ == "__main__":
    main()
