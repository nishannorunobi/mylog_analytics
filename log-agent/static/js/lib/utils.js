function esc(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function $id(id) { return document.getElementById(id); }
function nowTs() { return new Date().toLocaleTimeString(); }

function setSpinner(btn, on) {
  if (!btn) return;
  if (on) {
    btn._origHTML = btn.innerHTML;
    btn.innerHTML = '<span class="spinner"></span> Running…';
    btn.disabled  = true;
  } else {
    if (btn._origHTML !== undefined) btn.innerHTML = btn._origHTML;
    btn.disabled = false;
  }
}

window.esc        = esc;
window.$id        = $id;
window.nowTs      = nowTs;
window.setSpinner = setSpinner;
