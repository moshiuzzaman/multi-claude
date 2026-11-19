'use strict';
// Scheduled message: the rules for when an account's message is due. Pure: no
// timers, no files, no processes. The service keeps the state and sends.
//
// An account's schedule: { on, times: ['09:00', '14:00'], days: [0..6], message }.
// Times are the PC's local clock; days are 0 = Sunday .. 6 = Saturday.
//
// Only the latest missed time is sent: if the PC was asleep through 09:00 and
// 14:00, waking at 15:00 sends once (for 14:00), never twice.

const DEFAULT_MESSAGE = 'hi';
const MAX_MESSAGE = 500;
const MAX_TIMES = 5;
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
// How far back a missed time is still looked for.
const LOOKBACK_DAYS = 8;

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "9:5" or "09:05" -> "09:05"; null when it isn't a time of day. */
function normaliseTime(t) {
  const m = /^\s*(\d{1,2}):(\d{1,2})\s*$/.exec(String(t || ''));
  if (!m) return null;
  const s = `${m[1].padStart(2, '0')}:${m[2].padStart(2, '0')}`;
  return TIME_RE.test(s) ? s : null;
}

/** The message as it will be sent, or null when it can't be. */
function normaliseMessage(m) {
  const s = String(m == null ? '' : m).trim();
  if (!s || s.length > MAX_MESSAGE) return null;
  // Claude Code would read a leading "-" as an option, not as the message.
  if (s.startsWith('-')) return null;
  return s;
}

/** The schedule with anything missing or bad replaced by the defaults. */
function normaliseSchedule(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const times = Array.isArray(r.times)
    ? [...new Set(r.times.map(normaliseTime).filter(Boolean))].sort().slice(0, MAX_TIMES)
    : ['09:00'];
  const days = Array.isArray(r.days)
    ? [...new Set(r.days.map(Number).filter((d) => ALL_DAYS.includes(d)))].sort()
    : ALL_DAYS.slice();
  return {
    on: r.on === true,
    times,
    days: days.length ? days : ALL_DAYS.slice(),
    message: normaliseMessage(r.message) || DEFAULT_MESSAGE
  };
}

/** Every scheduled moment from `from` to `to` (inclusive), oldest first. */
function slotsBetween(schedule, from, to) {
  const s = normaliseSchedule(schedule);
  const out = [];
  const day = new Date(from);
  day.setHours(0, 0, 0, 0);
  for (; day.getTime() <= to; day.setDate(day.getDate() + 1)) {
    if (!s.days.includes(day.getDay())) continue;
    for (const t of s.times) {
      const [h, m] = t.split(':').map(Number);
      const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m).getTime();
      if (at >= from && at <= to) out.push(at);
    }
  }
  return out;
}

/**
 * The moment to send for now, or null: the newest scheduled moment that has
 * passed and is later than `lastSlot`, the last one already handled.
 */
function dueSlot(schedule, now, lastSlot) {
  const s = normaliseSchedule(schedule);
  if (!s.on || s.times.length === 0) return null;
  const since = Number.isFinite(lastSlot) ? lastSlot : now;
  const from = Math.max(since + 1, now - LOOKBACK_DAYS * 86400000);
  const slots = slotsBetween(s, from, now);
  return slots.length ? slots[slots.length - 1] : null;
}

/** The next moment it will send, or null when it is off. */
function nextSlot(schedule, now) {
  const s = normaliseSchedule(schedule);
  if (!s.on || s.times.length === 0) return null;
  const slots = slotsBetween(s, now + 1, now + LOOKBACK_DAYS * 86400000);
  return slots.length ? slots[0] : null;
}

module.exports = {
  DEFAULT_MESSAGE, MAX_MESSAGE, MAX_TIMES, ALL_DAYS,
  normaliseTime, normaliseMessage, normaliseSchedule, slotsBetween, dueSlot, nextSlot
};
