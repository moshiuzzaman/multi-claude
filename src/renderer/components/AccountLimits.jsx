import React from 'react';
import { relativeTime, timeLeft } from '../lib/format.js';

export function resetText(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return `Resets at ${time}`;
  const day = d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  return `Resets ${day} at ${time}`;
}

/**
 * The line under a bar. A weekly window is days away, so it reads as time
 * left; the exact reset moment stays on hover. A session window resets within
 * hours, where the clock time is the more useful answer.
 */
function ResetFoot({ resetsAt, weekly }) {
  if (!resetsAt) return <div className="limit-foot" />;
  if (!weekly) return <div className="limit-foot">{resetText(resetsAt)}</div>;
  return <div className="limit-foot" title={resetText(resetsAt)}>{timeLeft(resetsAt)}</div>;
}

/**
 * One plan-limit bar. Colour carries state only alongside a text label, never
 * on its own, and the status colours are the reserved ones.
 */
function LimitBar({ title, win, weekly = false }) {
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
      <ResetFoot resetsAt={win.resetsAt} weekly={weekly} />
    </div>
  );
}

/** One meter from Claude Code's /usage report. The server sets the severity. */
export function Meter({ m }) {
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
      <ResetFoot resetsAt={m.resetsAt} weekly={m.group === 'weekly' || String(m.kind).startsWith('weekly')} />
    </div>
  );
}

export function extraUsageText(eu) {
  if (!eu) return null;
  if (!eu.enabled) return 'Extra usage: off';
  const cur = eu.currency || 'USD';
  const fmt = (c) => (c / 100).toLocaleString(undefined, { style: 'currency', currency: cur });
  if (eu.usedCredits !== null && eu.monthlyLimit !== null) return `Extra usage: ${fmt(eu.usedCredits)} of ${fmt(eu.monthlyLimit)} this month`;
  if (eu.usedCredits !== null) return `Extra usage: ${fmt(eu.usedCredits)} this month`;
  return 'Extra usage: on';
}

/**
 * One account's plan limits: sign-in state, its meters, and Connect when it
 * isn't signed in. Used on the Dashboard cards and on the account's own page.
 */
export function LimitsBlock({ row, actions, busy, cliMissing }) {
  if (cliMissing) {
    return (
      <div className="note">
        Claude Code wasn't found on this PC, and it's what reports usage limits. Open the
        Code tab in Claude Desktop once so it downloads its own copy, or install Claude Code
        from code.claude.com, then refresh.
      </div>
    );
  }
  if (!row) return <div className="skeleton" style={{ height: 70 }} />;

  const { auth, limits, connected } = row;
  const signedIn = connected && auth && auth.loggedIn;
  const checking = connected && auth && auth.pending;

  return (
    <div className="limit-block">
      <div className="limit-card-head">
        <div>
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
              <LimitBar title="Weekly (7 day)" win={limits.sevenDay} weekly />
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
          Sign-in isn't finished for this account. Use Sign in again to complete it.
        </div>
      )}
    </div>
  );
}
