import React, { useState } from 'react';
import Gauge from '../charts/Gauge.jsx';
import BarList from '../charts/BarList.jsx';
import LimitsPanel from '../components/LimitsPanel.jsx';
import { compact, full, foldOther } from '../lib/format.js';

function shortSkill(key) {
  const i = key.indexOf(':');
  return i === -1 ? key : key.slice(i + 1);
}

function prettyDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, {
    year: 'numeric', month: 'long', day: 'numeric'
  });
}

const LABELS = {
  emailAddress: 'Email',
  displayName: 'Name',
  organizationName: 'Organization',
  organizationType: 'Plan',
  organizationRole: 'Role',
  seatTier: 'Seat',
  billingType: 'Billing',
  userRateLimitTier: 'Rate limit tier',
  organizationRateLimitTier: 'Org rate limit tier',
  hasExtraUsageEnabled: 'Extra usage'
};

const ORDER = [
  'emailAddress', 'displayName', 'organizationName', 'organizationType',
  'organizationRole', 'seatTier', 'billingType', 'userRateLimitTier',
  'organizationRateLimitTier', 'hasExtraUsageEnabled'
];

export default function Account({ usage, usageLoading, accountInfo, accounts, actions, limits, limitsLoading, limitsBusyId }) {
  const [win, setWin] = useState('day');

  const rolling = usage && !usage.unavailable ? usage.rolling : null;
  const contrib = usage && !usage.unavailable ? usage.contrib[win] : null;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Account &amp; Usage</h1>
          <div className="sub">What this machine can actually see.</div>
        </div>
      </div>

      <div className="stack">
        <LimitsPanel limits={limits} loading={limitsLoading} actions={actions} busyId={limitsBusyId} />

        {/* ---- rolling windows ---- */}
        <div className="panel">
          <div className="panel-title">Local token volume · all accounts</div>
          <div className="panel-note">
            Token counts from the Claude Code logs on this PC, compared with your own busiest
            stretch. Not a plan limit — those are in the panel above, per account.
          </div>

          {usageLoading && !usage && <div className="skeleton" style={{ height: 120, marginTop: 14 }} />}

          {rolling && (
            <div className="gauges">
              <Gauge label="Last 5 hours" value={rolling.fiveHour.output + rolling.fiveHour.input}
                     peak={rolling.fiveHour.peak} color="var(--series-1)"
                     resetNote={`${full(rolling.fiveHour.messages)} messages`} />
              <Gauge label="Last 7 days" value={rolling.sevenDay.output + rolling.sevenDay.input}
                     peak={rolling.sevenDay.peak} color="var(--series-2)"
                     resetNote={`${full(rolling.sevenDay.messages)} messages`} />
            </div>
          )}
        </div>

        {/* ---- contributing ---- */}
        <div className="panel">
          <div className="panel-title" style={{ justifyContent: 'space-between' }}>
            <span>What&apos;s contributing to your usage?</span>
            <span className="seg">
              <button className={win === 'day' ? 'on' : ''} onClick={() => setWin('day')}>Day</button>
              <button className={win === 'week' ? 'on' : ''} onClick={() => setWin('week')}>Week</button>
            </span>
          </div>
          <div className="panel-note">
            Sessions on this machine only, counted over sessions last active in the{' '}
            {win === 'day' ? 'past 24 hours' : 'past 7 days'}.
          </div>

          {usageLoading && !usage && <div className="skeleton" style={{ height: 180, marginTop: 14 }} />}

          {contrib && (
            <div className="grid halves" style={{ marginTop: 14 }}>
              <div>
                <div className="sub-title">Skills · by tokens</div>
                <BarList
                  items={foldOther(contrib.skills.map((s) => ({
                    key: s.key, label: shortSkill(s.key), title: s.key, value: s.value
                  })))}
                  renderValue={(s) => compact(s.value)}
                />
              </div>
              <div>
                <div className="sub-title">Plugins · by tokens</div>
                <BarList
                  items={foldOther(contrib.plugins.map((p) => ({ key: p.key, label: p.key, value: p.value })))}
                  renderValue={(p) => compact(p.value)}
                />
                <div className="sub-title" style={{ marginTop: 18 }}>MCP servers · by tool calls</div>
                <BarList
                  items={foldOther(contrib.mcp.map((m) => ({
                    key: m.key, label: m.key.length > 22 ? m.key.slice(0, 20) + '…' : m.key,
                    title: m.key, value: m.value
                  })))}
                  renderValue={(m) => `${full(m.value)} calls`}
                />
              </div>
            </div>
          )}

          {contrib && (
            <div className="note" style={{ marginTop: 16 }}>
              Skills and plugins are measured in tokens, taken straight off the assistant
              turns they were attributed to. MCP servers are measured in tool calls instead:
              a single turn can call several servers, so splitting its tokens between them
              would be an invented number.
            </div>
          )}
        </div>

        {/* ---- account identity ---- */}
        <div className="panel">
          <div className="panel-title">Claude Code account</div>
          {!accountInfo ? (
            <div className="skeleton" style={{ height: 90, marginTop: 12 }} />
          ) : !accountInfo.available ? (
            <div className="note" style={{ marginTop: 12 }}>{accountInfo.reason}</div>
          ) : (
            <>
              <div className="panel-note">
                This is the single account Claude Code is signed in as. It is not
                per-profile: this config lives in your home folder and is shared by every
                Claude Desktop profile, so it may well differ from the account a given
                profile is logged into.
              </div>
              <table className="table">
                <tbody>
                  {ORDER.filter((k) => accountInfo.account[k] !== undefined).map((k) => (
                    <tr key={k}>
                      <td style={{ color: 'var(--muted)', width: '42%' }}>{LABELS[k] || k}</td>
                      <td style={{ userSelect: 'text' }}>
                        {typeof accountInfo.account[k] === 'boolean'
                          ? (accountInfo.account[k] ? 'Enabled' : 'Disabled')
                          : String(accountInfo.account[k])}
                      </td>
                    </tr>
                  ))}
                  {prettyDate(accountInfo.account.accountCreatedAt) && (
                    <tr>
                      <td style={{ color: 'var(--muted)' }}>Member since</td>
                      <td>{prettyDate(accountInfo.account.accountCreatedAt)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </>
          )}
        </div>

      </div>
    </>
  );
}
