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

function AccountLimits({ row, actions, busy }) {
  const { auth, limits, connected } = row;
  const signedIn = connected && auth && auth.loggedIn;

  return (
    <div className="limit-card">
      <div className="limit-card-head">
        <div>
          <div className="limit-name">{row.label}</div>
          <div className="limit-who">
            {!connected && 'Not connected'}
            {connected && !signedIn && 'Sign-in not finished'}
            {signedIn && (
              <>
                Signed in as <strong>{auth.email || 'unknown'}</strong>
                {auth.subscriptionType ? ` · ${auth.subscriptionType}` : ''}
              </>
            )}
          </div>
        </div>
        <div className="limit-actions">
          {!signedIn && (
            <button className="primary" disabled={busy} onClick={() => actions.connect(row)}>
              {connected ? 'Sign in again' : 'Connect'}
            </button>
          )}
          {signedIn && (
            <button className="ghost" disabled={busy} onClick={() => actions.openClaudeCode(row)}>
              Open Claude Code
            </button>
          )}
        </div>
      </div>

      {signedIn && limits && (
        <>
          <div className="limit-bars">
            <LimitBar title="Session (5hr)" win={limits.fiveHour} />
            <LimitBar title="Weekly (7 day)" win={limits.sevenDay} />
          </div>
          {limits.recordedAt && (
            <div className="limit-asof">As of {relativeTime(limits.recordedAt)} — updates whenever you use Claude Code with this account.</div>
          )}
        </>
      )}

      {signedIn && !limits && (
        <div className="note" style={{ marginTop: 12 }}>
          Signed in. Use Claude Code once with this account (send any message) and its limits
          appear here. If they never do, this plan doesn't report limits to Claude Code; Anthropic
          documents this for Pro, Max and Ultra.
        </div>
      )}

      {!connected && (
        <div className="limit-hint">
          Signs this account in to Claude Code through Anthropic's own login, once. Multi-Claude
          never sees the password or the sign-in token.
        </div>
      )}
      {connected && !signedIn && (
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
