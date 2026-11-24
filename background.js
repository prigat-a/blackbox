// Blackbox service worker.
//
// MV3 service workers are stopped after ~30s of inactivity, so nothing here may
// live only in memory: the log is mirrored to chrome.storage.session (RAM only,
// never written to disk, cleared when the browser quits) shortly after every
// change, and reloaded whenever the worker starts again.

const WINDOW_MS = 15 * 60 * 1000;
const MAX_NETWORK = 5000;
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

function prune() {
  const cutoff = Date.now() - WINDOW_MS;
  log.network = log.network.filter(e => e.ts > cutoff).slice(-MAX_NETWORK);
  log.console = log.console.filter(e => e.ts > cutoff).slice(-MAX_CONSOLE);
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(save, SAVE_DELAY_MS);
}

async function save() {
  saveTimer = null;
  prune();
  try {
    await chrome.storage.session.set({ log });
  } catch (error) {
    // Over the storage.session quota (10 MB): drop the oldest half and retry.
    console.warn('Blackbox: storage full, dropping oldest entries', error);
    log.network = log.network.slice(Math.floor(log.network.length / 2));
    log.console = log.console.slice(Math.floor(log.console.length / 2));
    await chrome.storage.session.set({ log }).catch(() => {});
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
  return typeof text === 'string' && /^\s*(query|mutation|subscription|fragment|\{)/.test(text);
}

// Returns { operations, query, variables } or null when this isn't GraphQL.
function parseGraphQL(url, method, requestBody) {
  let ops = [];
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
    try {
      const parsed = JSON.parse(text);
      ops = (Array.isArray(parsed) ? parsed : [parsed]).filter(o => o && typeof o === 'object');
    } catch {}
  }

  const isGraphQL = /graphql/i.test(url) || ops.some(o => looksLikeQuery(o.query) || o.extensions?.persistedQuery);
  if (!isGraphQL) return null;

  return {
    operations: ops.map(o => o.operationName || inferOperationName(o.query) || 'anonymous'),
    query: clip(ops.map(o => o.query || (o.extensions?.persistedQuery ? '[persisted query]' : '')).join('\n\n'), MAX_QUERY),
    variables: ops.length === 1 ? redactJson(ops[0].variables ?? null) : redactJson(ops.map(o => o.variables ?? null)),
    response: null
  };
}

function inferOperationName(query) {
  const match = typeof query === 'string' && query.match(/^\s*(?:query|mutation|subscription)\s+(\w+)/);
  return match ? match[1] : null;
}

function isOwnRequest(details) {
  return details.initiator === EXTENSION_ORIGIN;
}

chrome.webRequest.onBeforeRequest.addListener(
  details => {
    if (isOwnRequest(details) || details.type !== 'xmlhttprequest') return;
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
  const graphql = pending.get(details.requestId) || null;
  pending.delete(details.requestId);
  const entry = {
    id: details.requestId,
    ts: details.timeStamp,
    tabId: details.tabId,
    method: details.method,
    url: redactUrl(details.url),
    type: details.type,
    status: error ? null : details.statusCode,
    error: error || null,
    fromCache: !!details.fromCache,
    graphql
  };
  mutate(l => l.network.push(entry));
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
function attachGraphQLResponse(data) {
  if (!data || typeof data.url !== 'string') return;
  let response;
  try {
    response = JSON.stringify(redactJson(JSON.parse(data.response)), null, 2);
  } catch {
    response = redactText(String(data.response ?? ''));
  }
  response = clip(response, MAX_RESPONSE);
  const url = redactUrl(data.url);

  mutate(l => {
    let best = null;
    for (let i = l.network.length - 1; i >= 0; i--) {
      const e = l.network[i];
      if (!e.graphql || e.graphql.response !== null || e.tabId !== data.tabId ||
          e.url !== url || e.method !== data.method) continue;
      const distance = Math.abs(e.ts - data.finishedMs);
      if (distance < 10000 && (!best || distance < best.distance)) best = { e, distance };
    }
    if (best) best.e.graphql.response = response;
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
