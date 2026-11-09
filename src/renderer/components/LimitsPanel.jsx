import React from 'react';
import { relativeTime } from '../lib/format.js';

function resetText(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return `Resets at ${time}`;
  const day = d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  return `Resets ${day} at ${time}`;
}

/**
 * One plan-limit bar. Colour carries state only alongside a text label, never
 * on its own, and the status colours are the reserved ones.
 */
function LimitBar({ title, win }) {
  if (!win) return null;

  if (win.expired) {
    return (
      <div className="limit">
        <div className="limit-head">
          <span>{title}</span>
          <span className="limit-pct muted">reset</span>
        </div>
        <div className="limit-track"><div className="limit-fill" style={{ width: '0%' }} /></div>
        <div className="limit-foot">This window has reset. Use Claude Code to load the new figure.</div>
      </div>
    );
  }

  const pct = win.usedPct;
  const state = pct >= 95 ? 'critical' : pct >= 80 ? 'warn' : 'ok';
  return (
    <div className="limit">
      <div className="limit-head">
        <span>{title}</span>
        <span className="limit-pct">
          {Math.round(pct)}%
          {state === 'warn' && <span className="limit-flag warn"> · near limit</span>}
          {state === 'critical' && <span className="limit-flag critical"> · at limit</span>}
        </span>
      </div>
      <div className="limit-track">
        <div className={`limit-fill ${state}`} style={{ width: `${Math.max(pct, 1)}%` }} />
      </div>
      <div className="limit-foot">{resetText(win.resetsAt)}</div>
    </div>
  );
}

/** One meter from Claude Code's /usage report. The server sets the severity. */
function Meter({ m }) {
  const state = m.severity === 'critical' ? 'critical' : m.severity === 'warning' ? 'warn' : 'ok';
  return (
    <div className="limit">
      <div className="limit-head">
        <span>{m.title}</span>
        <span className="limit-pct">
          {Math.round(m.percent)}% used
          {state === 'warn' && <span className="limit-flag warn"> · near limit</span>}
          {state === 'critical' && <span className="limit-flag critical"> · at limit</span>}
        </span>
      </div>
      <div className="limit-track">
        <div className={`limit-fill ${state}`} style={{ width: `${Math.max(m.percent, 1)}%` }} />
      </div>
      <div className="limit-foot">{m.resetsAt ? resetText(m.resetsAt) : ''}</div>
    </div>
  );
}

function extraUsageText(eu) {
  if (!eu) return null;
  if (!eu.enabled) return 'Extra usage: off';
  const cur = eu.currency || 'USD';
  const fmt = (c) => (c / 100).toLocaleString(undefined, { style: 'currency', currency: cur });
  if (eu.usedCredits !== null && eu.monthlyLimit !== null) return `Extra usage: ${fmt(eu.usedCredits)} of ${fmt(eu.monthlyLimit)} this month`;
  if (eu.usedCredits !== null) return `Extra usage: ${fmt(eu.usedCredits)} this month`;
  return 'Extra usage: on';
}

function AccountLimits({ row, actions, busy }) {
  const { auth, limits, connected } = row;
  const signedIn = connected && auth && auth.loggedIn;
  const checking = connected && auth && auth.pending;

  return (
    <div className="limit-card">
      <div className="limit-card-head">
        <div>
          <div className="limit-name">{row.label}</div>
          <div className="limit-who">
            {!connected && 'Not connected'}
            {checking && 'Checking sign-in…'}
            {connected && !signedIn && !checking && 'Sign-in not finished'}
            {signedIn && (
              <>
                Signed in as <strong>{auth.email || 'unknown'}</strong>
                {auth.subscriptionType ? ` · ${auth.subscriptionType}` : ''}
              </>
            )}
          </div>
        </div>
        <div className="limit-actions">
          {!signedIn && !checking && (
            <button className="primary" disabled={busy} onClick={() => actions.connect(row)}>
              {connected ? 'Sign in again' : 'Connect'}
            </button>
          )}
        </div>
      </div>

      {signedIn && row.plan && row.plan.ok && (
        <>
          <div className="limit-bars">
            {row.plan.meters.map((m) => <Meter key={m.kind + (m.scopeLabel || '')} m={m} />)}
          </div>
          <div className="limit-asof">
            {row.plan.fetchedAt ? `Updated ${relativeTime(row.plan.fetchedAt)}` : ''}
            {extraUsageText(row.plan.extraUsage) ? ` · ${extraUsageText(row.plan.extraUsage)}` : ''}
          </div>
        </>
      )}

      {signedIn && !row.plan && (
        <div className="limit-hint">Loading this account's limits…</div>
      )}

      {signedIn && row.plan && !row.plan.ok && (
        <>
          {/* Fall back to what the status line last recorded, if anything. */}
          {limits && (
            <div className="limit-bars">
              <LimitBar title="Session (5hr)" win={limits.fiveHour} />
              <LimitBar title="Weekly (7 day)" win={limits.sevenDay} />
            </div>
          )}
          <div className="note" style={{ marginTop: 12 }}>
            {row.plan.reason}
            {row.plan.needsSignIn && ' Use Sign in again above.'}
            {row.plan.reachedModel && ' Automatic refresh is paused for this account so it cannot spend usage; Refresh still works.'}
          </div>
        </>
      )}

      {!connected && (
        <div className="limit-hint">
          Signs this account in to Claude Code through Anthropic's own login, once. Multi-Claude
          never sees the password or the sign-in token.
        </div>
      )}
      {connected && !signedIn && !checking && (
        <div className="limit-hint">
          The sign-in terminal may still be open. Finish it in the browser, then press Refresh.
        </div>
      )}
    </div>
  );
}

export default function LimitsPanel({ limits, loading, actions, busyId }) {
  return (
    <div className="panel">
      <div className="panel-title" style={{ justifyContent: 'space-between' }}>
        <span>Usage limits by account</span>
        <button className="ghost" onClick={() => actions.refreshLimits(true)} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      <div className="panel-note">
        Your real Session and Weekly limits, as Claude Code reports them for each signed-in
        account. These are account-wide: chat, Desktop and Claude Code all count toward them.
      </div>

      {!limits && <div className="skeleton" style={{ height: 120, marginTop: 14 }} />}

      {limits && !limits.cli && (
        <div className="note" style={{ marginTop: 14 }}>
          Claude Code isn't installed on this PC, and it's what reports these limits.
          Install it from code.claude.com, then press Refresh.
        </div>
      )}

      {limits && limits.cli && (
        <div className="limit-list">
          {limits.accounts.map((row) => (
            <AccountLimits key={row.id} row={row} actions={actions} busy={busyId === row.id} />
          ))}
        </div>
      )}
    </div>
  );
}
