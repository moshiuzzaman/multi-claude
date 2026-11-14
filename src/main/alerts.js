'use strict';
// Limit alerts: decide which notifications to show from each account's newest
// usage figures. Pure: no timers, no files, no Electron. The service keeps the
// state, saves it, and shows what this returns.
//
// Per account and per window (Session, Weekly):
//   - a threshold alerts only when usage crosses it going up;
//   - a jump past several thresholds shows one alert, for the highest, and the
//     lower ones count as done;
//   - a threshold is re-armed when usage drops back below it (after a reset);
//   - figures older than the last one seen are ignored, so a stale record can't
//     re-arm a threshold that a fresher one already passed.
// Information only: nothing here switches, launches or closes anything.

const WINDOWS = ['session', 'weekly'];
const WINDOW_NAME = { session: 'Session', weekly: 'Weekly' };
// 100 is always on while alerts are on: it is "limit reached".
const LIMIT = 100;
const THRESHOLD_CHOICES = [50, 60, 70, 80, 90, 95];
const DEFAULT_THRESHOLDS = [80, 95];

// The Claude window's own record can be hours old. A Session figure older than
// one session has already reset; a Weekly one is still useful for a day.
const MAX_AGE_MS = { session: 5 * 60 * 60 * 1000, weekly: 24 * 60 * 60 * 1000 };

/** The alert settings, with anything missing or bad replaced by the defaults. */
function normaliseSettings(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  // An empty list is allowed: then only "limit reached" alerts.
  const thresholds = Array.isArray(r.thresholds)
    ? [...new Set(r.thresholds.map(Number).filter((n) => THRESHOLD_CHOICES.includes(n)))].sort((a, b) => a - b)
    : DEFAULT_THRESHOLDS.slice();
  return {
    on: r.on !== false,
    thresholds,
    reset: r.reset === true
  };
}

/**
 * The figures one limits() row gives, as
 * [{ window, percent, resetsAt, observedAt, live }]. Live figures from Claude
 * Code are preferred; otherwise what the account's Claude window recorded, if
 * it is recent enough to mean anything.
 */
function readingsFor(row, now) {
  if (!row) return [];
  const plan = row.plan;
  if (plan && plan.ok && Array.isArray(plan.meters)) {
    const at = Number(plan.fetchedAt) || now;
    const out = [];
    for (const [window, kind] of [['session', 'session'], ['weekly', 'weekly_all']]) {
      const m = plan.meters.find((x) => x && x.kind === kind);
      if (!m || !Number.isFinite(m.percent)) continue;
      out.push({ window, percent: m.percent, resetsAt: m.resetsAt || null, observedAt: at, live: true });
    }
    if (out.length > 0) return out;
  }
  const d = row.desktop;
  if (!d || !Number.isFinite(d.recordedAt)) return [];
  const out = [];
  for (const window of WINDOWS) {
    const p = d[window];
    if (!Number.isFinite(p)) continue;
    if (now - d.recordedAt > MAX_AGE_MS[window]) continue;
    out.push({ window, percent: p, resetsAt: null, observedAt: d.recordedAt, live: false });
  }
  return out;
}

/**
 * One account window's next state and the alert to show, if any.
 *
 * prior: { last, observedAt, fired: number[] } or undefined (never seen).
 * Returns { state, alert } where alert is null or
 * { type: 'threshold', threshold, percent, resetsAt } | { type: 'reset' }.
 */
