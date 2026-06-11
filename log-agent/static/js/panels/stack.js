// StackPanel — Loki / Promtail / Grafana service cards
class StackPanel {
  constructor(log) { this._log = log; }

  render(h) {
    this._renderService('loki',     h.loki_running,    h.loki_reachable);
    this._renderService('promtail', h.promtail_running, null);
    this._renderService('grafana',  h.grafana_running,  null);
  }

  _renderService(name, running, reachable) {
    const badge = $id(`${name}-status-badge`);
    const startBtn = $id(`${name}-start-btn`);
    const stopBtn  = $id(`${name}-stop-btn`);

    if (badge) {
      const extra = name === 'loki' && running && reachable === false ? ' (starting…)' : '';
      badge.className  = 'service-status ' + (running ? 'up' : 'down');
      badge.textContent = running ? `● Running${extra}` : '○ Stopped';
    }
    if (startBtn && !startBtn._origHTML) startBtn.disabled = running;
    if (stopBtn  && !stopBtn._origHTML)  stopBtn.disabled  = !running;
  }

  async startService(name, label, btn) {
    const ok = await this._log.run(`/api/stream/${name}/start`, `Start ${label}`, btn);
    if (ok) await window._app.refresh();
  }

  async stopService(name, label, btn) {
    await this._log.run(`/api/stream/${name}/stop`, `Stop ${label}`, btn);
    await window._app.refresh();
  }
}
window.StackPanel = StackPanel;
