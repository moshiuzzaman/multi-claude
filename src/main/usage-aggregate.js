'use strict';
// Turns session summaries into the numbers the dashboard draws.
//
// Everything here is pure: given the same sessions it returns the same shape,
// which is what makes it testable without touching the filesystem.

const path = require('node:path');
const { emptyBucket } = require('./usage-reader.js');

const UNATTRIBUTED = '(unattributed)';

function addInto(target, src) {
  target.input += src.input;
  target.output += src.output;
  target.cacheRead += src.cacheRead;
  target.cacheWrite += src.cacheWrite;
  target.thinking += src.thinking;
  target.messages += src.messages;
}

function projectName(cwd) {
  if (!cwd) return '(unknown)';
  const base = path.basename(cwd);
  return base || cwd;
}

/** A continuous list of day keys, so charts have no holes. */
function dayRange(days, now) {
  const out = [];
  const end = new Date(now);
  end.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(d.getDate() - i);
    out.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    );
  }
  return out;
}

/**
 * Rank by the metric the UI actually displays.
 *
 * Previously this sorted by total tokens while the charts labelled each bar
 * with output tokens, so a row with heavy cache reads jumped above one with
 * more output — a list whose order contradicted its own numbers.
 */
function topN(map, n, metric = (b) => b.output) {
  return Object.entries(map)
    .map(([key, bucket]) => ({ key, ...bucket }))
    .sort((a, b) => metric(b) - metric(a))
    .slice(0, n);
}

/** "2026-11-09T14" -> epoch ms for the start of that local hour. */
function hourKeyToTime(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})$/.exec(String(key));
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4]).getTime();
}

/**
 * Token volume inside a rolling window, summed from hourly buckets.
 *
 * This is NOT a percentage of any plan limit — those live behind an
 * authenticated API call and are deliberately not reproduced here. It is the
 * raw local token volume over the same span, and the UI must label it so.
 */
function rollingWindow(sessions, ms, now) {
  const cutoff = now - ms;
  const total = emptyBucket();
  for (const s of sessions) {
    for (const [hk, bucket] of Object.entries(s.byHour || {})) {
      const t = hourKeyToTime(hk);
      // An hour bucket counts when the hour it covers ends after the cutoff.
      if (t !== null && t + 3600000 > cutoff) addInto(total, bucket);
    }
  }
  return { ...total, since: cutoff, windowMs: ms };
}

/**
 * Hourly token totals for the last `hours` hours, as a dense array.
 * Dense so a sliding window can run over it without gaps.
 */
function hourlyGrid(sessions, now, hours) {
  const end = Math.floor(now / 3600000) * 3600000;
  const start = end - (hours - 1) * 3600000;
  const grid = new Array(hours).fill(0);

  for (const s of sessions) {
    for (const [hk, b] of Object.entries(s.byHour || {})) {
      const t = hourKeyToTime(hk);
      if (t === null) continue;
      const idx = Math.round((t - start) / 3600000);
      if (idx >= 0 && idx < hours) grid[idx] += b.output + b.input;
    }
  }
  return grid;
}

/** Largest sum across any `w` consecutive hours. */
function peakWindow(grid, w) {
  let best = 0;
  let sum = 0;
  for (let i = 0; i < grid.length; i++) {
    sum += grid[i];
    if (i >= w) sum -= grid[i - w];
    if (i >= w - 1 && sum > best) best = sum;
  }
  return best;
}

