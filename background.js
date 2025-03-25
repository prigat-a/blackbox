let activityLog = {
  network: [],
  graphql: [],
  console: []
};

// Clear old data every 15 minutes
const FIFTEEN_MINUTES = 15 * 60 * 1000;

function cleanOldData() {
  const cutoffTime = Date.now() - FIFTEEN_MINUTES;
  Object.keys(activityLog).forEach(key => {
    activityLog[key] = activityLog[key].filter(item => item.timestamp > cutoffTime);
  });
  // Save to storage periodically
  chrome.storage.local.set({ activityLog });
}

// Run cleanup every minute
setInterval(cleanOldData, 60 * 1000);

// Load saved data on startup
chrome.storage.local.get(['activityLog'], (result) => {
  if (result.activityLog) {
    activityLog = result.activityLog;
    cleanOldData(); // Clean any old data immediately
  }
});

// Use declarativeNetRequest rules instead of webRequestBlocking
chrome.declarativeNetRequest.updateDynamicRules({
  removeRuleIds: [1],
  addRules: [{
    id: 1,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      responseHeaders: [{
        header: 'Access-Control-Allow-Origin',
        operation: 'set',
        value: '*'
      }]
    },
    condition: {
      urlFilter: '*graphql*',
      resourceTypes: ['xmlhttprequest']
    }
  }]
});

// Monitor network requests
chrome.webRequest.onCompleted.addListener(
  (details) => {
    const requestData = {
      url: details.url,
      method: details.method,
      timestamp: Date.now(),
      type: details.type,
      status: details.statusCode,
      tabId: details.tabId
    };

    // Store in network log
    activityLog.network.push(requestData);

    // Check for GraphQL requests
    if (details.url.includes('graphql')) {
      activityLog.graphql.push({
        ...requestData,
        graphql: true
      });
    }
  },
  { urls: ["<all_urls>"] }
);

// Handle messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'console':
      activityLog.console.push({
        ...message.data,
        tabId: sender.tab.id,
        url: sender.tab.url
      });
      break;
    case 'getLog':
      sendResponse(activityLog);
      return true;
    case 'clearLog':
      activityLog = {
        network: [],
        graphql: [],
        console: []
      };
      chrome.storage.local.set({ activityLog });
      break;
  }
}); 