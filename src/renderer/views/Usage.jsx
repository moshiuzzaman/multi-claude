import React from 'react';
import StatTile from '../components/StatTile.jsx';
import AreaChart from '../charts/AreaChart.jsx';
import BarList from '../charts/BarList.jsx';
import { compact, full, usd, modelName, shortDate } from '../lib/format.js';

export default function Usage({ usage, usageLoading, days, setDays, actions }) {
  if (usageLoading && !usage) {
    return (
      <>
        <div className="page-head"><h1>Usage</h1></div>
        <div className="stack">
          <div className="skeleton" style={{ height: 86 }} />
          <div className="skeleton" style={{ height: 220 }} />
          <div className="skeleton" style={{ height: 180 }} />
        </div>
      </>
    );
  }

  if (!usage || usage.unavailable) {
    return (
      <>
        <div className="page-head"><h1>Usage</h1></div>
        <div className="panel">
          <div className="empty">{(usage && usage.message) || 'No usage data available.'}</div>
        </div>
      </>
    );
  }

  const daily = usage.daily.map((d) => ({ date: d.date, value: d.output + d.input }));
  const cacheDaily = usage.daily.map((d) => ({ date: d.date, value: d.cacheRead }));
  const t = usage.totals;
  const attributedPct = usage.coverage.sessions
    ? Math.round((usage.coverage.attributedSessions / usage.coverage.sessions) * 100)
    : 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Usage</h1>
          <div className="sub">
            {usage.coverage.sessions} sessions
            {usage.coverage.firstTs
              ? ` · ${shortDate(new Date(usage.coverage.firstTs).toISOString().slice(0, 10))} to ${shortDate(new Date(usage.coverage.lastTs).toISOString().slice(0, 10))}`
              : ''}
          </div>
        </div>
        <span className="spacer" />
        <div className="seg">
          {[7, 30, 90].map((d) => (
            <button key={d} className={days === d ? 'on' : ''} onClick={() => setDays(d)}>{d}d</button>
          ))}
        </div>
        <button className="ghost" onClick={actions.refreshUsage}>Refresh</button>
      </div>

      <div className="stack">
        <div className="grid tiles">
          <StatTile label="Output tokens · all time" value={compact(t.output)} color="var(--series-1)"
                    foot={full(t.output)} />
          <StatTile label="Input tokens · all time" value={compact(t.input)} color="var(--series-2)"
                    foot={full(t.input)} />
          <StatTile label="Cache reads · all time" value={compact(t.cacheRead)} color="var(--series-3)"
                    foot={`${compact(t.cacheWrite)} cache writes`} />
          <StatTile label="Thinking tokens" value={compact(t.thinking)} color="var(--series-5)"
                    foot={`${full(t.messages)} messages`} />
        </div>

        <div className="panel">
          <div className="panel-title">Input + output tokens per day</div>
          <div style={{ marginTop: 10 }}>
            <AreaChart data={daily} valueLabel="tokens" color="var(--series-1)" />
          </div>
        </div>

        <div className="panel">
          <div className="panel-title">Cache reads per day</div>
          <div className="panel-note">
            Cache reads dwarf fresh input tokens, which is why they get their own chart —
            plotting both on one axis would flatten the line above into nothing.
          </div>
          <div style={{ marginTop: 10 }}>
            <AreaChart data={cacheDaily} valueLabel="cache reads" color="var(--series-2)" />
          </div>
        </div>

        <div className="grid halves">
          <div className="panel">
            <div className="panel-title">By model</div>
            <table className="table">
              <thead>
                <tr>
                  <th>Model</th>
                  <th style={{ textAlign: 'right' }}>Output</th>
                  <th style={{ textAlign: 'right' }}>Cache read</th>
                  <th style={{ textAlign: 'right' }}>Messages</th>
                </tr>
              </thead>
              <tbody>
                {usage.byModel.map((m) => (
                  <tr key={m.key}>
                    <td title={m.key}>{modelName(m.key)}</td>
                    <td className="num">{compact(m.output)}</td>
                    <td className="num">{compact(m.cacheRead)}</td>
                    <td className="num">{full(m.messages)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="panel">
            <div className="panel-title">Top projects by output tokens</div>
            <BarList
              items={usage.byProject.map((p) => ({ key: p.key, label: p.key, value: p.output }))}
              renderValue={(p) => compact(p.value)}
            />
          </div>
        </div>

        <div className="panel">
          <div className="panel-title">Attribution by account</div>
          <div className="panel-note">
            Only {attributedPct}% of sessions ({usage.coverage.attributedSessions} of{' '}
            {usage.coverage.sessions}) carry an account identifier. Claude Code writes its
            logs to your home folder, shared by every profile, so the rest genuinely cannot
            be attributed and are grouped honestly rather than guessed at.
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>Account</th>
                <th style={{ textAlign: 'right' }}>Sessions</th>
                <th style={{ textAlign: 'right' }}>Output</th>
                <th style={{ textAlign: 'right' }}>Recorded cost</th>
              </tr>
            </thead>
            <tbody>
              {usage.byOrg.map((o) => (
                <tr key={o.key}>
                  <td>
                    {o.attributed
                      ? <span title={o.key}>Org {o.key.slice(0, 8)}</span>
                      : <span style={{ color: 'var(--muted)' }}>Unattributed</span>}
                  </td>
                  <td className="num">{o.sessions}</td>
                  <td className="num">{compact(o.output)}</td>
                  <td className="num">{o.cost > 0 ? usd(o.cost) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="note">
          These numbers come from Claude Code session logs in your home folder. They cover
          Claude Code usage only — not Claude.ai chat — and the app reads counts, timestamps,
          model names and folder paths, never message text. Cost is shown only for the{' '}
          {usage.cost.sessions} sessions that recorded it.
        </div>
      </div>
    </>
  );
}
