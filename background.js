// Blackbox service worker.
//
// MV3 service workers are stopped after ~30s of inactivity, so nothing here may
// live only in memory: the log is mirrored to chrome.storage.session (RAM only,
// never written to disk, cleared when the browser quits) shortly after every
// change, and reloaded whenever the worker starts again.

const WINDOW_MS = 15 * 60 * 1000;
const MAX_NETWORK = 15000;   // ~6 MB at ~410 B each
const MAX_CONSOLE = 5000;
const MAX_TEXT = 2000;         // one console argument
const MAX_STACK = 4000;
const MAX_QUERY = 10000;       // GraphQL query text
const MAX_RESPONSE = 20000;    // GraphQL response text
const MAX_BODY_BYTES = 1024 * 1024;
const SAVE_DELAY_MS = 300;

const EXTENSION_ORIGIN = chrome.runtime.getURL('').slice(0, -1);
const LEVELS = new Set(['log', 'info', 'warn', 'error', 'debug']);

// ---------------------------------------------------------------------------
// Redaction. Everything is redacted before it is stored, so neither the views
// nor an exported file ever contain the original secrets.

const SENSITIVE_KEY = /pass(word|wd)?|secret|token|auth|session|^sid$|^sig$|signature|api[-_]?key|^key$|credential|jwt|cookie|^code$/i;

function redactText(text) {
  return String(text)
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/-]+=*/gi, '$1 [redacted]')
    .replace(/\beyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]{5,}/g, '[redacted-jwt]')
    .replace(/((?:access_|refresh_|id_)?token|password|passwd|secret|api[-_]?key)(["']?\s*[:=]\s*["']?)[^\s"'&,;}]+/gi, '$1$2[redacted]');
}

function redactParams(params) {
  for (const key of [...params.keys()]) {
    if (SENSITIVE_KEY.test(key)) params.set(key, '[redacted]');
  }
}

function redactUrl(raw) {
  try {
    const url = new URL(raw);
    url.username = '';
    url.password = '';
    redactParams(url.searchParams);
    if (url.hash.includes('=')) {
      const hash = new URLSearchParams(url.hash.slice(1));
      redactParams(hash);
      url.hash = hash.toString();
    }
    return url.toString().replace(/%5Bredacted%5D/g, '[redacted]');
  } catch {
    return redactText(raw);
  }
}

function redactJson(value, depth = 0) {
  if (depth > 20) return '[too deep]';
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map(v => redactJson(v, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEY.test(k) ? '[redacted]' : redactJson(v, depth + 1);
    }
    return out;
  }
  return value;
}

function clip(text, max) {
  text = String(text);
  return text.length > max ? text.slice(0, max) + `… [${text.length - max} more chars]` : text;
}

// ---------------------------------------------------------------------------
// Log storage.

let log = emptyLog();
let saveTimer = null;

function emptyLog() {
  return { network: [], console: [] };
}

const ready = chrome.storage.session.get('log').then(result => {
  if (result.log) log = result.log;
  prune();
});

async function mutate(change) {
  await ready;
  change(log);
  scheduleSave();
}

// Images, scripts, fonts and the like: the first thing to let go of.
function isStatic(entry) {
  return !API_TYPES.has(entry.type) && entry.type !== 'main_frame' && !entry.graphql;
}

// Drops the oldest `count` static entries.
function dropOldestStatic(entries, count) {
  return entries.filter(e => {
    if (count > 0 && isStatic(e)) {
      count--;
      return false;
    }
    return true;
  });
}

// Images, scripts and ads can fill the cap in minutes. When over it, drop the
// oldest static resources first so API calls keep their full 15 minutes.
function capNetwork(entries) {
  let excess = entries.length - MAX_NETWORK;
  if (excess <= 0) return entries;
  const kept = entries.filter(e => {
    if (excess > 0 && isStatic(e)) {
      excess--;
      return false;
    }
    return true;
  });
  return kept.slice(-MAX_NETWORK);
}

function prune() {
  const cutoff = Date.now() - WINDOW_MS;
  log.network = capNetwork(log.network.filter(e => e.ts > cutoff));
  log.console = log.console.filter(e => e.ts > cutoff).slice(-MAX_CONSOLE);
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(save, SAVE_DELAY_MS);
}

