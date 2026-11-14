'use strict';
// Usage history: each account's Session and Weekly percentages over time, for
// the chart on its page.
//
// Two sources, merged:
//   - Claude's own plan-usage-history.json (desktop-usage.js): a sample a few
//     times a day, only while its window runs, so hours apart.
//   - Multi-Claude's own readings: every live /usage figure it fetches (about
//     every 5 minutes while it is open), kept in usage-history.jsonl for 90
//     days. Percentages and times only, nothing else.
//
// buildHistory() is pure: points in, what the panel draws out.

const fsp = require('node:fs/promises');
const path = require('node:path');

const KEEP_MS = 90 * 24 * 60 * 60 * 1000;
// The same figures again within this long add nothing to the chart.
const SAME_WITHIN_MS = 30 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
// A reading at the limit again after this long is a new time it was reached.
const WINDOW_MS = { session: 5 * HOUR, weekly: 7 * 24 * HOUR };

function pct(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 100) : null;
}

/**
 * The readings log, one JSON line per reading: { id, t, s, w }.
 * record() skips a reading that repeats the last one within 30 minutes.
 */
function createHistoryLog({ file, fsImpl = fsp, now = () => Date.now() }) {
  let rows = [];
  const last = new Map(); // account id -> last row
  let loaded = false;
  let writes = Promise.resolve();

  async function load() {
    if (loaded) return;
    loaded = true;
    let text = '';
    try { text = await fsImpl.readFile(file, 'utf8'); } catch { /* none yet */ }
    const cutoff = now() - KEEP_MS;
    let dropped = 0;
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      let r;
      try { r = JSON.parse(line); } catch { dropped++; continue; }
      const t = Number(r && r.t);
      if (!r || typeof r.id !== 'string' || !Number.isFinite(t) || t < cutoff) { dropped++; continue; }
      const row = { id: r.id, t, s: pct(r.s), w: pct(r.w) };
      rows.push(row);
      const prev = last.get(row.id);
      if (!prev || prev.t <= t) last.set(row.id, row);
    }
    // Old or broken lines are dropped from the file once, here.
    if (dropped > 0) await rewrite();
  }

  function rewrite() {
    const text = rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
    writes = writes.then(async () => {
      await fsImpl.mkdir(path.dirname(file), { recursive: true });
      const tmp = file + '.tmp';
      await fsImpl.writeFile(tmp, text, 'utf8');
      await fsImpl.rename(tmp, file);
    }).catch(() => {});
    return writes;
  }

  return {
    load,

    /** Add one account's reading. Returns true if it was kept. */
    async record(id, { t, session, weekly }) {
      await load();
      const row = { id, t: Number(t), s: pct(session), w: pct(weekly) };
      if (!Number.isFinite(row.t) || (row.s === null && row.w === null)) return false;
      const prev = last.get(id);
      if (prev && row.t <= prev.t) return false;
      if (prev && prev.s === row.s && prev.w === row.w && row.t - prev.t < SAME_WITHIN_MS) return false;
      rows.push(row);
      last.set(id, row);
      const line = JSON.stringify(row) + '\n';
      writes = writes.then(async () => {
        await fsImpl.mkdir(path.dirname(file), { recursive: true });
        await fsImpl.appendFile(file, line, 'utf8');
      }).catch(() => {});
      return true;
    },

    /** One account's readings as [{ t, session, weekly }], oldest first. */
    async read(id) {
      await load();
      return rows.filter((r) => r.id === id).map((r) => ({ t: r.t, session: r.s, weekly: r.w }))
        .sort((a, b) => a.t - b.t);
    },

    /** Forget a deleted account's readings. */
    async forget(id) {
      await load();
      const before = rows.length;
      rows = rows.filter((r) => r.id !== id);
      last.delete(id);
      if (rows.length !== before) await rewrite();
    },

    flush() { return writes; }
  };
}

