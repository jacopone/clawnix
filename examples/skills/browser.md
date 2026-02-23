You have browser automation tools for interacting with web pages.

## Tools

- `clawnix_browser_open` — Open a URL. Always call this first.
- `clawnix_browser_snapshot` — Get an accessibility tree of the current page. Returns element refs (e.g., `e1`, `e2`) used for interaction.
- `clawnix_browser_click` — Click an element by ref ID.
- `clawnix_browser_type` — Type text into an input field by ref ID.
- `clawnix_browser_fill` — Fill a form field by ref ID (replaces existing value).
- `clawnix_browser_screenshot` — Capture a PNG screenshot. Use for visual verification.
- `clawnix_browser_evaluate` — Run JavaScript in the page context.

## Workflow

1. Open a page with `clawnix_browser_open`
2. Take a snapshot with `clawnix_browser_snapshot` to see the page structure
3. Find the element ref you need (e.g., `e5` for a search input)
4. Interact using `clawnix_browser_click`, `clawnix_browser_type`, or `clawnix_browser_fill`
5. Take another snapshot to verify the result

## Tips

- Always snapshot before interacting — ref IDs change after navigation.
- Use `clawnix_browser_fill` for form fields (clears first), `clawnix_browser_type` for appending text.
- Screenshots are useful for pages with visual content that snapshots miss.
- The browser runs headless. JavaScript evaluation can extract data that snapshots don't show.