// What to give up, in order, when the log won't fit in storage.session's
// 10 MB. Each step is followed by another attempt to save; the last one
// repeats until it fits.
const TRIM_STEPS = [
  function halveStaticFiles(l) {
    l.network = dropOldestStatic(l.network, Math.ceil(l.network.filter(isStatic).length / 2));
  },
  function dropAllStaticFiles(l) {
    l.network = l.network.filter(e => !isStatic(e));
  },
  function dropLargestGraphQLResponses(l) {
    // Free about 2 MB, biggest responses first. The request stays listed.
    const withResponse = l.network.filter(e => e.graphql?.response).sort(
      (a, b) => b.graphql.response.length - a.graphql.response.length);
    let freed = 0;
    for (const e of withResponse) {
      if (freed > 2 * 1024 * 1024) break;
      freed += e.graphql.response.length;
      e.graphql.response = '[dropped: Blackbox ran out of memory]';
    }
  },
  function dropOldestQuarter(l) {
    l.network = l.network.slice(Math.floor(l.network.length / 4));
    l.console = l.console.slice(Math.floor(l.console.length / 4));
  }
];

async function save() {
  saveTimer = null;
  prune();
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      await chrome.storage.session.set({ log });
      return;
    } catch (error) {
      const step = TRIM_STEPS[Math.min(attempt, TRIM_STEPS.length - 1)];
      console.warn(`Blackbox: log is over the 10 MB storage limit; trimming (${step.name})`);
      step(log);
    }
  }
}

// Pruning runs on an alarm because setInterval dies with the service worker.
chrome.alarms.get('prune').then(alarm => {
  if (!alarm) chrome.alarms.create('prune', { periodInMinutes: 1 });
});
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'prune') mutate(() => {});
});

// ---------------------------------------------------------------------------
// Network capture.

// Request bodies only exist in onBeforeRequest. Keep the GraphQL ones until the
// request finishes. This map is lost if the worker stops mid-request, which
// only costs that request its query text.
const pending = new Map();

function decodeBody(requestBody) {
  if (!requestBody) return '';
  if (requestBody.raw) {
    let size = 0;
    const parts = [];
    for (const part of requestBody.raw) {
      if (!part.bytes) continue;
      size += part.bytes.byteLength;
      if (size > MAX_BODY_BYTES) return '';
      parts.push(new Uint8Array(part.bytes));
    }
    const all = new Uint8Array(size);
    let offset = 0;
    for (const p of parts) { all.set(p, offset); offset += p.length; }
    return new TextDecoder().decode(all);
  }
  if (requestBody.formData) {
    const flat = {};
    for (const [k, v] of Object.entries(requestBody.formData)) flat[k] = v[0];
    return JSON.stringify(flat);
  }
  return '';
}