function step(prior, reading, settings) {
  if (prior && Number.isFinite(prior.observedAt) && reading.observedAt < prior.observedAt) {
    return { state: prior, alert: null };
  }
  const levels = [...settings.thresholds, LIMIT];
  const fired = new Set(prior && Array.isArray(prior.fired) ? prior.fired : []);
  const last = prior && Number.isFinite(prior.last) ? prior.last : null;
  const pct = reading.percent;

  // Usage went back below a level: it can alert again next time it climbs.
  for (const t of [...fired]) if (pct < t) fired.delete(t);

  let alert = null;
  const crossed = levels.filter((t) => pct >= t && !fired.has(t) && (last === null || last < t));
  if (crossed.length > 0) {
    const top = Math.max(...crossed);
    for (const t of levels) if (t <= top) fired.add(t);
    alert = { type: 'threshold', threshold: top, percent: pct, resetsAt: reading.resetsAt };
  } else if (settings.reset && last !== null && last >= LIMIT && pct < LIMIT) {
    alert = { type: 'reset' };
  }
  // A level that is no longer chosen is forgotten.
  for (const t of [...fired]) if (!levels.includes(t)) fired.delete(t);

  return {
    state: { last: pct, observedAt: reading.observedAt, fired: [...fired].sort((a, b) => a - b) },
    alert
  };
}

/**
 * Run every account's newest figures through the rules.
 *
 * state: { [accountId]: { session?, weekly? } }, as returned last time.
 * rows: the accounts array of a limits() result.
 * accounts: the account list, for labels and mutes.
 * Returns { state, alerts: [{ id, label, window, ...alert }], changed }.
 * A muted account's state is still kept up to date, so unmuting it doesn't
 * bring a pile of old alerts.
 */
function evaluate(state, rows, accounts, settings, now) {
  const s = normaliseSettings(settings);
  const next = {};
  const alerts = [];
  let changed = false;
  const byId = new Map((accounts || []).map((a) => [a.id, a]));

  for (const row of rows || []) {
    const account = byId.get(row.id);
    if (!account) continue;
    const before = (state && state[row.id]) || {};
    const after = { ...before };
    for (const r of readingsFor(row, now)) {
      const { state: ws, alert } = step(before[r.window], r, s);
      if (JSON.stringify(ws) !== JSON.stringify(before[r.window])) changed = true;
      after[r.window] = ws;
      if (alert && s.on && account.muteAlerts !== true) {
        alerts.push({ id: account.id, label: account.label, window: r.window, ...alert });
      }
    }
    next[row.id] = after;
  }
  // Accounts in the old state but not in this result are kept (a failed read
  // is not a reset), unless the account itself is gone.
  for (const [id, v] of Object.entries(state || {})) {
    if (!(id in next) && byId.has(id)) next[id] = v;
    else if (!byId.has(id)) changed = true;
  }
  return { state: next, alerts, changed };
}

function duration(ms) {
  const mins = Math.max(1, Math.round(ms / 60000));
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** "Resets in 2h 10m" or "Resets Mon 09:00", or '' when the time isn't known. */
function resetText(resetsAt, now) {
  if (!Number.isFinite(resetsAt) || resetsAt <= now) return '';
  if (resetsAt - now < 24 * 60 * 60 * 1000) return `Resets in ${duration(resetsAt - now)}`;
  const d = new Date(resetsAt);
  const day = d.toLocaleDateString('en-GB', { weekday: 'short' });
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `Resets ${day} ${time}`;
}

/** The notification's title and body. */
function alertText(alert, now) {
  const label = String(alert.label || '').trim() || 'Account';
  const win = WINDOW_NAME[alert.window] || 'Usage';
  if (alert.type === 'reset') {
    return { title: `${label}: ${win} limit reset`, body: 'Ready to use again.' };
  }
  const reset = resetText(alert.resetsAt, now);
  if (alert.threshold >= LIMIT) {
    return { title: `${label}: ${win} limit reached`, body: reset || 'Wait for it to reset.' };
  }
  return {
    title: `${label}: ${win} at ${Math.round(alert.percent)}%`,
    body: reset || `Passed your ${alert.threshold}% alert.`
  };
}

module.exports = {
  WINDOWS, LIMIT, THRESHOLD_CHOICES, DEFAULT_THRESHOLDS, MAX_AGE_MS,
  normaliseSettings, readingsFor, step, evaluate, resetText, alertText
};
