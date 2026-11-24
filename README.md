# Blackbox

A flight recorder for Chrome. Blackbox keeps a rolling record of the last 15 minutes of network requests, GraphQL operations and console output in every tab, so when something breaks you already have the evidence.

## Install

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose this folder.
3. Reload any tabs that were open before installing.

Requires Chrome 111 or later.

## Use

- **Toolbar popup:** shows what was recorded for the current tab. Tick **All tabs** to see everything.
- **DevTools → Blackbox panel:** the same view for the inspected tab. While DevTools is open on a tab, GraphQL response bodies are recorded too.
- **Download** saves the current view as JSON. **Clear** deletes the current tab's records, or all records when **All tabs** is ticked.

## What it records

| | Recorded | Not recorded |
|---|---|---|
| Network | Method, URL, status or error, resource type, time | Headers, cookies, non-GraphQL bodies |
| GraphQL | Operation names, query, variables (including persisted queries and `application/graphql` bodies); responses while DevTools is open | WebSocket subscriptions |
| Console | `log` / `info` / `warn` / `error` / `debug`, uncaught errors, unhandled promise rejections, stack traces for errors and warnings | |

## Privacy

- Records stay in memory (`chrome.storage.session`). They are never written to disk and disappear when the browser quits. Nothing is sent anywhere.
- Entries older than 15 minutes are deleted every minute. At most 5,000 network and 5,000 console entries are kept; when the network log is full, images, scripts and other static files are dropped before API calls.
- Before anything is stored, Blackbox masks likely secrets: URL query and hash parameters named like `token`, `password`, `key`, `secret`, `auth`, `session`, `code`; JSON fields with those names in GraphQL variables and responses; `Bearer`/`Basic` credentials and JWTs in console text. This is best-effort pattern matching, so review an export before sharing it.

## Files

| File | Role |
|---|---|
| `background.js` | Service worker: captures network requests, stores and prunes the log, applies redaction |
| `interceptor.js` | Runs in the page's own world and wraps `console` |
| `relay.js` | Forwards console entries from the page to the service worker |
| `devtools.js` | Adds the DevTools panel and captures GraphQL response bodies |
| `ui.js`, `ui.css` | The view shared by `popup.html` and `panel.html` |
