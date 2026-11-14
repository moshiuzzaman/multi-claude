'use strict';
// The tray icon (Windows) / menu-bar item (Mac): every account's Session and
// Weekly figures and running state, with Launch / Show / Close, without
// opening the window. It also keeps Multi-Claude running when its window is
// closed, so limit alerts and usage history keep working.
//
// Two layers, like cc-switch's tray: buildTrayModel() turns a snapshot into a
// plain-data menu (unit tested), and toTemplate() maps that onto Electron's
// Menu template with the actions wired in. Nothing here switches accounts.

const { readingsFor } = require('./alerts.js');

const WINDOW_SHORT = { session: 'S', weekly: 'W' };
// Windows cuts a tray tooltip at 127 characters.
const TOOLTIP_MAX = 127;

/** "S 37% · W 66%", "W 100% limit", or '' when nothing recent is known. */
function figures(row, now) {
  const parts = [];
  for (const r of readingsFor(row, now)) {
    const p = Math.round(r.percent);
    parts.push(`${WINDOW_SHORT[r.window]} ${p}%${p >= 100 ? ' limit' : ''}`);
  }
  return parts.join(' · ');
}

/**
 * The menu as data: [{ type: 'item'|'separator'|'header', label, action?,
 * id?, enabled?, submenu? }].
 *
 * snapshot: {
 *   accounts: [{ id, label, kind, exists }],
 *   running: Set of account ids (null when unknown),
 *   rows: limits() rows by account id (cached figures only),
 *   update: { state, latest } | null,
 *   platform: 'win32' | 'darwin'
 * }
 */
function buildTrayModel({ accounts = [], running = null, rows = new Map(), update = null, now = Date.now() }) {
  const items = [];
  items.push({ type: 'header', label: 'Multi-Claude' });
  items.push({ type: 'separator' });

  if (accounts.length === 0) {
    items.push({ type: 'item', label: 'No accounts yet', enabled: false });
  }
  for (const a of accounts) {
    const isRunning = running ? running.has(a.id) : false;
    const fig = figures(rows.get(a.id), now);
    const dot = running ? (isRunning ? '●' : '○') : '·';
    const label = `${dot}  ${a.label}${fig ? `     ${fig}` : ''}`;
    const sub = [];
    if (isRunning) {
      sub.push({ type: 'item', label: 'Show', action: 'show', id: a.id });
      sub.push({ type: 'item', label: 'Close', action: 'close', id: a.id });
    } else {
      sub.push({ type: 'item', label: 'Launch', action: 'launch', id: a.id, enabled: a.exists !== false || a.kind === 'default' });
    }
    sub.push({ type: 'separator' });
    sub.push({ type: 'item', label: 'Open its page', action: 'open-account', id: a.id });
    items.push({ type: 'item', label, submenu: sub });
  }

  items.push({ type: 'separator' });
  items.push({ type: 'item', label: 'Open Multi-Claude', action: 'open' });
  if (update && update.state === 'available' && update.latest) {
    items.push({ type: 'item', label: `Update to ${update.latest}…`, action: 'open' });
  } else {
    items.push({ type: 'item', label: 'Check for updates', action: 'check-updates' });
  }
  items.push({ type: 'separator' });
  items.push({ type: 'item', label: 'Quit Multi-Claude', action: 'quit' });
  return items;
}

/** The hover text: how many are running and each account's figures, cut to fit. */
function tooltip({ accounts = [], running = null, rows = new Map(), now = Date.now() }) {
  const count = running ? accounts.filter((a) => running.has(a.id)).length : 0;
  const lines = [`Multi-Claude${running ? ` · ${count} running` : ''}`];
  for (const a of accounts) {
    const fig = figures(rows.get(a.id), now);
    if (fig) lines.push(`${a.label}: ${fig}`);
  }
  let text = '';
  for (const line of lines) {
    const next = text ? `${text}\n${line}` : line;
    if (next.length > TOOLTIP_MAX) break;
    text = next;
  }
  return text;
}

/** Electron Menu template from the model; `run(action, id)` does the work. */
function toTemplate(model, run) {
  return model.map((it) => {
    if (it.type === 'separator') return { type: 'separator' };
    if (it.type === 'header') return { label: it.label, enabled: false };
    const t = { label: it.label, enabled: it.enabled !== false };
    if (it.submenu) t.submenu = toTemplate(it.submenu, run);
    else if (it.action) t.click = () => run(it.action, it.id);
    return t;
  });
}

module.exports = { buildTrayModel, tooltip, toTemplate, figures, TOOLTIP_MAX };
