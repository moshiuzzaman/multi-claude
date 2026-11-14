'use strict';
// The usage Claude Desktop records for itself, so an account's limits can be
// shown without a second sign-in.
//
// Claude Desktop keeps <profile>/plan-usage-history.json: a list of samples,
// each { t, org, u: { fh, sd, xu } } — the 5-hour session and 7-day weekly
// limits as percentages used, and extra usage. Claude writes a sample a few
// times a day while it runs, so the newest one can be hours old; it holds no
// reset times. Only the samples' percentages and times are read: the newest
// for the limits view, all of them for the usage history chart.

const fs = require('node:fs');
const path = require('node:path');

const FILE = 'plan-usage-history.json';

function pct(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 100) : null;
}

/**
 * The newest sample as { recordedAt, session, weekly, extra }, each a
 * percentage or null, or null when the profile has no usable record.
 */
function readDesktopUsage(dir, fsImpl = fs) {
  if (!dir) return null;
  let raw;
  try {
    raw = JSON.parse(fsImpl.readFileSync(path.join(dir, FILE), 'utf8'));
  } catch {
    return null;
  }
  const samples = raw && Array.isArray(raw.samples) ? raw.samples : [];
  let best = null;
  for (const s of samples) {
    if (!s || typeof s !== 'object' || !s.u || typeof s.u !== 'object') continue;
    const t = Number(s.t);
    if (!Number.isFinite(t) || t <= 0) continue;
    if (!best || t > best.t) best = { t, u: s.u };
  }
  if (!best) return null;
  const session = pct(best.u.fh);
  const weekly = pct(best.u.sd);
  if (session === null && weekly === null) return null;
  return { recordedAt: best.t, session, weekly, extra: pct(best.u.xu) };
}

/**
 * Every sample, oldest first, as [{ t, session, weekly }] (percentages or
 * null). For the usage history chart. [] when there is no usable record.
 */
function readDesktopSamples(dir, fsImpl = fs) {
  if (!dir) return [];
  let raw;
  try {
    raw = JSON.parse(fsImpl.readFileSync(path.join(dir, FILE), 'utf8'));
  } catch {
    return [];
  }
  const out = [];
  for (const s of raw && Array.isArray(raw.samples) ? raw.samples : []) {
    if (!s || typeof s !== 'object' || !s.u || typeof s.u !== 'object') continue;
    const t = Number(s.t);
    if (!Number.isFinite(t) || t <= 0) continue;
    const session = pct(s.u.fh);
    const weekly = pct(s.u.sd);
    if (session === null && weekly === null) continue;
    out.push({ t, session, weekly });
  }
  return out.sort((a, b) => a.t - b.t);
}

module.exports = { readDesktopUsage, readDesktopSamples, FILE };
