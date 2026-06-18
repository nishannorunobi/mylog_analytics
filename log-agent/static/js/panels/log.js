// LogPanel — collapsible bottom log with rolling SSE output
class LogPanel {
  constructor() {
    this._expanded = false;
    this._running  = false;
    this._lines    = 0;
  }

  toggle() {
    this._expanded = !this._expanded;
    this._applyState();
  }

  expand() {
    this._expanded = true;
    this._applyState();
  }

  _applyState() {
    const panel = $id('log-panel');
    if (!panel) return;
    panel.classList.toggle('expanded',  this._expanded);
    panel.classList.toggle('collapsed', !this._expanded);
    $id('log-toggle-btn').textContent = this._expanded ? '⌄' : '⌃';
  }

  clear() {
    const body = $id('log-body');
    if (body) body.innerHTML = '<div class="log-empty">No actions run yet.</div>';
    this._lines   = 0;
    this._running = false;
    this._setBadge(null);
  }

  // Called before starting a new streaming action
  startAction(label) {
    this.expand();
    const body = $id('log-body');
    if (!body) return;
    body.querySelectorAll('.log-empty').forEach(n => n.remove());

    const hdr = document.createElement('div');
    hdr.className = 'log-run-header';
    hdr.id        = 'log-run-current';
    hdr.textContent = `▶ ${label}  [${nowTs()}]`;
    body.appendChild(hdr);
    body.scrollTop = body.scrollHeight;

    this._running = true;
    this._setBadge('running');
  }

  appendLine(raw) {
    const body = $id('log-body');
    if (!body) return;

    const div = document.createElement('div');
    div.className = 'log-line ' + this._lineClass(raw);
    div.textContent = raw;
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
    this._lines++;
  }

  endAction(success) {
    const body = $id('log-body');
    if (body) {
      const div = document.createElement('div');
      div.className   = 'log-line done';
      div.textContent = `── ${success ? 'completed' : 'finished with errors'} [${nowTs()}] ──`;
      body.appendChild(div);
      body.scrollTop = body.scrollHeight;
    }
    this._running = false;
    this._setBadge(success ? null : 'error');
  }

  _lineClass(line) {
    const l = line.toLowerCase();
    if (/error|traceback|exception|failed|critical|\[exit [^0]/.test(l)) return 'err';
    if (/warning|warn/.test(l)) return 'warn';
    if (/ok\s*\]|success|done|ready|running|created|applied/.test(l)) return 'ok';
    return '';
  }

  _setBadge(state) {
    const badge = $id('log-badge');
    if (!badge) return;
    if (state === 'running') {
      badge.className   = 'log-badge running';
      badge.textContent = '● Running';
    } else if (state === 'error') {
      badge.className   = 'log-badge';
      badge.style.color = 'var(--red)';
      badge.textContent = '! Errors';
    } else {
      badge.className   = 'log-badge';
      badge.style.color = '';
      badge.textContent = `${this._lines} lines`;
    }
  }

  // Run a streaming action end-to-end
  async run(path, label, btn) {
    if (btn) setSpinner(btn, true);
    this.startAction(label);
    let success = true;
    try {
      await Api.stream(path, {
        onLine:  line => {
          this.appendLine(line);
          if (/error|failed|critical|\[exit [^0]/i.test(line)) success = false;
        },
        onDone:  () => this.endAction(success),
        onError: msg => { this.appendLine('[STREAM ERROR] ' + msg); success = false; this.endAction(false); },
      });
    } catch (e) {
      this.appendLine('[STREAM ERROR] ' + String(e)); success = false; this.endAction(false);
    } finally {
      if (btn) setSpinner(btn, false);   // always reset the button, even on error
    }
    return success;
  }
}

window.LogPanel = LogPanel;
