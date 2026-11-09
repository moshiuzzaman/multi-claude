import React from 'react';
import StatTile from '../components/StatTile.jsx';
import AccountRow from '../components/AccountRow.jsx';
import AreaChart from '../charts/AreaChart.jsx';
import BarList from '../charts/BarList.jsx';
import { compact, bytes, usd, modelName, seriesColor, duration } from '../lib/format.js';

export default function Dashboard({
  accounts, running, scanOk, sizes, usage, usageLoading, activity, storage, days, setDays, actions, setView
}) {
  const runningCount = running.length;
  const totalBytes = storage ? storage.reduce((a, s) => a + s.total, 0) : null;
  const w = usage && !usage.unavailable ? usage.windowTotals : null;

  const daily = usage && !usage.unavailable
    ? usage.daily.map((d) => ({ date: d.date, value: d.output + d.input }))
    : [];

  const models = usage && !usage.unavailable
    ? usage.byModel.slice(0, 5).map((m) => ({
        key: m.key, label: modelName(m.key), title: m.key,
        value: m.output, messages: m.messages
      }))
    : [];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <div className="sub">
            {accounts.length} {accounts.length === 1 ? 'account' : 'accounts'}
            {runningCount > 0 && scanOk ? ` · ${runningCount} running now` : ''}
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
          <StatTile
            label={`Output tokens · ${days}d`}
            value={w ? compact(w.output) : usageLoading ? '…' : '—'}
            color="var(--series-1)"
            foot={w ? `${compact(w.messages)} messages` : 'reading session logs'}
          />
          <StatTile
            label={`Cache reads · ${days}d`}
            value={w ? compact(w.cacheRead) : usageLoading ? '…' : '—'}
            color="var(--series-2)"
            foot={w ? `${compact(w.cacheWrite)} written` : ''}
          />
          <StatTile
            label="Recorded cost"
            value={usage && !usage.unavailable ? usd(usage.cost.total) : '—'}
            color="var(--series-4)"
            foot={
              usage && !usage.unavailable
                ? usage.cost.partial
                  ? `partial — ${usage.cost.sessions} of ${usage.coverage.sessions} sessions logged cost`
                  : 'all sessions logged cost'
                : ''
            }
          />
          <StatTile
            label="Profile storage"
            value={totalBytes === null ? '…' : bytes(totalBytes)}
            color="var(--series-3)"
            foot={totalBytes === null ? 'measuring folders' : `${accounts.length} profiles on disk`}
          />
        </div>

        <div className="panel">
          <div className="panel-title">Tokens per day · last {days} days</div>
          <div className="panel-note">Input plus output, from Claude Code session logs.</div>
          {usageLoading && !usage && <div className="skeleton" style={{ height: 170, marginTop: 12 }} />}
          {usage && usage.unavailable && <div className="empty">{usage.message}</div>}
          {usage && !usage.unavailable && daily.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <AreaChart data={daily} valueLabel="tokens" />
            </div>
          )}
        </div>

        <div className="grid halves">
          <div className="panel">
            <div className="panel-title">Output tokens by model</div>
            {usageLoading && !usage && <div className="skeleton" style={{ height: 150, marginTop: 12 }} />}
            {usage && !usage.unavailable && (
              <BarList
                items={models}
                renderValue={(m) => compact(m.value)}
              />
            )}
          </div>

          <div className="panel">
            <div className="panel-title">Accounts</div>
            <div className="panel-note">Launch one, or open the Accounts tab to manage them.</div>
            <div className="stack" style={{ marginTop: 12, gap: 9 }}>
              {accounts.slice(0, 4).map((a) => (
                <AccountRow
                  key={a.id}
                  account={a}
                  running={running.includes(a.id)}
                  scanOk={scanOk}
                  size={sizes[a.id]}
                  actions={actions}
                  compactView
                />
              ))}
            </div>
            {accounts.length > 4 && (
              <button className="ghost" style={{ marginTop: 10 }} onClick={() => setView('accounts')}>
                View all {accounts.length}
              </button>
            )}
          </div>
        </div>

        {activity && activity.accounts.length > 0 && (
          <div className="panel">
            <div className="panel-title">Time per account · observed by Multi-Claude</div>
            <BarList
              items={activity.accounts.map((a) => ({ key: a.id, label: a.label, value: a.ms }))}
              renderValue={(a) => duration(a.value)}
              colorAt={(i) => seriesColor(i)}
            />
          </div>
        )}
      </div>
    </>
  );
}
