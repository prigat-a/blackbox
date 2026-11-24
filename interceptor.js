// Runs in the page's own JavaScript world ("world": "MAIN" in the manifest), so
// it can wrap the page's console even on sites whose CSP blocks inline scripts.
// It has no extension APIs: it hands entries to relay.js with postMessage.
(() => {
  const SOURCE = '__BLACKBOX__';
  const MAX_ARG = 2000;
  // Keep our own references so a page that later replaces these can't break us.
  const post = window.postMessage.bind(window);
  const stringifyJSON = JSON.stringify;
  const now = Date.now;

  function describe(arg) {
    try {
      if (arg === undefined) return 'undefined';
      if (arg === null) return 'null';
      if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
      if (typeof Node !== 'undefined' && arg instanceof Node) {
        return arg.nodeType === 1 ? `<${arg.nodeName.toLowerCase()}${arg.id ? '#' + arg.id : ''}>` : `[${arg.nodeName}]`;
      }
      if (typeof arg === 'function') return `[function ${arg.name || 'anonymous'}]`;
      if (typeof arg === 'symbol' || typeof arg === 'bigint') return arg.toString();
      if (typeof arg !== 'object') return String(arg);

      // Cycle-safe and size-bounded: stop serialising once we have enough.
      const seen = new WeakSet();
      let budget = MAX_ARG * 4;
      const text = stringifyJSON(arg, (key, value) => {
        if (--budget < 0) return undefined;
        if (typeof value === 'bigint') return value.toString();
        if (value && typeof value === 'object') {
          if (seen.has(value)) return '[circular]';
          seen.add(value);
        }
        return value;
      });
      return text === undefined ? String(arg) : text;
    } catch {
      return '[unserialisable]';
    }
  }

  // Apply console format specifiers (%s %d %i %f %o %O %c) the way DevTools
  // does, so "Loaded %s in %dms" is stored as one readable message.
  function format(args) {
    if (typeof args[0] !== 'string' || !args[0].includes('%')) return args.map(a => clip(describe(a)));
    let i = 1;
    const head = args[0].replace(/%([sdifoOc%])/g, (match, spec) => {
      if (spec === '%') return '%';
      if (i >= args.length) return match;
      const arg = args[i++];
      if (spec === 'c') return '';
      if (spec === 'd' || spec === 'i') return String(parseInt(arg, 10));
      if (spec === 'f') return String(parseFloat(arg));
      return describe(arg);
    });
    return [head, ...args.slice(i).map(describe)].map(clip);
  }

  function clip(text) {
    return text.length > MAX_ARG ? text.slice(0, MAX_ARG) + '…' : text;
  }

  let sending = false;
  function emit(level, messages, stack) {
    if (sending) return; // a console call made while serialising (e.g. a getter)
    sending = true;
    try {
      post({ source: SOURCE, level, ts: now(), messages, stack: stack || null }, '*');
    } catch {
      // Ignore: never let recording break the page.
    } finally {
      sending = false;
    }
  }

  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    const original = console[level];
    if (typeof original !== 'function') continue;
    console[level] = function (...args) {
      try {
        // Stack traces are costly; only collect them where they matter.
        const stack = level === 'error' || level === 'warn'
          ? (new Error().stack || '').split('\n').slice(2).join('\n')
          : null;
        emit(level, format(args), stack);
      } catch {}
      return original.apply(this, args);
    };
  }

  window.addEventListener('error', event => {
    emit('error', [clip(`Uncaught ${event.message}`)], event.error?.stack || `${event.filename}:${event.lineno}:${event.colno}`);
  });

  window.addEventListener('unhandledrejection', event => {
    emit('error', [clip('Unhandled promise rejection: ' + describe(event.reason))], event.reason?.stack || null);
  });
})();
