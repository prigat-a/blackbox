// Inject console interceptor
const script = document.createElement('script');
script.textContent = `
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
                if (typeof arg === 'object') return JSON.stringify(arg);
                return String(arg);
            } catch (e) {
                return '[Unable to stringify]';
            }
        }

        Object.keys(originalMethods).forEach(method => {
            console[method] = function(...args) {
                originalMethods[method].apply(console, args);
                window.postMessage({
                    source: '__CONSOLE_INTERCEPTOR__',
                    type: method,
                    timestamp: Date.now(),
                    messages: args.map(stringify),
                    stack: new Error().stack
                }, '*');
            };
        });

        // Catch errors
        window.addEventListener('error', function(event) {
            window.postMessage({
                source: '__CONSOLE_INTERCEPTOR__',
                type: 'error',
                timestamp: Date.now(),
                messages: [event.message],
                stack: event.error?.stack || ''
            }, '*');
        });

        window.addEventListener('unhandledrejection', function(event) {
            window.postMessage({
                source: '__CONSOLE_INTERCEPTOR__',
                type: 'error',
                timestamp: Date.now(),
                messages: ['Unhandled Promise Rejection: ' + stringify(event.reason)],
                stack: event.reason?.stack || ''
            }, '*');
        });
    })();
`;
document.documentElement.appendChild(script);
document.documentElement.removeChild(script);

// Listen for console messages and relay to background
window.addEventListener('message', function(event) {
    if (event.data.source === '__CONSOLE_INTERCEPTOR__') {
        chrome.runtime.sendMessage({
            type: 'console',
            data: event.data
        });
    }
}); 