'use strict';
// Per-account launch history.
//
// Honest limitation, surfaced in the UI: Multi-Claude can only observe what is
// running while Multi-Claude itself is open. It polls the process scanner and
// records start/stop transitions. A profile you launch from a desktop shortcut
// while the manager is closed is invisible until the manager next opens, at
// which point it is recorded as running from that moment.
//
// The log is append-only JSONL so a crash can never corrupt more than the last
// line, and old lines are never rewritten.

const fsp = require('node:fs/promises');
const path = require('node:path');

/**
 * Diff two sets of running account ids into events.
 * Pure, so the transition logic is testable without a clock or a filesystem.
 */
function diffRunning(previous, current, now) {
  const prev = new Set(previous);
  const cur = new Set(current);
  const events = [];
  for (const id of cur) if (!prev.has(id)) events.push({ t: now, id, event: 'start' });
  for (const id of prev) if (!cur.has(id)) events.push({ t: now, id, event: 'stop' });
  return events;
}

function parseLog(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line);
      if (typeof o.t === 'number' && typeof o.id === 'string' &&
          (o.event === 'start' || o.event === 'stop')) {
        out.push(o);
      }
    } catch { /* skip a torn final line */ }
  }
  return out;
}

/**
 * Fold events into closed sessions. A start with no matching stop is treated as
 * still running and closed off at `now`, flagged open:true.
 */
function buildSessions(events, now) {
  const open = new Map();
  const sessions = [];

  for (const e of [...events].sort((a, b) => a.t - b.t)) {
    if (e.event === 'start') {
      if (!open.has(e.id)) open.set(e.id, e.t);
    } else {
      const start = open.get(e.id);
      if (start !== undefined) {
        sessions.push({ id: e.id, start, end: e.t, ms: Math.max(0, e.t - start), open: false });
        open.delete(e.id);
      }
    }
  }

  for (const [id, start] of open) {
    sessions.push({ id, start, end: now, ms: Math.max(0, now - start), open: true });
  }

  return sessions.sort((a, b) => b.start - a.start);
}

function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Per-account totals plus a daily minutes series for the activity chart. */
function summariseActivity(sessions, { days = 30, now = Date.now() } = {}) {
  const perAccount = {};
  const perDay = {};

  const keys = [];
  const end = new Date(now);
  end.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(d.getDate() - i);
    keys.push(dayKey(d.getTime()));
  }
  const inWindow = new Set(keys);
  for (const k of keys) perDay[k] = {};

  for (const s of sessions) {
    const a = perAccount[s.id] || (perAccount[s.id] = { id: s.id, ms: 0, launches: 0, lastUsed: null });
    a.ms += s.ms;
    a.launches += 1;
    if (a.lastUsed === null || s.start > a.lastUsed) a.lastUsed = s.start;

    // Attribute a session's duration to the day it started on. Sessions that
    // span midnight are rare enough that splitting them is not worth the
    // complexity, and the chart is about rough shape, not billing.
    const k = dayKey(s.start);
    if (inWindow.has(k)) perDay[k][s.id] = (perDay[k][s.id] || 0) + s.ms;
  }

  return {
    accounts: Object.values(perAccount).sort((a, b) => b.ms - a.ms),
    daily: keys.map((date) => ({ date, byAccount: perDay[date] }))
  };
}

function createActivityLog({ file }) {
  let previous = [];

  return {
    /** Feed the current running-id set; returns the events that were written. */
    async record(runningIds, now = Date.now()) {
      const events = diffRunning(previous, runningIds, now);
      previous = [...runningIds];
      if (events.length === 0) return [];
      await fsp.mkdir(path.dirname(file), { recursive: true });
      await fsp.appendFile(file, events.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
      return events;
    },

    /** Called on shutdown so an open session gets a real end time. */
    async closeAll(now = Date.now()) {
      return this.record([], now);
    },

    async read() {
      try {
        return parseLog(await fsp.readFile(file, 'utf8'));
      } catch (e) {
        if (e.code === 'ENOENT') return [];
        throw e;
      }
    },

    _setPreviousForTest(ids) { previous = [...ids]; }
  };
}

module.exports = {
  diffRunning, parseLog, buildSessions, summariseActivity, createActivityLog, dayKey
};
