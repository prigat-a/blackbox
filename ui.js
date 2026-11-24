// Shared by popup.html and panel.html. Reads the log straight from
// chrome.storage.session and re-renders when it changes; no polling.
//
// Every value shown here came from a web page, so it is only ever put into
// the DOM with textContent, never innerHTML.

const MAX_SHOWN = 500;
const inPanel = typeof chrome.devtools !== 'undefined' && !!chrome.devtools.inspectedWindow;

const state = {
  log: { network: [], console: [] },
  tabId: null,
  tabOrigin: null,
  allTabs: false,
  view: 'network',
  expanded: new Set()
};

const $ = id => document.getElementById(id);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function time(ts) {
  return new Date(ts).toLocaleTimeString([], { hour12: false });
}

// Requests made by a page's service worker or shared worker have no tab
// (tabId -1). Count them as the current tab's when they come from its origin.
function scoped(entries) {
  if (state.allTabs || state.tabId === null) return entries;
  return entries.filter(e => e.tabId === state.tabId ||
    (e.tabId === -1 && state.tabOrigin && e.initiator === state.tabOrigin));
}

function originOf(url) {
  try { return new URL(url).origin; } catch { return null; }
}

function currentData() {
  const network = scoped(state.log.network || []);
  return {
    network,
    graphql: network.filter(e => e.graphql),
    console: scoped(state.log.console || [])
  };
}

// --- rows ------------------------------------------------------------------

function statusCell(entry) {
  if (entry.error) {
    const name = entry.error.replace(/^net::/, '');
    // Routine: a navigation replaced by a newer one, or a cache-only attempt
    // that Chrome follows with a real fetch.
    const routine = name === 'ERR_ABORTED' || name === 'ERR_CACHE_MISS';
    const cell = el('span', 'status ' + (routine ? 'routine' : 'bad'), name);
    if (routine) cell.title = 'Usually harmless: Chrome cancelled or retried this request itself.';
    return cell;
  }
  const s = entry.status;
  return el('span', 'status ' + (s >= 400 ? 'bad' : s >= 300 ? 'redirect' : ''), s ?? '—');
}

function expandable(id, summaryNodes, buildBody) {
  const details = el('details', 'row');
  details.open = state.expanded.has(id);
  const summary = el('summary');
  summary.append(...summaryNodes);
  details.append(summary);
  if (details.open) details.append(buildBody());
  details.addEventListener('toggle', () => {
    if (details.open) {
      state.expanded.add(id);
      if (details.childElementCount === 1) details.append(buildBody());
    } else {
      state.expanded.delete(id);
    }
  });
  return details;
}

function block(label, text) {
  const wrap = el('div', 'block');
  wrap.append(el('div', 'label', label), el('pre', null, text));
  return wrap;
}

function networkRow(e) {
  return expandable('n' + e.id, [
    el('span', 'time', time(e.ts)),
    el('span', 'method', e.method),
    statusCell(e),
    el('span', 'url', e.url)
  ], () => block('Details', [
    `URL:    ${e.url}`,
    `Type:   ${e.type}${e.fromCache ? ' (from cache)' : ''}`,
    `Tab:    ${e.tabId}`
  ].join('\n')));
}

function graphqlRow(e) {
  const g = e.graphql;
  return expandable('g' + e.id, [
    el('span', 'time', time(e.ts)),
    statusCell(e),
    el('span', 'op', g.operations.join(', ') || 'anonymous'),
    el('span', 'url dim', e.url)
  ], () => {
    const body = el('div');
    if (g.query) body.append(block('Query', g.query));
    if (g.variables !== null && g.variables !== undefined) {
      body.append(block('Variables', JSON.stringify(g.variables, null, 2)));
    }
    body.append(block('Response', g.response ??
      'Response bodies are only captured while DevTools is open on this tab.'));
    return body;
  });
}

function consoleRow(e) {
  const summary = [
    el('span', 'time', time(e.ts)),
    el('span', 'level ' + e.level, e.level),
    el('span', 'message', e.messages.join(' '))
  ];
  return expandable('c' + e.id, summary, () =>
    block('Source', [e.frameUrl, e.stack].filter(Boolean).join('\n\n') || '—'));
}

// --- render ----------------------------------------------------------------

function render() {
  const data = currentData();
  $('count-network').textContent = data.network.length;
  $('count-graphql').textContent = data.graphql.length;
  $('count-console').textContent = data.console.length;
  for (const btn of document.querySelectorAll('[data-view]')) {
    btn.classList.toggle('active', btn.dataset.view === state.view);
  }

  const entries = data[state.view];
  const shown = entries.slice(-MAX_SHOWN);
  const list = $('list');
  const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 30;
  const scrollTop = list.scrollTop;

  const rows = document.createDocumentFragment();
  if (entries.length > shown.length) {
    rows.append(el('div', 'note', `Showing the latest ${shown.length} of ${entries.length}. Download to get all of them.`));
  }
  const makeRow = { network: networkRow, graphql: graphqlRow, console: consoleRow }[state.view];
  for (const e of shown) rows.append(makeRow(e));
  if (!entries.length) {
    rows.append(el('div', 'note', state.view === 'console'
      ? 'No console output in the last 15 minutes.'
      : 'Nothing recorded in the last 15 minutes. Pages opened before the extension was installed need a reload.'));
  }
  list.replaceChildren(rows);

  // Stay pinned to the newest entry, unless the user scrolled up to read.
  list.scrollTop = atBottom ? list.scrollHeight : scrollTop;
}

let renderQueued = false;
function queueRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; render(); });
}

// --- actions ---------------------------------------------------------------

function download() {
  const data = currentData();
  const payload = {
    exportedAt: new Date().toISOString(),
    scope: state.allTabs ? 'all tabs' : `tab ${state.tabId}`,
    windowMinutes: 15,
    network: data.network,
    console: data.console
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = el('a');
  a.href = url;
  a.download = `blackbox-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function clear() {
  const scope = state.allTabs ? 'all tabs' : 'this tab';
  if (!confirm(`Clear everything recorded for ${scope}?`)) return;
  chrome.runtime.sendMessage({ type: 'clear', tabId: state.allTabs ? null : state.tabId }).catch(() => {});
}

async function init() {
  if (inPanel) {
    state.tabId = chrome.devtools.inspectedWindow.tabId;
    const readOrigin = () => chrome.devtools.inspectedWindow.eval('location.origin', origin => {
      state.tabOrigin = typeof origin === 'string' ? origin : null;
      queueRender();
    });
    readOrigin();
    chrome.devtools.network.onNavigated.addListener(readOrigin);
  } else {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    state.tabId = tab?.id ?? null;
    state.tabOrigin = tab?.url ? originOf(tab.url) : null;
  }

  for (const btn of document.querySelectorAll('[data-view]')) {
    btn.addEventListener('click', () => {
      state.view = btn.dataset.view;
      $('list').scrollTop = $('list').scrollHeight;
      render();
      $('list').scrollTop = $('list').scrollHeight;
    });
  }
  $('all-tabs').addEventListener('change', e => { state.allTabs = e.target.checked; render(); });
  $('download').addEventListener('click', download);
  $('clear').addEventListener('click', clear);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'session' && changes.log) {
      state.log = changes.log.newValue || { network: [], console: [] };
      queueRender();
    }
  });

  const { log } = await chrome.storage.session.get('log');
  if (log) state.log = log;
  render();
}

init();
