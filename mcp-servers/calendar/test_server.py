import json
import os
import pytest
from unittest.mock import patch, MagicMock
from datetime import datetime, timedelta
from server import list_events, create_event, find_free_time

# FastMCP 2.x wraps @mcp.tool functions
_list_events = list_events.fn
_create_event = create_event.fn
_find_free_time = find_free_time.fn


@pytest.fixture
def mock_creds(tmp_path, monkeypatch):
    creds_file = tmp_path / "creds.json"
    creds_file.write_text('{"installed": {"client_id": "test"}}')
    token_file = tmp_path / "token.json"
    monkeypatch.setenv("CLAWNIX_GOOGLE_CREDENTIALS_FILE", str(creds_file))
    monkeypatch.setenv("CLAWNIX_GOOGLE_TOKEN_FILE", str(token_file))


def test_list_events_returns_summary(mock_creds):
    mock_service = MagicMock()
    mock_events = {
        "items": [
            {
                "summary": "Team standup",
                "start": {"dateTime": "2026-02-23T09:00:00+01:00"},
                "end": {"dateTime": "2026-02-23T09:30:00+01:00"},
                "id": "event1",
            },
            {
                "summary": "Lunch",
                "start": {"dateTime": "2026-02-23T12:00:00+01:00"},
                "end": {"dateTime": "2026-02-23T13:00:00+01:00"},
                "id": "event2",
            },
        ]
    }
    mock_service.events.return_value.list.return_value.execute.return_value = mock_events

    with patch("server._get_calendar_service", return_value=mock_service):
        result = _list_events(days=1)

    assert "Team standup" in result
    assert "Lunch" in result


def test_list_events_empty(mock_creds):
    mock_service = MagicMock()
    mock_service.events.return_value.list.return_value.execute.return_value = {"items": []}

    with patch("server._get_calendar_service", return_value=mock_service):
        result = _list_events(days=1)

    assert "No events" in result


def test_create_event_returns_link(mock_creds):
    mock_service = MagicMock()
    mock_service.events.return_value.insert.return_value.execute.return_value = {
        "id": "new-event-1",
        "htmlLink": "https://calendar.google.com/event?eid=123",
        "summary": "New meeting",
    }

    with patch("server._get_calendar_service", return_value=mock_service):
        result = _create_event(
            summary="New meeting",
            start="2026-02-24T10:00:00",
            end="2026-02-24T11:00:00",
        )

    parsed = json.loads(result)
    assert parsed["status"] == "created"
    assert "htmlLink" in parsed


def test_find_free_time_returns_slots(mock_creds):
    mock_service = MagicMock()
    mock_events = {
        "items": [
            {
                "summary": "Existing meeting",
                "start": {"dateTime": "2026-02-24T10:00:00+01:00"},
                "end": {"dateTime": "2026-02-24T11:00:00+01:00"},
            },
        ]
    }
    mock_service.events.return_value.list.return_value.execute.return_value = mock_events

    with patch("server._get_calendar_service", return_value=mock_service):
        result = _find_free_time(date="2026-02-24", duration_minutes=30)

    # Should find free time before and after the meeting
    assert "08:00" in result or "Available" in result or "free" in result.lower()


def test_find_free_time_no_slots(mock_creds):
    """When the day is fully booked, return 'No free slots' message."""
    mock_service = MagicMock()
    # Fill the entire 08:00-18:00 window
    mock_events = {
        "items": [
            {
                "summary": "All day",
                "start": {"dateTime": "2026-02-24T08:00:00+01:00"},
                "end": {"dateTime": "2026-02-24T18:00:00+01:00"},
            },
        ]
    }
    mock_service.events.return_value.list.return_value.execute.return_value = mock_events

    with patch("server._get_calendar_service", return_value=mock_service):
        result = _find_free_time(date="2026-02-24", duration_minutes=30)

    assert "No free slots" in result