function looksLikeQuery(text) {
  if (typeof text !== 'string') return false;
  const code = text.replace(/^(\s*#[^\n]*\n)*/, ''); // skip leading # comments
  // A bare '{' only counts as shorthand query syntax ("{ me { id } }"), not
  // JSON ('{"event_id": ...}'), which is what Sentry and others send.
  return /^\s*((query|mutation|subscription|fragment)\b|\{\s*[A-Za-z_])/.test(code);
}

// Persisted-query clients (Apollo APQ, Relay, Meta-style doc_id) send only an
// id and variables, without the query text.
function persistedId(op) {
  if (op.extensions?.persistedQuery) return op.extensions.persistedQuery.sha256Hash || 'persisted';
  const id = op.documentId ?? op.doc_id ?? op.queryId ?? op.queryHash ?? op.operationId ??
    (op.variables !== undefined ? op.id ?? op.hash : undefined);
  return typeof id === 'string' || typeof id === 'number' ? String(id) : null;
}

// A path segment named graphql or gql (/graphql, /api/graphql, /gql/v2). The
// query string doesn't count: plenty of analytics and search URLs mention it.
function isGraphQLEndpoint(url) {
  try {
    return /(^|\/)(graphql|gql)(\/|$)/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

// FNV-1a: a short fingerprint of a request body, used to match DevTools
// responses to the right request without storing the body itself.
function fingerprint(text) {
  if (!text) return null;
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36) + ':' + text.length;
}

// Returns { operations, query, variables } or null when this isn't GraphQL.
function parseGraphQL(url, method, requestBody) {
  let ops = [];
  let bodyKey = null;
  if (method === 'GET') {
    try {
      const params = new URL(url).searchParams;
      if (params.has('query') || params.has('extensions')) {
        let variables = null;
        try { variables = JSON.parse(params.get('variables') || 'null'); } catch {}
        ops = [{ operationName: params.get('operationName'), query: params.get('query'), variables }];
      }
    } catch {}
  } else {
    const text = decodeBody(requestBody);
    if (requestBody?.raw) bodyKey = fingerprint(text);
    try {
      const parsed = JSON.parse(text);
      ops = (Array.isArray(parsed) ? parsed : [parsed]).filter(o => o && typeof o === 'object');
      // Form posts (Meta-style) carry variables as a JSON string.
      for (const o of ops) {
        if (typeof o.variables === 'string') { try { o.variables = JSON.parse(o.variables); } catch {} }
      }
    } catch {
      // Content-Type: application/graphql sends the bare query text.
      if (looksLikeQuery(text)) ops = [{ query: text }];
    }
  }

  if (!isGraphQLEndpoint(url)) {
    ops = ops.filter(o => looksLikeQuery(o.query) || o.extensions?.persistedQuery ||
      (persistedId(o) && 'variables' in o));
  }
  // An unparseable POST to a GraphQL endpoint is still worth listing.
  if (!ops.length && !(method === 'POST' && isGraphQLEndpoint(url))) return null;

  return {
    operations: ops.length ? ops.map(o => o.operationName || o.fb_api_req_friendly_name || inferOperationName(o.query) || 'anonymous') : ['unknown'],
    query: clip(ops.map(o => typeof o.query === 'string' ? o.query
      : persistedId(o) ? `[persisted query ${persistedId(o)}]` : '').join('\n\n'), MAX_QUERY),
    variables: ops.length === 1 ? redactJson(ops[0].variables ?? null)
      : ops.length ? redactJson(ops.map(o => o.variables ?? null)) : null,
    bodyKey,
    response: null
  };
}

function inferOperationName(query) {
  const match = typeof query === 'string' && query.match(/(?:^|\n)\s*(?:query|mutation|subscription)\s+(\w+)/);
  return match ? match[1] : null;
}

function isOwnRequest(details) {
  return details.initiator === EXTENSION_ORIGIN;
}

// fetch() and XHR are 'xmlhttprequest'; sendBeacon is 'ping'; some workers'
// requests show up as 'other'.
const API_TYPES = new Set(['xmlhttprequest', 'ping', 'other']);

chrome.webRequest.onBeforeRequest.addListener(
  details => {
    if (isOwnRequest(details) || !API_TYPES.has(details.type)) return;
    const graphql = parseGraphQL(details.url, details.method, details.requestBody);
    if (!graphql) return;
    pending.set(details.requestId, graphql);
    if (pending.size > 1000) pending.delete(pending.keys().next().value);
  },
  { urls: ['<all_urls>'] },
  ['requestBody']
);

function record(details, error) {
  if (isOwnRequest(details)) return;
  let graphql = pending.get(details.requestId) || null;
  pending.delete(details.requestId);
  // The body is gone if the service worker restarted mid-request; still list
  // the call in the GraphQL tab when the URL says what it is.
  if (!graphql && API_TYPES.has(details.type) && details.method === 'POST' && isGraphQLEndpoint(details.url)) {
    graphql = { operations: ['unknown'], query: '', variables: null, bodyKey: null, response: null };
  }
  const entry = {
    id: details.requestId,
    ts: details.timeStamp,
    tabId: details.tabId,
    initiator: details.initiator || null,
    method: details.method,
    url: redactUrl(details.url),
    type: details.type,
    status: error ? null : details.statusCode,
    error: error || null,
    fromCache: !!details.fromCache,
    graphql
  };
  mutate(l => {
    if (graphql) graphql.response = takeEarlyResponse(entry);
    l.network.push(entry);
  });
}

chrome.webRequest.onCompleted.addListener(d => record(d, null), { urls: ['<all_urls>'] });
chrome.webRequest.onErrorOccurred.addListener(d => record(d, d.error), { urls: ['<all_urls>'] });

// ---------------------------------------------------------------------------
// Messages.

function fromExtensionPage(sender) {
  return sender.id === chrome.runtime.id && !sender.tab && typeof sender.url === 'string' &&
    sender.url.startsWith(EXTENSION_ORIGIN + '/');
}

// Console entries originate in the page, so treat every field as untrusted.
function cleanConsoleEntry(raw, sender) {
  if (!raw || !LEVELS.has(raw.level) || !Array.isArray(raw.messages)) return null;
  return {
    id: crypto.randomUUID(),
    ts: Number.isFinite(raw.ts) && Math.abs(raw.ts - Date.now()) < WINDOW_MS ? raw.ts : Date.now(),
    tabId: sender.tab.id,
    frameUrl: redactUrl(sender.url || sender.tab.url || ''),
    level: raw.level,
    messages: raw.messages.slice(0, 20).map(m => clip(redactText(m), MAX_TEXT)),
    stack: typeof raw.stack === 'string' ? clip(redactText(raw.stack), MAX_STACK) : null
  };
}

// The DevTools page sees response bodies, which webRequest can't. Attach each
// one to the request webRequest already recorded.
// DevTools sometimes reports a response before webRequest reports the request
// finished. Hold those briefly so record() can attach them.
let earlyResponses = [];

// Requests to one /graphql URL differ only by body, so when both sides have a
// body fingerprint it must agree. Without one, fall back to URL and timing.
function matches(entry, r) {
  const key = entry.graphql?.bodyKey;
  return entry.tabId === r.tabId && entry.url === r.url && entry.method === r.method &&
    Math.abs(entry.ts - r.finishedMs) < 10000 &&
    (!key || !r.bodyKey || key === r.bodyKey);
}

function matchScore(entry, r) {
  const exact = entry.graphql?.bodyKey && entry.graphql.bodyKey === r.bodyKey;
  return (exact ? 0 : 100000) + Math.abs(entry.ts - r.finishedMs);
}

function takeEarlyResponse(entry) {
  earlyResponses = earlyResponses.filter(r => Date.now() - r.receivedAt < 15000);
  let i = -1;
  earlyResponses.forEach((r, j) => {
    if (matches(entry, r) && (i === -1 || matchScore(entry, r) < matchScore(entry, earlyResponses[i]))) i = j;
  });
  return i === -1 ? null : earlyResponses.splice(i, 1)[0].response;
}

function attachGraphQLResponse(data) {
  if (!data || typeof data.url !== 'string') return;
  let response;
  try {
    response = JSON.stringify(redactJson(JSON.parse(data.response)), null, 2);
  } catch {
    response = redactText(String(data.response ?? ''));
  }
  response = clip(response, MAX_RESPONSE);
  const r = {
    tabId: data.tabId,
    url: redactUrl(data.url),
    method: data.method,
    finishedMs: data.finishedMs,
    bodyKey: typeof data.bodyKey === 'string' ? data.bodyKey : null,
    response,
    receivedAt: Date.now()
  };

  mutate(l => {
    let best = null;
    for (let i = l.network.length - 1; i >= 0; i--) {
      const e = l.network[i];
      if (!e.graphql || e.graphql.response !== null || !matches(e, r)) continue;
      // A fingerprinted response may still be waiting for its own request to
      // finish; don't hand it to an older request that lost its body.
      if (r.bodyKey && e.graphql.bodyKey !== r.bodyKey) continue;
      const score = matchScore(e, r);
      if (!best || score < best.score) best = { e, score };
    }
    if (best) best.e.graphql.response = response;
    else if (earlyResponses.length < 200) earlyResponses.push(r);
  });
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (!message || typeof message !== 'object') return;

  if (message.type === 'console' && sender.tab && Array.isArray(message.entries)) {
    const entries = message.entries.slice(0, 200).map(e => cleanConsoleEntry(e, sender)).filter(Boolean);
    if (entries.length) mutate(l => l.console.push(...entries));
    return;
  }

  if (!fromExtensionPage(sender)) return;

  if (message.type === 'graphqlResponse') {
    attachGraphQLResponse(message.data);
  } else if (message.type === 'clear') {
    const tabId = message.tabId;
    mutate(l => {
      if (Number.isInteger(tabId)) {
        l.network = l.network.filter(e => e.tabId !== tabId);
        l.console = l.console.filter(e => e.tabId !== tabId);
      } else {
        Object.assign(l, emptyLog());
      }
    });
  }
});
