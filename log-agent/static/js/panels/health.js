// HealthPanel — updates header badge dots from /health response
class HealthPanel {
  updateBadges(h) {
    const lokiDot    = $id('loki-dot');
    const grafanaDot = $id('grafana-dot');
    if (lokiDot)    lokiDot.className    = 'dot ' + (h.loki_running    ? 'up' : 'down');
    if (grafanaDot) grafanaDot.className = 'dot ' + (h.grafana_running ? 'up' : 'down');
  }
}
window.HealthPanel = HealthPanel;
