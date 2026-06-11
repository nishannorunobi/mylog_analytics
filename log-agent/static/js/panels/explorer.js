// ExplorerPanel — LogQL query UI against Loki
class ExplorerPanel {
  constructor(log) {
    this._log    = log;
    this._labels = [];
  }

  async load() {
    await this._loadLabels();
  }

  async _loadLabels() {
    const wrap = $id('label-chips');
    if (!wrap) return;
    try {
      const data = await Api.get('/api/loki/labels');
      this._labels = data.data || [];
      wrap.innerHTML = '';
      this._labels.forEach(l => {
        const chip = document.createElement('span');
        chip.className   = 'label-chip';
        chip.textContent = l;
        chip.onclick = () => this._insertLabel(l, chip);
        wrap.appendChild(chip);
      });
    } catch (_) {
      if (wrap) wrap.innerHTML = '<span style="color:var(--text3);font-size:12px">Could not load labels — is Loki running?</span>';
    }
  }

  _insertLabel(label, chip) {
    const inp = $id('logql-input');
    if (!inp) return;
    const cur = inp.value.trim();
    if (!cur) {
      inp.value = `{container="${label}"}`;
    } else {
      inp.value = cur;
    }
    document.querySelectorAll('.label-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    inp.focus();
  }

  setQuery(q) {
    const inp = $id('logql-input');
    if (inp) { inp.value = q; inp.focus(); }
  }

  async run(btn) {
    const query = ($id('logql-input')?.value || '').trim();
    if (!query) return;

    const since  = $id('logql-since')?.value  || '1h';
    const limit  = parseInt($id('logql-limit')?.value || '100', 10);
    const dir    = $id('logql-dir')?.value    || 'backward';

    const now   = Math.floor(Date.now() / 1000);
    const durations = { '15m': 900, '1h': 3600, '3h': 10800, '6h': 21600, '12h': 43200, '24h': 86400 };
    const offset = durations[since] || 3600;

    if (btn) setSpinner(btn, true);
    const results = $id('explorer-results');
    if (results) results.innerHTML = '<div class="explorer-empty">Querying Loki…</div>';

    try {
      const data = await Api.post('/api/loki/query_range', {
        query,
        limit,
        direction: dir,
        start: String((now - offset) * 1e9),
        end:   String(now * 1e9),
      });
      this._renderResults(data, results);
    } catch (e) {
      if (results) results.innerHTML = `<div class="explorer-empty" style="color:var(--red)">${esc(String(e))}</div>`;
    }

    if (btn) setSpinner(btn, false);
  }

  _renderResults(data, wrap) {
    if (!wrap) return;
    if (data.status !== 'success') {
      wrap.innerHTML = `<div class="explorer-empty" style="color:var(--red)">Error: ${esc(data.message || JSON.stringify(data))}</div>`;
      return;
    }
    const streams = data.data?.result || [];
    if (!streams.length) {
      wrap.innerHTML = '<div class="explorer-empty">No logs found for this query and time range.</div>';
      return;
    }

    // Flatten all log entries and sort by timestamp
    const entries = [];
    streams.forEach(stream => {
      const labels = stream.stream || {};
      const labelStr = Object.entries(labels).map(([k, v]) => `${k}="${v}"`).join(', ');
      (stream.values || []).forEach(([ts, msg]) => {
        entries.push({ ts: BigInt(ts), tsDisplay: this._formatTs(ts), labels: labelStr, msg });
      });
    });
    entries.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));

    const header = document.createElement('div');
    header.className = 'explorer-results-header';
    header.innerHTML = `<span>${entries.length} log line${entries.length !== 1 ? 's' : ''}</span><span style="font-family:var(--mono)">${esc(streams.length)} stream${streams.length !== 1 ? 's' : ''}</span>`;

    const list = document.createElement('div');
    entries.forEach(({ tsDisplay, labels, msg }) => {
      const row = document.createElement('div');
      row.className = 'log-entry';
      const msgClass = /error|fail|critical|fatal/i.test(msg) ? 'err'
                     : /warn/i.test(msg) ? 'warn'
                     : /ok|success|ready|started/i.test(msg) ? 'ok' : '';
      row.innerHTML = `
        <span class="log-ts">${esc(tsDisplay)}</span>
        <span class="log-stream-labels">[${esc(labels.split(',')[0] || '')}]</span>
        <span class="log-msg ${msgClass}">${esc(msg)}</span>`;
      list.appendChild(row);
    });

    wrap.innerHTML = '';
    wrap.appendChild(header);
    wrap.appendChild(list);
  }

  _formatTs(nsStr) {
    const ms = Number(BigInt(nsStr) / 1000000n);
    const d  = new Date(ms);
    return d.toLocaleTimeString('en-GB', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
  }
}
window.ExplorerPanel = ExplorerPanel;
