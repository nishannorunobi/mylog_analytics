// StackPanel — dynamic tool manager. Discovers tools from /api/tools and renders
// a card per tool with Build / Start / Stop / Health / Clean actions. Adding a tool
// folder on the agent makes it appear here automatically — no UI change needed.
class StackPanel {
  constructor(log) { this._log = log; }

  // Called on boot and on every auto-refresh. (The /health arg is unused; tool
  // state comes from /api/tools, which reflects every discovered tool.)
  async render() {
    const grid = $id('tools-grid');
    if (!grid) return;
    // Whole render is guarded so a fetch error OR a card-build error surfaces a
    // message instead of leaving the grid silently stuck on "Loading tools…".
    try {
      const data  = await Api.get('/api/tools');
      const tools = data.tools || [];
      grid.innerHTML = tools.length
        ? tools.map(t => this._card(t)).join('')
        : '<div class="field-row" style="color:var(--text3)">No tools found in tools/.</div>';
    } catch (e) {
      grid.innerHTML = `<div class="field-row" style="color:var(--red)">Failed to load tools: ${esc(String(e))}</div>`;
    }
  }

  _card(t) {
    const up    = !!t.running;
    const has   = a => (t.actions || []).includes(a);
    const act   = (a, label, cls) => has(a)
      ? `<button class="btn ${cls}" onclick="window._app.stack.action('${t.name}','${a}','${esc(t.label)}',this)">${label}</button>`
      : '';
    const open  = t.port ? `<a href="http://localhost:${esc(t.port)}" target="_blank" class="btn btn-ghost">↗ Open</a>` : '';
    return `
      <div class="service-card">
        <div class="service-card-inner">
          <div class="service-card-body">
            <div class="service-card-head">
              <span class="service-name">${esc(t.label)}</span>
              ${t.port ? `<span class="service-port">:${esc(t.port)}</span>` : ''}
            </div>
            <div class="service-status ${up ? 'up' : 'down'}">${up ? '● Running' : '○ Stopped'}</div>
            <div class="service-actions">
              ${act('build',  '⚙ Build',  'btn-ghost')}
              ${act('start',  '▶ Start',  'btn-start')}
              ${act('stop',   '■ Stop',   'btn-stop')}
              ${act('health', '⚡ Health', 'btn-ghost')}
              ${act('clean',  '🗑 Clean',  'btn-ghost')}
              ${open}
            </div>
          </div>
        </div>
      </div>`;
  }

  async action(name, action, label, btn) {
    const verb = action.charAt(0).toUpperCase() + action.slice(1);
    await this._log.run(`/api/tools/${name}/${action}`, `${verb} ${label}`, btn);
    this.render();            // refresh running status after the action
  }
}
window.StackPanel = StackPanel;
