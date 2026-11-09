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
    }
  };
}

module.exports = { buildDashboard, dayRange, projectName, UNATTRIBUTED };
