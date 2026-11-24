# Blackbox

A flight recorder for Chrome. Blackbox keeps a rolling record of the last 15 minutes of network requests, GraphQL operations and console output in every tab, so when something breaks you already have the evidence.

> **Disclaimer: I'm a vibecoder, not a professional developer.** This extension was built with the help of AI tools and has not been professionally reviewed or audited. It is provided as-is, without any warranty (see [LICENSE](LICENSE)). **If you use it, you do so at your own risk and are responsible for any consequences**, including for any sensitive data it records from the pages you visit. Redaction of secrets is best-effort and can miss things, so check an export before you share it.

## Install

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose this folder.
3. Reload any tabs that were open before installing.

Requires Chrome 111 or later.

## Use

- **Toolbar popup:** shows what was recorded for the current tab. Tick **All tabs** to see everything.
- **DevTools → Blackbox panel:** the same view for the inspected tab. While DevTools is open on a tab, GraphQL response bodies are recorded too.
- The header shows how much memory the log uses (for example `1.4 MB / 10 MB`, across all tabs); hover it for entry counts. It turns amber above 80%.
- **Download** saves the current view as JSON. **Clear** deletes the current tab's records, or all records when **All tabs** is ticked.

## What it records

| | Recorded | Not recorded |
|---|---|---|
| Network | Method, URL, status or error, resource type, time | Headers, cookies, non-GraphQL bodies |
| GraphQL | Operation names, query, variables (including persisted queries and `application/graphql` bodies); responses while DevTools is open | WebSocket subscriptions |
| Console | `log` / `info` / `warn` / `error` / `debug`, uncaught errors, unhandled promise rejections, stack traces for errors and warnings | |

## Privacy

- Records stay in memory (`chrome.storage.session`). They are never written to disk and disappear when the browser quits. Nothing is sent anywhere.
- Entries older than 15 minutes are deleted every minute. At most 15,000 network and 5,000 console entries are kept; when the network log is full, images, scripts and other static files are dropped before API calls.
- Chrome limits this in-memory storage to 10 MB. A typical full log is 3–7 MB. If it would go over, Blackbox frees space in this order: half the static files, the rest of the static files, the largest GraphQL responses, then the oldest quarter of everything.
- Before anything is stored, Blackbox masks likely secrets: URL query and hash parameters named like `token`, `password`, `key`, `secret`, `auth`, `session`, `code`; JSON fields with those names in GraphQL variables and responses; `Bearer`/`Basic` credentials and JWTs in console text. This is best-effort pattern matching, so review an export before sharing it.

## Publishing to the Chrome Web Store

- `./scripts/package.sh` builds `dist/blackbox-<version>.zip` with only the files the extension needs. Bump `version` in `manifest.json` before each upload.
- `./scripts/screenshots.sh` renders the store screenshots and promo tile into `store/` (needs Google Chrome).
- [`store/LISTING.md`](store/LISTING.md) has the description, permission justifications, data-use answers and reviewer notes to paste into the Developer Dashboard.
- [`PRIVACY.md`](PRIVACY.md) is the privacy policy the store requires.

## Files

| File | Role |
|---|---|
| `background.js` | Service worker: captures network requests, stores and prunes the log, applies redaction |
| `interceptor.js` | Runs in the page's own world and wraps `console` |
| `relay.js` | Forwards console entries from the page to the service worker |
| `devtools.js` | Adds the DevTools panel and captures GraphQL response bodies |
| `ui.js`, `ui.css` | The view shared by `popup.html` and `panel.html` |
| `icons/` | Extension icons; `icon.svg` is the source |
| `store/`, `scripts/`, `PRIVACY.md` | Chrome Web Store assets and tooling (not part of the extension package) |
