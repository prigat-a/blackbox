// DevTools page: adds the Blackbox panel and fills in GraphQL response bodies,
// the one thing the service worker's webRequest listeners can't see. Console
// and network capture happen elsewhere, so they work with DevTools closed.

chrome.devtools.panels.create('Blackbox', '', 'panel.html');

const tabId = chrome.devtools.inspectedWindow.tabId;
const MAX_RESPONSE_CHARS = 500000;

// Same rules as background.js: a real query in the body, or a POST to a
// /graphql or /gql path. A body fingerprint lets the service worker attach the
// response to the right request, since they often share one URL.
function looksLikeGraphQL(request) {
  const body = request.postData?.text;
  if (typeof body === 'string' && body.length < 1000000 &&
      /"(query"\s*:\s*"\s*(#|query|mutation|subscription|fragment|\{)|extensions"\s*:|doc_?[iI]d")/.test(body)) return true;
  try {
    const url = new URL(request.url);
    if (request.method === 'GET') return url.searchParams.has('query') || url.searchParams.has('extensions');
    return request.method === 'POST' && /(^|\/)(graphql|gql)(\/|$)/i.test(url.pathname);
  } catch {
    return false;
  }
}

function fingerprint(text) {
  if (!text) return null;
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36) + ':' + text.length;
}

chrome.devtools.network.onRequestFinished.addListener(entry => {
  if (!looksLikeGraphQL(entry.request)) return;
  entry.getContent(content => {
    chrome.runtime.sendMessage({
      type: 'graphqlResponse',
      data: {
        tabId,
        url: entry.request.url,
        method: entry.request.method,
        bodyKey: fingerprint(entry.request.postData?.text),
        finishedMs: Date.parse(entry.startedDateTime) + (entry.time || 0),
        response: typeof content === 'string' ? content.slice(0, MAX_RESPONSE_CHARS) : ''
      }
    }).catch(() => {});
  });
});
