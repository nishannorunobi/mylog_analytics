// ChatPanel — WebSocket chat with the AI agent
class ChatPanel {
  constructor() {
    this._ws   = null;
    this._busy = false;
    this._connect();
  }

  _connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this._ws = new WebSocket(`${proto}://${location.host}/ws/chat`);
    this._ws.onmessage = e => this._onMsg(JSON.parse(e.data));
    this._ws.onclose   = () => setTimeout(() => this._connect(), 3000);
    this._ws.onerror   = () => this._ws.close();
  }

  _onMsg(d) {
    if      (d.type === 'history_msg') this._append(d.role, d.content, d.ts);
    else if (d.type === 'text')        this._extend('assistant', d.content);
    else if (d.type === 'tool_call')   this._append('tool', `⚙ ${d.name}(${JSON.stringify(d.input)})`);
    else if (d.type === 'tool_result') this._append('tool', `↩ ${d.name}: ${JSON.stringify(d.result).slice(0,200)}`);
    else if (d.type === 'error')       { this._append('error', d.content); this._busy_(false); }
    else if (d.type === 'done')        this._busy_(false);
  }

  send() {
    const inp  = $id('chat-input');
    const text = inp?.value.trim();
    if (!text || this._busy) return;
    inp.value = '';
    this._busy_(true);
    this._append('user', text);
    if (this._ws?.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify({ content: text }));
    } else {
      this._append('error', 'WebSocket not connected — reconnecting…');
      this._busy_(false);
    }
  }

  keydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.send(); }
  }

  async clear() {
    try { await Api.post('/api/chat/clear'); } catch (_) {}
    const msgs = $id('chat-msgs');
    if (msgs) msgs.innerHTML = '<div class="chat-empty">Start a conversation…</div>';
    this._ws?.close();
  }

  _msgs() { return $id('chat-msgs'); }

  _append(role, text, ts) {
    const msgs = this._msgs();
    if (!msgs) return;
    msgs.querySelectorAll('.chat-empty').forEach(n => n.remove());
    const div  = document.createElement('div');
    div.className    = 'msg ' + role;
    div.dataset.role = role;
    if (ts) {
      const s = document.createElement('span');
      s.className   = 'msg-ts';
      s.textContent = ts;
      div.appendChild(s);
    }
    const b = document.createElement('span');
    b.textContent = text;
    div.appendChild(b);
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
  }

  _extend(role, text) {
    const msgs = this._msgs();
    const last = msgs?.lastElementChild;
    if (last?.dataset.role === role) {
      last.querySelector('span').textContent += text;
      msgs.scrollTop = msgs.scrollHeight;
    } else {
      this._append(role, text);
    }
  }

  _busy_(on) {
    this._busy = on;
    const s = $id('chat-send');
    const i = $id('chat-input');
    if (s) s.disabled = on;
    if (i) i.disabled = on;
  }
}

window.ChatPanel = ChatPanel;
