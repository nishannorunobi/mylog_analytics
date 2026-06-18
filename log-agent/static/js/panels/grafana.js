// GrafanaPanel — Grafana browser link + status
class GrafanaPanel {
  constructor(log) { this._log = log; }

  renderStatus(h) {
    const badge    = $id('grafana-ui-badge');
    const startBtn = $id('grafana-start-btn');
    const stopBtn  = $id('grafana-stop-btn');
    const up       = h.grafana_running;

    if (badge) {
      badge.className   = 'server-status-badge ' + (up ? 'up' : 'down');
      badge.textContent = up ? '● RUNNING' : '● STOPPED';
    }
    if (startBtn && !startBtn._origHTML) startBtn.disabled = up;
    if (stopBtn  && !stopBtn._origHTML)  stopBtn.disabled  = !up;
  }

  async start(btn) {
    const ok = await this._log.run('/api/tools/grafana/start', 'Start Grafana', btn);
    if (ok) await window._app.refresh();
  }

  async stop(btn) {
    await this._log.run('/api/tools/grafana/stop', 'Stop Grafana', btn);
    await window._app.refresh();
  }
}
window.GrafanaPanel = GrafanaPanel;
