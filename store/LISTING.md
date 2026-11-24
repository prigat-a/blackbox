# Chrome Web Store listing

Copy these into the [Developer Dashboard](https://chrome.google.com/webstore/devconsole) when you submit. The name and short description come from `manifest.json` automatically.

## Store listing tab

**Name** (from manifest, 45 max)
Blackbox: Network, GraphQL & Console Recorder

**Summary** (from manifest, 132 max)
Debugging flight recorder: keeps the last 15 minutes of network requests, GraphQL calls and console logs. Export for bug reports.

**Category:** Developer Tools
**Language:** English

**Description**

```
Something broke, and by the time you opened DevTools the evidence was gone. Blackbox fixes that.

Blackbox is a flight recorder for Chrome. It quietly keeps the last 15 minutes of activity in every tab, so when a page misbehaves you can look back at what happened, or download it for a bug report.

WHAT IT RECORDS
• Network requests: URL, method, status or error, type and time
• GraphQL calls: operation name, query and variables, including persisted queries (Apollo, Relay). Responses too, while DevTools is open
• Console output: log, info, warn, error and debug messages, uncaught errors and unhandled promise rejections, with stack traces

HOW TO USE IT
• Click the toolbar icon to see the current tab's recent activity, or tick "All tabs"
• Or open DevTools → Blackbox for the same view of the inspected tab
• Click a row for details; Download saves everything as JSON

PRIVATE BY DESIGN
• Nothing leaves your browser: no servers, analytics or tracking
• Records stay in memory only and disappear when Chrome quits
• Likely secrets (tokens, passwords, API keys, JWTs) are masked before anything is stored
• Old entries are deleted automatically after 15 minutes

GOOD FOR
• Reproducing intermittent bugs
• Attaching network and console evidence to bug reports
• QA and support teams
• Debugging GraphQL and Apollo apps

Open source: https://github.com/prigat-a/Chrome-blackbox-ext

Disclaimer: this is a personal project built with the help of AI tools, not by a professional developer. It is provided as-is, without warranty; use it at your own risk.
```

**Graphics** (in this folder)

| Asset | File | Required size |
|---|---|---|
| Store icon | `../icons/icon-128.png` | 128×128 |
| Screenshot 1 | `screenshot-1-graphql.png` | 1280×800 |
| Screenshot 2 | `screenshot-2-network.png` | 1280×800 |
| Screenshot 3 | `screenshot-3-console.png` | 1280×800 |
| Small promo tile (optional) | `promo-small.png` | 440×280 |

**Homepage URL:** https://github.com/prigat-a/Chrome-blackbox-ext
**Support URL:** https://github.com/prigat-a/Chrome-blackbox-ext/issues

## Privacy practices tab

**Single purpose**

```
Blackbox records the last 15 minutes of a browser's network requests, GraphQL calls and console output in memory, so developers can review or export them when debugging a website.
```

**Permission justifications**

| Permission | Justification |
|---|---|
| Host permission (`<all_urls>`) | Blackbox records network requests and console output on whatever website the user is debugging, which can be any site. Its content scripts capture console messages, and webRequest needs host access to observe requests. Nothing is modified. |
| `webRequest` | Used read-only to observe network requests (URL, method, status, timing) and GraphQL request bodies for the 15-minute log. No requests are blocked, redirected or changed. |
| `storage` | Keeps the 15-minute log in chrome.storage.session (memory only) so it survives the service worker being suspended. Nothing is written to disk. |
| `alarms` | Runs a once-a-minute cleanup that deletes entries older than 15 minutes. |
| Remote code | No. All code is in the package; nothing is loaded or evaluated from elsewhere. |

**Data usage** — tick these:

- [x] Web history (request URLs)
- [x] Website content (console messages, GraphQL queries and responses)

Leave the others unticked. Then certify all three statements:

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL**
https://github.com/prigat-a/Chrome-blackbox-ext/blob/main/PRIVACY.md
(Works once the PR is merged into `main`.)

## Notes for the reviewer (Distribution tab → test instructions)

```
No account or setup is needed.
1. Install the extension and open any website, e.g. https://github.com.
2. Click the Blackbox toolbar icon: recent network requests and console messages for the tab are listed.
3. Open DevTools → Blackbox panel for the same view.
4. For GraphQL, open a site that uses it (e.g. a logged-in https://github.com) and see the GraphQL tab.
The extension makes no network requests of its own and stores data only in chrome.storage.session.
```

## Before each upload

1. Bump `version` in `manifest.json` (the store rejects a version it has seen).
2. Run `./scripts/package.sh` and upload the ZIP it prints.
