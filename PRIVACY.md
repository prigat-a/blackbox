# Blackbox privacy policy

_Last updated: 24 November 2026_

Blackbox is a Chrome extension that records recent browser activity to help you debug websites. This policy explains what it records, where that data goes, and how long it is kept.

## Summary

- Blackbox collects nothing about you for anyone else. **No data leaves your browser.** There are no servers, analytics, tracking or ads.
- What it records is kept **in memory only**, for **15 minutes**, and is deleted when Chrome quits.
- Data is only written to a file when **you** click **Download**.

## What Blackbox records

On the websites you visit, Blackbox records:

- **Network requests:** the address (URL), method, status or error, resource type and time of each request. Headers, cookies and request or response bodies are not recorded, except for GraphQL requests (below).
- **GraphQL requests:** the operation name, query text and variables. While Chrome DevTools is open on a tab, it also records the response body.
- **Console output:** messages a page writes to the browser console (`log`, `info`, `warn`, `error`, `debug`), uncaught errors and unhandled promise rejections, with stack traces for errors and warnings.

This can include personal or sensitive information if a website puts it in a URL, a GraphQL request or response, or a console message.

## How secrets are masked

Before anything is stored, Blackbox masks values that look like secrets: URL parameters with names such as `token`, `password`, `key`, `secret`, `auth`, `session` or `code`; GraphQL fields with those names; and `Bearer`/`Basic` credentials and JWTs in console text. This is pattern matching and can miss things, so check an export before sharing it.

## Where data is stored and for how long

- Records are kept in `chrome.storage.session`. This is memory inside Chrome, private to the extension. It is never written to disk and is cleared when Chrome quits, or when the extension is removed, reloaded or updated.
- Entries older than 15 minutes are deleted automatically. At most 15,000 network and 5,000 console entries are kept, and no more than 10 MB in total.
- You can delete records at any time with **Clear**.

## Sharing

Blackbox does not send, sell, share or transfer any data to anyone, including the developer. It makes no network requests of its own. The only way data leaves the extension is a JSON file you choose to download, which you control.

## Permissions

| Permission | Why it is needed |
|---|---|
| Access to all websites | To record requests and console output on whichever sites you are debugging |
| `webRequest` | To see network requests and their results (read-only; nothing is blocked or changed) |
| `storage` | To keep the 15-minute log in memory while Chrome's background worker sleeps |
| `alarms` | To delete entries older than 15 minutes every minute |

## Changes and contact

If this policy changes, the new version will be published at this address with a new date. Questions or concerns: open an issue at <https://github.com/prigat-a/Chrome-blackbox-ext/issues>.

Blackbox is a personal project built with the help of AI tools, provided as-is without warranty (see [LICENSE](LICENSE)).
