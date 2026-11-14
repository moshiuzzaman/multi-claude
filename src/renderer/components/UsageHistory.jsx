import React, { useEffect, useRef, useState } from 'react';
import StatTile from './StatTile.jsx';
import { api } from '../lib/api.js';
import { relativeTime } from '../lib/format.js';

/**
 * One account's usage over the last 7 or 30 days: a Weekly line of every
 * reading, and Session as the highest reading each day. Claude records its
 * own usage only a few times a day, hours apart, so a Session line through
 * those readings would be misleading; a daily peak is honest. Days with no
 * readings stay empty rather than showing 0%. Data: usage-history.js.
 */

const DANGER = 'var(--danger)';
const PAD = { left: 36, right: 10, top: 10, bottom: 22 };
const DAY = 24 * 60 * 60 * 1000;

const dayLabel = (t, long = false) => new Date(t).toLocaleDateString('en-GB',
  long ? { weekday: 'short', day: 'numeric', month: 'short' } : { weekday: 'short', day: 'numeric' });
const shortDate = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const timeLabel = (t) => new Date(t).toLocaleString('en-GB', {
  weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
});

/** The width the chart actually has, so text stays its real size. */
function useWidth() {
  const ref = useRef(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Day labels along the bottom: every day for a week, every few days for a month. */
function dayTicks(days, x) {
  const every = days.length <= 7 ? 1 : days.length <= 14 ? 2 : 5;
  return days
    .map((d, i) => ({ d, i }))
    .filter(({ i }) => (days.length - 1 - i) % every === 0)
    .map(({ d }) => ({ x: x(d), label: days.length <= 7 ? dayLabel(d.start) : shortDate(d.start), key: d.key }));
}

function Grid({ width, y }) {
  return (
    <g className="uh-grid">
      {[0, 50, 100].map((v) => (
        <g key={v}>
          <line x1={PAD.left} x2={width - PAD.right} y1={y(v)} y2={y(v)}
                className={v === 100 ? 'uh-limit' : v === 0 ? 'uh-base' : ''} />
          <text x={PAD.left - 6} y={y(v) + 3.5} textAnchor="end">{v}%</text>
        </g>
      ))}
    </g>
  );
}

function WeeklyChart({ hist, color }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const height = 150;
  const innerW = Math.max(1, width - PAD.left - PAD.right);
  const innerH = height - PAD.top - PAD.bottom;
  const x = (t) => PAD.left + ((t - hist.from) / (hist.to - hist.from)) * innerW;
  const y = (v) => PAD.top + (1 - v / 100) * innerH;
  const pts = hist.weekly;

  // Readings more than a day and a half apart are joined with a dashed line:
  // the account wasn't being watched in between.
  const segs = [];
  for (let i = 1; i < pts.length; i++) {
    segs.push({ a: pts[i - 1], b: pts[i], gap: pts[i].t - pts[i - 1].t > 1.5 * DAY });
  }

  const onMove = (e) => {
    if (pts.length === 0) return;
    const box = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - box.left;
    let best = pts[0];
    for (const p of pts) if (Math.abs(x(p.t) - mx) < Math.abs(x(best.t) - mx)) best = p;
    setHover(best);
  };

  return (
    <div className="uh-chart" ref={ref}>
      {width > 0 && (
        <svg width={width} height={height} role="img"
             aria-label={`Weekly usage, ${pts.length} readings`}
             onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
          <Grid width={width} y={y} />
          {dayTicks(hist.days, (d) => x(d.start + DAY / 2)).map((t) => (
            <text key={t.key} className="uh-tick" x={t.x} y={height - 6} textAnchor="middle">{t.label}</text>
          ))}
          {segs.map(({ a, b, gap }, i) => (
            <line key={i} x1={x(a.t)} y1={y(a.v)} x2={x(b.t)} y2={y(b.v)} stroke={color}
                  strokeWidth="2" strokeLinecap="round" strokeDasharray={gap ? '3 5' : undefined}
                  opacity={gap ? 0.55 : 1} />
          ))}
          {pts.map((p) => (
            <circle key={p.t} cx={x(p.t)} cy={y(p.v)} r={hover && hover.t === p.t ? 5 : 3.5}
                    fill={p.v >= 100 ? DANGER : color} className="uh-dot" />
          ))}
          {hover && <line className="uh-cross" x1={x(hover.t)} x2={x(hover.t)} y1={PAD.top} y2={PAD.top + innerH} />}
        </svg>
      )}
      {hover && (
        <div className="tooltip" style={{ left: x(hover.t), top: y(hover.v) }}>
          <div className="tt-head">{timeLabel(hover.t)}</div>
          <div className="tt-row"><span className="tt-key">Weekly</span><span className="tt-val">{Math.round(hover.v)}%</span></div>
        </div>
      )}
      {pts.length === 0 && <div className="uh-empty">No Weekly readings in this range.</div>}
    </div>
  );
}

function SessionBars({ hist, color }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const height = 130;
  const innerW = Math.max(1, width - PAD.left - PAD.right);
  const innerH = height - PAD.top - PAD.bottom;
  const n = hist.days.length;
  const slot = innerW / n;
  const barW = Math.max(3, Math.min(22, slot * 0.62));
  const cx = (i) => PAD.left + slot * i + slot / 2;
  const y = (v) => PAD.top + (1 - v / 100) * innerH;
  const indexOf = new Map(hist.days.map((d, i) => [d.key, i]));

  return (
    <div className="uh-chart" ref={ref}>
      {width > 0 && (
        <svg width={width} height={height} role="img"
             aria-label={`Highest Session usage each day, ${hist.days.filter((d) => d.sessionPeak !== null).length} days with readings`}
             onMouseLeave={() => setHover(null)}>
          <Grid width={width} y={y} />
          {dayTicks(hist.days, (d) => cx(indexOf.get(d.key))).map((t) => (
            <text key={t.key} className="uh-tick" x={t.x} y={height - 6} textAnchor="middle">{t.label}</text>
          ))}
          {hist.days.map((d, i) => {
            const v = d.sessionPeak;
            const hot = hover && hover.key === d.key;
            return (
              <g key={d.key} onMouseEnter={() => setHover(d)}>
                <rect x={PAD.left + slot * i} y={PAD.top} width={slot} height={innerH} fill="transparent" />
                {v === null ? (
                  <line className="uh-none" x1={cx(i) - barW / 3} x2={cx(i) + barW / 3} y1={y(0) - 2} y2={y(0) - 2} />
                ) : (
                  <rect x={cx(i) - barW / 2} y={y(Math.max(v, 1.5))} width={barW}
                        height={Math.max(2, y(0) - y(Math.max(v, 1.5)))} rx="3"
                        fill={v >= 100 ? DANGER : color} opacity={hover && !hot ? 0.55 : 1} />
                )}
              </g>
            );
          })}
        </svg>
      )}
      {hover && (
        <div className="tooltip" style={{ left: cx(indexOf.get(hover.key)), top: y(hover.sessionPeak ?? 0) }}>
          <div className="tt-head">{dayLabel(hover.start, true)}</div>
          {hover.sessionPeak === null ? (
            <div className="tt-row"><span className="tt-key">No readings</span></div>
          ) : (
            <div className="tt-row"><span className="tt-key">Session peak</span><span className="tt-val">{Math.round(hover.sessionPeak)}%</span></div>
          )}
        </div>
      )}
    </div>
  );
}

export default function UsageHistory({ account, color, refreshKey }) {
  const [days, setDays] = useState(7);
  const [hist, setHist] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    api.usageHistory(account.id, days)
      .then((h) => { if (live) { setHist(h); setFailed(false); } })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [account.id, days, refreshKey]);

  const nothing = hist && hist.readings.claude + hist.readings.own === 0;
  const hits = hist ? hist.hits : [];

  return (
    <div className="panel">
      <div className="panel-title" style={{ justifyContent: 'space-between' }}>
        <span>Usage history</span>
        <div className="seg">
          {[7, 30].map((d) => (
            <button key={d} className={days === d ? 'on' : ''} onClick={() => setDays(d)}>{d} days</button>
          ))}
        </div>
      </div>

      {!hist && !failed && <div className="skeleton" style={{ height: 120, marginTop: 12 }} />}
      {failed && <div className="limit-hint">Usage history couldn't be read.</div>}

      {hist && nothing && (
        <div className="limit-hint">
          No usage recorded in the last {days} days. Readings build up while this account's Claude
          window is open, and every few minutes while Multi-Claude is open if it has live limits.
        </div>
      )}

      {hist && !nothing && (
        <>
          <div className="mini-tiles">
            <StatTile
              label="Limit reached"
              value={hits.length === 0 ? 'Never' : `${hits.length} ${hits.length === 1 ? 'time' : 'times'}`}
              foot={hits.length === 0 ? `in the last ${days} days`
                : hits.slice(-2).map((h) => `${h.window === 'session' ? 'Session' : 'Weekly'} ${shortDate(h.t)}`).join(' · ')}
            />
            <StatTile
              label="Busiest day"
              value={hist.busiest ? dayLabel(hist.busiest.start, true) : '—'}
              foot={hist.busiest ? `Session peaked at ${Math.round(hist.busiest.sessionPeak)}%` : 'no Session readings'}
            />
            <StatTile
              label="Weekly, last reading"
              value={hist.latest && hist.latest.weekly !== null ? `${Math.round(hist.latest.weekly)}%` : '—'}
              foot={hist.latest ? relativeTime(hist.latest.t) : ''}
            />
          </div>

          <div className="uh-label">Weekly (all models): every reading</div>
          <WeeklyChart hist={hist} color={color} />

          <div className="uh-label">Session (5hr): highest reading each day</div>
          <SessionBars hist={hist} color={color} />

          <div className="legend">
            <span className="legend-item"><span className="swatch" style={{ background: color }} />Usage</span>
            <span className="legend-item"><span className="swatch" style={{ background: DANGER }} />Reached the limit</span>
            <span className="legend-item"><span className="uh-key-dash" />No readings in between</span>
          </div>
          <div className="limit-hint">
            {hist.readings.claude} {hist.readings.claude === 1 ? 'reading' : 'readings'} from Claude's own record
            {hist.readings.own > 0 ? ` and ${hist.readings.own} from Multi-Claude's checks` : ''}.
            Empty days had no readings: neither this account's Claude window nor its live limits were checked.
          </div>
        </>
      )}
    </div>
  );
}
