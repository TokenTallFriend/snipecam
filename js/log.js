// On-screen log panel. There's no Safari Web Inspector without a Mac, so errors must be visible on the page.

export const MAX_LINES = 200;

const lines = [];
let panel = null;
let body = null;
let onError = null;

export function initLog(panelEl, { onError: errorCallback } = {}) {
  panel = panelEl;
  body = panel.querySelector('.log-body') ?? panel;
  onError = errorCallback ?? null;

  for (const level of ['error', 'warn']) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      original(...args);
      log(args.map(stringify).join(' '), level);
    };
  }
  window.addEventListener('error', (e) => {
    const where = e.filename ? ` (${e.filename.split('/').pop()}:${e.lineno})` : '';
    log(`${e.message}${where}`, 'error');
  });
  window.addEventListener('unhandledrejection', (e) => {
    log(`Unhandled rejection: ${stringify(e.reason)}`, 'error');
  });
}

function stringify(v) {
  if (v instanceof Error) {
    // Chrome's stack starts with "Name: message"; Safari/Firefox stacks are frames only. Normalize.
    const frame = v.stack?.split('\n').find((l) => /:\d+:\d+/.test(l))?.trim();
    return `${v.name}: ${v.message}${frame ? ` @ ${frame}` : ''}`;
  }
  if (typeof v === 'object' && v !== null) {
    try { return JSON.stringify(v); } catch { return String(v); }
  }
  return String(v);
}

export function log(msg, level = 'info') {
  const line = { time: new Date().toTimeString().slice(0, 8), level, msg: stringify(msg) };
  lines.push(line);
  if (lines.length > MAX_LINES) lines.shift();
  if (body) {
    const div = document.createElement('div');
    div.className = `log-${level}`;
    div.textContent = `${line.time} ${line.msg}`;
    body.append(div);
    while (body.childElementCount > MAX_LINES) body.firstElementChild.remove();
    body.scrollTop = body.scrollHeight;
  }
  if (level === 'error') onError?.(line);
}

export function toggleLog(show = panel?.hidden) {
  if (panel) panel.hidden = !show;
}

export function getLines() {
  return lines.slice();
}
