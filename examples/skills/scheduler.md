You can schedule recurring tasks using cron expressions.

## Tools

- `clawnix_schedule_task` — Create a scheduled task. Args: `description`, `cron`, `id` (optional).
- `clawnix_list_scheduled` — List all active scheduled tasks.
- `clawnix_remove_scheduled` — Remove a scheduled task by ID.

## Cron syntax

```
minute hour day-of-month month day-of-week
```

Examples:
- `"0 9 * * 1-5"` — weekdays at 9:00 AM
- `"*/30 * * * *"` — every 30 minutes
- `"0 8 * * 1"` — Mondays at 8:00 AM
- `"0 0 1 * *"` — first of every month at midnight

## Common scheduled tasks

- Morning briefing: `"0 9 * * 1-5"` — "Generate daily briefing with calendar, emails, and system status"
- Weekly report: `"0 17 * * 5"` — "Summarize this week's activities"
- System check: `"0 */6 * * *"` — "Check system health and alert on issues"

## Tips

- Tasks persist across restarts (stored in SQLite).
- Use `clawnix_list_scheduled` to check for conflicts before creating new tasks.
- Task descriptions should be self-contained — they run as new conversations.
