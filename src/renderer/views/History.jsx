import React from 'react';
import StatTile from '../components/StatTile.jsx';
import BarList from '../charts/BarList.jsx';
import { duration, clockTime, relativeTime, seriesColor } from '../lib/format.js';

export default function History({ activity, accounts, days, setDays }) {
  if (!activity) {
    return (
      <>
        <div className="page-head"><h1>History</h1></div>
        <div className="skeleton" style={{ height: 200 }} />
      </>
    );
  }

  const colorFor = {};
  accounts.forEach((a, i) => { colorFor[a.id] = seriesColor(i); });

  const totalMs = activity.accounts.reduce((a, b) => a + b.ms, 0);
  const totalLaunches = activity.accounts.reduce((a, b) => a + b.launches, 0);

  const maxDay = Math.max(
    1,
    ...activity.daily.map((d) => Object.values(d.byAccount).reduce((a, b) => a + b, 0))
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>History</h1>
          <div className="sub">
            {activity.observedSince
              ? `Observed since ${clockTime(activity.observedSince)}`
              : 'Nothing recorded yet'}
          </div>
        </div>
        <span className="spacer" />
        <div className="seg">
          {[7, 30, 90].map((d) => (
            <button key={d} className={days === d ? 'on' : ''} onClick={() => setDays(d)}>{d}d</button>
          ))}
        </div>
      </div>

      <div className="stack">
        <div className="grid tiles">
          <StatTile label="Total time" value={duration(totalMs)} color="var(--series-1)"
                    foot={`${totalLaunches} launches recorded`} />
          <StatTile label="Accounts used" value={String(activity.accounts.length)} color="var(--series-2)"
                    foot={`of ${accounts.length} configured`} />
          <StatTile label="Sessions logged" value={String(activity.recent.length)} color="var(--series-3)"
                    foot="most recent 60 shown below" />
        </div>

        {activity.accounts.length > 0 && (
          <div className="panel">
            <div className="panel-title">Time per account</div>
            <BarList
              items={activity.accounts.map((a) => ({ key: a.id, label: a.label, value: a.ms }))}
              renderValue={(a) => duration(a.value)}
              colorAt={(i, item) => colorFor[item.key] || seriesColor(i)}
            />
          </div>
        )}

        <div className="panel">
          <div className="panel-title">Daily activity · last {days} days</div>
          <div className="panel-note">Minutes with a Claude profile open, stacked by account.</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 110, marginTop: 14 }}>
            {activity.daily.map((d) => {
              const entries = Object.entries(d.byAccount);
              const dayTotal = entries.reduce((a, [, ms]) => a + ms, 0);
              const h = (dayTotal / maxDay) * 100;
              return (
                <div
                  key={d.date}
                  title={`${d.date}: ${duration(dayTotal)}`}
                  style={{
                    flex: 1, height: '100%', display: 'flex', flexDirection: 'column',
                    justifyContent: 'flex-end', gap: 2, minWidth: 2
                  }}
                >
                  {entries.map(([id, ms]) => (
                    <div
                      key={id}
                      className="day-seg"
                      style={{
                        height: `${(ms / Math.max(dayTotal, 1)) * h}%`,
                        background: colorFor[id] || 'var(--faint)',
                        borderRadius: 3,
                        minHeight: ms > 0 ? 2 : 0
                      }}
                    />
                  ))}
                </div>
              );
            })}
          </div>
          <div className="legend">
            {accounts.map((a, i) => (
              <span className="legend-item" key={a.id}>
                <span className="swatch" style={{ background: colorFor[a.id] || seriesColor(i) }} />
                {a.label}
              </span>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-title">Recent sessions</div>
          {activity.recent.length === 0 ? (
            <div className="empty">
              Nothing recorded yet. Multi-Claude logs a session when it sees a profile
              running, so launch an account and it will appear here.
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Started</th>
                  <th style={{ textAlign: 'right' }}>Duration</th>
                </tr>
              </thead>
              <tbody>
                {activity.recent.map((s, i) => (
                  <tr key={`${s.id}-${s.start}-${i}`}>
                    <td>
                      <span className="bar-name">
                        <span className="swatch" style={{ background: colorFor[s.id] || 'var(--faint)' }} />
                        {s.label}
                      </span>
                    </td>
                    <td title={clockTime(s.start)} style={{ color: 'var(--muted)' }}>
                      {relativeTime(s.start)}
                    </td>
                    <td className="num">
                      {s.open ? <span className="pill accent">open</span> : duration(s.ms)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="note">
          Multi-Claude can only observe what is running while it is itself open. A profile
          you launch from a desktop shortcut with the manager closed is recorded from the
          moment the manager next opens, not from when it actually started.
        </div>
      </div>
    </>
  );
}
