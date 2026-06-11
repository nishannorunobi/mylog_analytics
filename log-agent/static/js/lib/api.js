const Api = {
  async get(path) {
    const r = await fetch(path);
    return r.json();
  },
  async post(path, body = null) {
    const opts = { method: 'POST' };
    if (body !== null) {
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body    = JSON.stringify(body);
    }
    const r = await fetch(path, opts);
    return r.json();
  },

  // Stream SSE via POST; calls onLine(text) for each data line, onDone() on __done__
  async stream(path, { onLine, onDone, onError } = {}) {
    const res = await fetch(path, { method: 'POST' });
    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let partial   = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        partial += decoder.decode(value, { stream: true });
        const chunks = partial.split('\n\n');
        partial = chunks.pop();
        for (const chunk of chunks) {
          if (!chunk.startsWith('data: ')) continue;
          const line = chunk.slice(6);
          if (line === '__done__') { reader.cancel(); onDone?.(); return; }
          onLine?.(line);
        }
      }
    } catch (e) {
      onError?.(String(e));
    }
    onDone?.();
  },
};

window.Api = Api;