/** Local midnight of the day `t` falls in. */
function dayStart(t) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function dayKey(t) {
  const d = new Date(t);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Each time a window went from below its limit to 100%. */
function limitHits(points, window) {
  const key = window === 'session' ? 'session' : 'weekly';
  const hits = [];
  let prev = null;
  for (const p of points) {
    const v = p[key];
    if (v === null || v === undefined) continue;
    if (v >= 100) {
      const fresh = !prev || prev.v < 100 || p.t - prev.t > WINDOW_MS[window];
      if (fresh) hits.push({ window, t: p.t });
    }
    prev = { t: p.t, v };
  }
  return hits;
}

/**
 * What the panel draws for the last `days` days (today included):
 *   from, to          the time range (local midnight .. end of today)
 *   days              [{ key, start, sessionPeak, weeklyPeak, readings }] — null peaks: no data
 *   weekly            [{ t, v }]  every Weekly reading, for the line
 *   hits              [{ window, t }]  times a limit was reached, oldest first
 *   busiest           the day with the highest Session peak, or null
 *   latest            { t, weekly, session } of the newest reading, or null
 *   readings          { claude, own }  how many points came from each source
 */
function buildHistory({ claude = [], own = [] }, { days = 7, now = Date.now() } = {}) {
  const span = Math.max(1, Math.min(90, Math.round(days)));
  const today = dayStart(now);
  const from = new Date(today);
  from.setDate(from.getDate() - (span - 1));
  const fromT = from.getTime();
  const end = new Date(today);
  end.setDate(end.getDate() + 1);
  const to = end.getTime();

  const tag = (src) => (p) => ({ t: Number(p.t), session: pct(p.session), weekly: pct(p.weekly), src });
  const all = [...claude.map(tag('claude')), ...own.map(tag('own'))]
    .filter((p) => Number.isFinite(p.t) && (p.session !== null || p.weekly !== null))
    .sort((a, b) => a.t - b.t);
  const inRange = all.filter((p) => p.t >= fromT && p.t < to);

  const buckets = [];
  const byKey = new Map();
  for (let i = 0; i < span; i++) {
    const d = new Date(fromT);
    d.setDate(d.getDate() + i);
    const b = { key: dayKey(d.getTime()), start: d.getTime(), sessionPeak: null, weeklyPeak: null, readings: 0 };
    buckets.push(b);
    byKey.set(b.key, b);
  }
  for (const p of inRange) {
    const b = byKey.get(dayKey(p.t));
    if (!b) continue;
    b.readings++;
    if (p.session !== null) b.sessionPeak = Math.max(b.sessionPeak ?? 0, p.session);
    if (p.weekly !== null) b.weeklyPeak = Math.max(b.weeklyPeak ?? 0, p.weekly);
  }

  // Hits are found over all readings, so one that began before the range
  // isn't counted again inside it.
  const hits = [...limitHits(all, 'session'), ...limitHits(all, 'weekly')]
    .filter((h) => h.t >= fromT && h.t < to)
    .sort((a, b) => a.t - b.t);

  let busiest = null;
  for (const b of buckets) {
    if (b.sessionPeak === null) continue;
    if (!busiest || b.sessionPeak >= busiest.sessionPeak) busiest = b;
  }

  const newest = all.length ? all[all.length - 1] : null;
  const lastWeekly = [...all].reverse().find((p) => p.weekly !== null);
  return {
    from: fromT,
    to,
    days: buckets,
    weekly: inRange.filter((p) => p.weekly !== null).map((p) => ({ t: p.t, v: p.weekly })),
    hits,
    busiest: busiest ? { key: busiest.key, start: busiest.start, sessionPeak: busiest.sessionPeak } : null,
    latest: newest ? { t: newest.t, session: newest.session, weekly: lastWeekly ? lastWeekly.weekly : null } : null,
    readings: {
      claude: inRange.filter((p) => p.src === 'claude').length,
      own: inRange.filter((p) => p.src === 'own').length
    }
  };
}

/** The live Session and Weekly figures in a limits() row, or null. */
function liveReading(row) {
  const plan = row && row.plan;
  if (!plan || !plan.ok || !Array.isArray(plan.meters) || !Number.isFinite(plan.fetchedAt)) return null;
  const find = (kind) => {
    const m = plan.meters.find((x) => x && x.kind === kind);
    return m && Number.isFinite(m.percent) ? m.percent : null;
  };
  const session = find('session');
  const weekly = find('weekly_all');
  if (session === null && weekly === null) return null;
  return { t: plan.fetchedAt, session, weekly };
}

module.exports = { KEEP_MS, SAME_WITHIN_MS, createHistoryLog, buildHistory, limitHits, liveReading, dayKey };
