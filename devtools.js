// DevTools page: adds the Blackbox panel and fills in GraphQL response bodies,
// the one thing the service worker's webRequest listeners can't see. Console
// and network capture happen elsewhere, so they work with DevTools closed.

chrome.devtools.panels.create('Blackbox', '', 'panel.html');

const tabId = chrome.devtools.inspectedWindow.tabId;
const MAX_RESPONSE_CHARS = 500000;

function looksLikeGraphQL(request) {
  if (/graphql/i.test(request.url)) return true;
  const body = request.postData?.text;
  return typeof body === 'string' && body.length < 1000000 &&
    /"query"\s*:\s*"\s*(query|mutation|subscription|\{)/.test(body);
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
        finishedMs: Date.parse(entry.startedDateTime) + (entry.time || 0),
        response: typeof content === 'string' ? content.slice(0, MAX_RESPONSE_CHARS) : ''
      }
    }).catch(() => {});
  });
});
