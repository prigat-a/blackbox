// Runs in the extension's isolated world and forwards console entries from
// interceptor.js to the service worker, batched so a chatty page doesn't send
// one extension message per console call.
(() => {
  const SOURCE = '__BLACKBOX__';
  const FLUSH_MS = 250;
  const MAX_QUEUE = 500;
  let queue = [];
  let timer = null;

  function flush() {
    timer = null;
    const entries = queue;
    queue = [];
    try {
      chrome.runtime.sendMessage({ type: 'console', entries }).catch(() => {});
    } catch {
      // The extension was reloaded or removed; this page's copy is orphaned.
    }
  }

  window.addEventListener('message', event => {
    // Only accept messages this frame posted to itself. Without this check any
    // other frame on the page (an ad iframe, say) could post fake entries.
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== SOURCE) return;

    if (queue.length < MAX_QUEUE) {
      queue.push({ level: data.level, ts: data.ts, messages: data.messages, stack: data.stack });
    }
    if (!timer) timer = setTimeout(flush, FLUSH_MS);
  });

  // Don't lose the last batch when the page navigates away.
  window.addEventListener('pagehide', () => {
    if (queue.length) flush();
  });
})();