function rankMap(map, metric, n = 8) {
  return Object.entries(map)
    .map(([key, v]) => (typeof v === 'number' ? { key, value: v } : { key, ...v, value: metric(v) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, n);
}

/**
 * What drove usage, over sessions that were last active inside the window.
 * Session-level granularity, which is exact in its own terms and is how the
 * UI labels it.
 */
function contributions(sessions, ms, now) {
  const cutoff = now - ms;
  const skills = {};
  const plugins = {};
  const mcp = {};

  for (const s of sessions) {
    if (!s.lastTs || s.lastTs < cutoff) continue;
    for (const [k, b] of Object.entries(s.bySkill || {})) {
      if (!skills[k]) skills[k] = emptyBucket();
      addInto(skills[k], b);
    }
    for (const [k, b] of Object.entries(s.byPlugin || {})) {
      if (!plugins[k]) plugins[k] = emptyBucket();
      addInto(plugins[k], b);
    }
    for (const [k, calls] of Object.entries(s.byMcpCalls || {})) {
      mcp[k] = (mcp[k] || 0) + calls;
    }
  }

  const tokenMetric = (b) => b.output + b.input;
  return {
    skills: rankMap(skills, tokenMetric),
    plugins: rankMap(plugins, tokenMetric),
    mcp: rankMap(mcp, null)
  };
}

/**
 * @param sessions summaries from usage-reader
 * @param days     size of the daily window, e.g. 30
 * @param now      timestamp the window ends on (injectable for tests)
 */
function buildDashboard(sessions, { days = 30, now = Date.now() } = {}) {
  const keys = dayRange(days, now);
  const inWindow = new Set(keys);

  const totals = emptyBucket();
  const windowTotals = emptyBucket();
  const perDay = {};
  const byModel = {};
  const byProject = {};
  const byOrg = {};

  for (const k of keys) perDay[k] = emptyBucket();

  let costTotal = 0;
  let costSessions = 0;
  let attributedSessions = 0;
  let firstTs = null;
  let lastTs = null;

  for (const s of sessions) {
    addInto(totals, s.totals);

    if (s.costRecorded && typeof s.costUSD === 'number') {
      costTotal += s.costUSD;
      costSessions++;
    }
    if (s.org) attributedSessions++;
    if (s.firstTs && (firstTs === null || s.firstTs < firstTs)) firstTs = s.firstTs;
    if (s.lastTs && (lastTs === null || s.lastTs > lastTs)) lastTs = s.lastTs;

    for (const [model, bucket] of Object.entries(s.byModel)) {
      if (!byModel[model]) byModel[model] = emptyBucket();
      addInto(byModel[model], bucket);
    }

    const proj = projectName(s.project);
    if (!byProject[proj]) byProject[proj] = emptyBucket();
    addInto(byProject[proj], s.totals);

    const org = s.org || UNATTRIBUTED;
    if (!byOrg[org]) byOrg[org] = { ...emptyBucket(), sessions: 0, cost: 0 };
    addInto(byOrg[org], s.totals);
    byOrg[org].sessions++;
    if (s.costRecorded) byOrg[org].cost += s.costUSD;

    for (const [day, bucket] of Object.entries(s.byDay)) {
      if (!inWindow.has(day)) continue;
      addInto(perDay[day], bucket);
      addInto(windowTotals, bucket);
    }
  }

  return {
    totals,
    windowTotals,
    days,
    daily: keys.map((date) => ({ date, ...perDay[date] })),
    byModel: topN(byModel, 8),
    byProject: topN(byProject, 8),
    byOrg: Object.entries(byOrg)
      .map(([key, b]) => ({ key, ...b, attributed: key !== UNATTRIBUTED }))
      .sort((a, b) => b.output - a.output),
    cost: {
      total: costTotal,
      sessions: costSessions,
      // Cost is only recorded on a minority of sessions, so the UI must label
      // this as partial rather than presenting it as a full spend figure.
      partial: costSessions < sessions.length
    },
    coverage: {
      sessions: sessions.length,
      attributedSessions,
      firstTs,
      lastTs
    },
    // A bare "1.2M tokens" has no shape, and a progress bar needs a
    // denominator. There is no real plan limit available, so the honest
    // denominator is the user's own busiest comparable window this month.
    rolling: (() => {
      const grid = hourlyGrid(sessions, now, 30 * 24);
      return {
        fiveHour: { ...rollingWindow(sessions, 5 * 3600 * 1000, now), peak: peakWindow(grid, 5) },
        sevenDay: { ...rollingWindow(sessions, 7 * 24 * 3600 * 1000, now), peak: peakWindow(grid, 7 * 24) },
        peakWindowDays: 30
      };
    })(),
    contrib: {
      day: contributions(sessions, 24 * 3600 * 1000, now),
      week: contributions(sessions, 7 * 24 * 3600 * 1000, now)
    }
  };
}

module.exports = {
  buildDashboard, dayRange, projectName, UNATTRIBUTED,
  rollingWindow, contributions, hourKeyToTime, hourlyGrid, peakWindow
};
