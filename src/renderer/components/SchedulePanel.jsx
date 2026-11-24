import React, { useCallback, useEffect, useState } from 'react';
import { api, isMac } from '../lib/api.js';

// Sunday first, matching Date.getDay().
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// The most times a day (the main process refuses more).
const MAX_TIMES = 5;

const hhmm = (t) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

/** A time to offer in the picker: the next whole hour that isn't already set. */
function suggestTime(times) {
  const h = new Date().getHours();
  for (let i = 1; i <= 24; i++) {
    const t = `${String((h + i) % 24).padStart(2, '0')}:00`;
    if (!times.includes(t)) return t;
  }
  return '09:00';
}

/** "09:00", "09:00 and 14:00", "09:00, 14:00 and 19:00". */
function listTimes(times) {
  if (times.length <= 1) return times.join('');
  return `${times.slice(0, -1).join(', ')} and ${times[times.length - 1]}`;
}

/** "Today 14:00", "Tomorrow 09:00" or "Mon 23 Nov 09:00". */
function when(t) {
  const d = new Date(t);
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const startOf = (x) => { const c = new Date(x); c.setHours(0, 0, 0, 0); return c.getTime(); };
  const days = Math.round((startOf(t) - startOf(Date.now())) / 86400000);
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Tomorrow ${time}`;
  if (days === -1) return `Yesterday ${time}`;
  return `${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} ${time}`;
}

/**
 * Scheduled message, on an account's page: at the times picked, Multi-Claude
 * sends a short message from this account in the background, so its 5-hour
 * limit starts then. The timing and sending live in the main process
 * (schedule.js, scheduled-send.js).
 */
export default function SchedulePanel({ account, settings, actions }) {
  const [view, setView] = useState(null);
  const [message, setMessage] = useState('');
  const [newTime, setNewTime] = useState('09:00');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const v = await api.getSchedule(account.id);
      setView(v);
      return v;
    } catch (e) { setError(e.message); return null; }
  }, [account.id]);

  useEffect(() => {
    setView(null);
    setError(null);
    load().then((v) => {
      if (!v) return;
      setMessage(v.schedule.message);
      setNewTime(suggestTime(v.schedule.times));
    });
    // Last sent and Next move on by themselves.
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  if (!view) {
    return (
      <div className="panel">
        <div className="panel-title">Scheduled message</div>
        {error ? <div className="note" style={{ marginTop: 12 }}>{error}</div> : <div className="skeleton" style={{ height: 60, marginTop: 12 }} />}
      </div>
    );
  }

  const { schedule, last, next } = view;

  const save = async (changes) => {
    setError(null);
    try {
      const v = await api.setSchedule(account.id, changes);
      setView(v);
      setMessage(v.schedule.message);
      return true;
    } catch (e) { setError(e.message); return false; }
  };

  const full = schedule.times.length >= MAX_TIMES;
  const duplicate = schedule.times.includes(newTime);
  const canAdd = !!newTime && !duplicate && !full;
  const addTime = async () => {
    if (!canAdd) return;
    const times = [...schedule.times, newTime];
    if (await save({ times })) setNewTime(suggestTime(times));
  };
  // The time the Next line names, marked on its chip.
  const nextTime = schedule.on && next ? hhmm(next) : null;
  const dayText = schedule.days.length === 7
    ? 'every day'
    : `on ${DAYS.filter((_, d) => schedule.days.includes(d)).join(', ')}`;
  const removeTime = (t) => save({ times: schedule.times.filter((x) => x !== t) });
  const toggleDay = (d) => {
    const days = schedule.days.includes(d) ? schedule.days.filter((x) => x !== d) : [...schedule.days, d];
    if (days.length === 0) return; // at least one day
    save({ days });
  };
  const saveMessage = () => {
    if (message.trim() === schedule.message) return;
    save({ message });
  };

  const sendNow = async () => {
    setBusy(true);
    setError(null);
    try {
      const v = await api.sendScheduledNow(account.id);
      setView(v);
      if (v.result.ok) actions.notify(`Sent "${v.schedule.message}" from ${account.label}.`);
      else actions.notify(v.result.reason, true);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const allDays = schedule.days.length === 7;
  const tray = isMac ? 'menu bar' : 'tray';

  return (
    <div className="panel schedule">
      <div className="panel-title" style={{ justifyContent: 'space-between' }}>
        <span>Scheduled message</span>
        <button
          type="button"
          role="switch"
          aria-checked={schedule.on}
          className={schedule.on ? 'schedule-toggle on' : 'schedule-toggle'}
          onClick={() => save({ on: !schedule.on })}
        >
          <span className="schedule-knob" aria-hidden="true" />
          {schedule.on ? 'On' : 'Off'}
        </button>
      </div>

      {!schedule.on && (
        <div className="schedule-off">
          <span>It's <strong>off</strong>, so nothing will be sent. Set your times, then turn it on.</span>
          <button type="button" className="primary" onClick={() => save({ on: true })}>Turn on</button>
        </div>
      )}

      <div className="schedule-hint">
        Sends a short message from this account at the times you pick, so its 5-hour limit
        starts then. It runs in the background through Claude Code. No window opens.
      </div>

      <div className="schedule-grid">
        <span className="schedule-label">Times</span>
        <span className="schedule-row">
          {schedule.times.map((t) => (
            <span
              className={`schedule-time${schedule.on ? '' : ' off'}${t === nextTime ? ' next' : ''}`}
              key={t}
              title={t === nextTime ? 'Sends next' : schedule.on ? 'Active' : 'Saved, but off'}
            >
              {t}
              {t === nextTime && <span className="schedule-next-tag">Next</span>}
              <button type="button" aria-label={`Remove ${t}`} title="Remove" onClick={() => removeTime(t)}>✕</button>
            </span>
          ))}
          {full ? (
            <span className="schedule-days-note">Up to {MAX_TIMES} times. Remove one to add another.</span>
          ) : (
            <span className="schedule-add">
              <input
                type="time"
                value={newTime}
                onChange={(e) => setNewTime(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addTime(); }}
                aria-label="New time"
              />
              <button type="button" className={canAdd ? 'primary' : 'ghost'} onClick={addTime} disabled={!canAdd}>
                + Add {newTime || 'time'}
              </button>
              {duplicate && <span className="schedule-days-note">Already added</span>}
            </span>
          )}
        </span>

        <span />
        <span className={schedule.on ? 'schedule-active on' : 'schedule-active'}>
          {schedule.times.length === 0
            ? 'No times yet. Pick one and click Add.'
            : schedule.on
              ? `● Active: sends at ${listTimes(schedule.times)}, ${dayText}.`
              : `○ Off: these times are saved but nothing is sent until you turn it on.`}
        </span>

        <span className="schedule-label">Days</span>
        <span className="schedule-row alert-levels" role="group" aria-label="Days">
          {DAYS.map((name, d) => (
            <button
              key={name}
              type="button"
              className={schedule.days.includes(d) ? 'level on' : 'level'}
              aria-pressed={schedule.days.includes(d)}
              onClick={() => toggleDay(d)}
            >
              {name}
            </button>
          ))}
          <span className="schedule-days-note">{allDays ? 'Every day' : ''}</span>
        </span>

        <span className="schedule-label">Message</span>
        <span className="schedule-row">
          <input
            className="schedule-message"
            type="text"
            value={message}
            maxLength={500}
            onChange={(e) => setMessage(e.target.value)}
            onBlur={saveMessage}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
            aria-label="Message"
          />
        </span>
      </div>

      <div className="schedule-status">
        <span>
          <span className="schedule-label">Last sent</span>{' '}
          {!last && 'Not yet'}
          {last && last.ok && <span className="schedule-ok">✓ {when(last.at)}</span>}
          {last && !last.ok && <span className="schedule-fail">✕ {when(last.at)}: {last.reason}</span>}
        </span>
        <span>
          <span className="schedule-label">Next</span>{' '}
          {schedule.on ? (next ? when(next) : 'Add a time') : 'Nothing, it is off'}
        </span>
        <button type="button" className="ghost" onClick={sendNow} disabled={busy || view.sending}>
          {busy || view.sending ? 'Sending…' : 'Send now'}
        </button>
      </div>

      {error && <div className="schedule-fail" style={{ marginTop: 8 }}>{error}</div>}

      {schedule.on && settings && settings.openAtLoginSupported && !settings.openAtLogin && (
        <label className="setting-sub schedule-login">
          <input type="checkbox" checked={false} onChange={() => actions.setOpenAtLogin(true)} />
          Start Multi-Claude when {isMac ? 'you log in' : 'Windows starts'}, so a time is never missed
        </label>
      )}

      {schedule.on && settings && settings.openAtLoginBlocked && (
        <div className="schedule-fail" style={{ marginTop: 12 }}>Windows has Multi-Claude switched off in Settings › Apps › Startup, so it won't start. Turn it on there.</div>
      )}

      <div className="panel-foot">
        Multi-Claude must be running at those times (in the {tray} is enough). If the PC was off
        or asleep, only the latest missed time is sent when it's back. Every message goes into
        the same chat, which you'll see in Claude Code chats above.
      </div>
    </div>
  );
}
