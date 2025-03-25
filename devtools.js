// Store a reference to the original console methods
const originalConsole = {
    log: console.log,
    error: console.error,
    warn: console.warn,
    info: console.info
};

// Create panel
chrome.devtools.panels.create(
    "Activity Recorder",
    null,
    "panel.html",
    function(panel) {}
);

// Monitor network requests
chrome.devtools.network.onRequestFinished.addListener(function(request) {
    const requestData = {
        url: request.request.url,
        method: request.request.method,
        headers: request.request.headers,
        timestamp: Date.now(),
        type: request.type,
        status: request.response.status,
        statusText: request.response.statusText,
        timing: request.time,
        resourceType: request._resourceType,
        size: {
            request: request.request.bodySize,
            response: request.response.bodySize
        }
    };

    // For GraphQL requests, add additional info
    if (request.request.url.includes('graphql')) {
        requestData.graphql = true;
        requestData.postData = request.request.postData;
        
        request.getContent((content, encoding) => {
            try {
                requestData.response = JSON.parse(content);
            } catch (e) {
                requestData.response = content;
            }
            chrome.runtime.sendMessage({
                type: 'graphql',
                data: requestData
            });
        });
    }

    chrome.runtime.sendMessage({
        type: 'network',
        data: requestData
    });
});

// Monitor console logs
function interceptConsole() {
    const sendConsoleMessage = (type, args) => {
        const stackTrace = new Error().stack;
        chrome.runtime.sendMessage({
            type: 'console',
            data: {
                type: type,
                timestamp: Date.now(),
                messages: Array.from(args).map(arg => {
                    try {
                        return typeof arg === 'object' ? JSON.stringify(arg) : String(arg);
                    } catch (e) {
                        return '[Unable to stringify]';
                    }
                }),
                stack: stackTrace,
                source: window.location.href
            }
        });
    };

    // Override console methods
    console.log = function() {
        sendConsoleMessage('log', arguments);
        originalConsole.log.apply(console, arguments);
    };
    console.error = function() {
        sendConsoleMessage('error', arguments);
        originalConsole.error.apply(console, arguments);
    };
    console.warn = function() {
        sendConsoleMessage('warn', arguments);
        originalConsole.warn.apply(console, arguments);
    };
    console.info = function() {
        sendConsoleMessage('info', arguments);
        originalConsole.info.apply(console, arguments);
    };
}

// Inject console interceptor
chrome.devtools.inspectedWindow.eval(
    `(${interceptConsole.toString()})()`,
    { useContentScriptContext: true }
);

// Console interceptor code
const consoleInterceptor = `
    (function() {
        if (window.__console_interceptor_installed) return;
        window.__console_interceptor_installed = true;

        const originalMethods = {
            log: console.log,
            error: console.error,
            warn: console.warn,
            info: console.info,
            debug: console.debug
        };

        function stringify(arg) {
            try {
                if (arg === undefined) return 'undefined';
                if (arg === null) return 'null';
                if (typeof arg === 'object') {
                    return JSON.stringify(arg);
                }
                return String(arg);
            } catch (e) {
                return '[Unable to stringify]';
            }
        }

        Object.keys(originalMethods).forEach(method => {
            console[method] = function(...args) {
                // Call original method
                originalMethods[method].apply(console, args);

                // Send to our extension
                window.postMessage({
                    source: '__CONSOLE_INTERCEPTOR__',
                    type: method,
                    timestamp: Date.now(),
                    messages: args.map(stringify),
                    stack: new Error().stack,
                    url: window.location.href
                }, '*');
            };
        });

        // Catch unhandled errors and promise rejections
        window.addEventListener('error', function(event) {
            window.postMessage({
                source: '__CONSOLE_INTERCEPTOR__',
                type: 'error',
                timestamp: Date.now(),
                messages: [event.message],
                stack: event.error?.stack || '',
                url: window.location.href
            }, '*');
        });

        window.addEventListener('unhandledrejection', function(event) {
            window.postMessage({
                source: '__CONSOLE_INTERCEPTOR__',
                type: 'error',
                timestamp: Date.now(),
                messages: ['Unhandled Promise Rejection: ' + stringify(event.reason)],
                stack: event.reason?.stack || '',
                url: window.location.href
            }, '*');
        });
    })();
`;

// Inject the console interceptor
function injectScript() {
    chrome.devtools.inspectedWindow.eval(consoleInterceptor, function(result, isException) {
        if (isException) {
            console.error('Failed to inject console interceptor:', isException);
        }
    });
}

// Inject on page load
injectScript();

// Listen for console messages
window.addEventListener('message', function(event) {
    if (event.data.source === '__CONSOLE_INTERCEPTOR__') {
        chrome.runtime.sendMessage({
            type: 'console',
            data: {
                type: event.data.type,
                timestamp: event.data.timestamp,
                messages: event.data.messages,
                stack: event.data.stack,
                source: event.data.url
            }
        });
    }
});

// Create a content script to relay messages
const contentScriptCode = `
    window.addEventListener('message', function(event) {
        if (event.data.source === '__CONSOLE_INTERCEPTOR__') {
            chrome.runtime.sendMessage({
                type: 'console',
                data: event.data
            });
        }
    });
`;

// Inject the content script
chrome.devtools.inspectedWindow.eval(`
    if (!window.__content_script_installed) {
        window.__content_script_installed = true;
        ${contentScriptCode}
    }
`); 