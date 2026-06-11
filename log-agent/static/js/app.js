// LogApp — nav routing, panel wiring, auto-refresh
class LogApp {
  constructor() {
    this.log     = new LogPanel();
    this.health  = new HealthPanel();
    this.stack   = new StackPanel(this.log);
    this.explorer = new ExplorerPanel(this.log);
    this.grafana  = new GrafanaPanel(this.log);
    this.chat     = new ChatPanel();
    window._app  = this;
  }

  switchSection(name) {
    document.querySelectorAll('.section-panel').forEach(el => {
      el.style.display = el.dataset.section === name ? '' : 'none';
    });
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.section === name);
    });
    if (name === 'explorer') this.explorer.load();
  }

  async refresh() {
    try {
      const h = await Api.get('/health');
      this.health.updateBadges(h);
      this.stack.render(h);
      this.grafana.renderStatus(h);
    } catch (_) {}
  }

  start() {
    this.switchSection('stack');
    this.refresh();
    setInterval(() => this.refresh(), 15000);
    this.log._applyState();
  }
}

document.addEventListener('DOMContentLoaded', () => new LogApp().start());
