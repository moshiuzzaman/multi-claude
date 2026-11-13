import React, { useState } from 'react';
import { relativeTime, timeLeft } from '../lib/format.js';
import CcInstall from './CcInstall.jsx';

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

/** Bars from the usage Claude Desktop records itself (see desktop-usage.js). */
export function desktopMeters(d) {
  if (!d) return [];
  const sev = (p) => (p >= 95 ? 'critical' : p >= 80 ? 'warning' : 'normal');
  const out = [];
  if (d.session !== null) out.push({ kind: 'session', group: 'session', title: 'Session (5hr)', percent: d.session, severity: sev(d.session) });
  if (d.weekly !== null) out.push({ kind: 'weekly_all', group: 'weekly', title: 'Weekly (all models)', percent: d.weekly, severity: sev(d.weekly) });
  return out;
}

/** The "as of" line under Desktop's figures, with the optional live upgrade. */
export function DesktopAsOf({ d, onLive, liveLabel = 'Live limits' }) {
  return (
    <div className="limit-asof desktop-asof">
      <span title="Claude Desktop records these a few times a day while it runs. They have no reset times.">
        From Claude · {relativeTime(d.recordedAt)}
      </span>
      {onLive && (
        <>
          {' · '}
          <button className="link inline-link" onClick={(e) => { e.stopPropagation(); onLive(); }}
                  title="Live figures with reset times, through one browser sign-in for Claude Code">
            {liveLabel}
          </button>
        </>
      )}
    </div>
  );
}

/**
 * One account's plan limits, used on the Dashboard cards and on the account's
 * own page. By default these are what the account's Claude window records
 * itself, so no second sign-in is needed. Live limits (with reset times) are
 * an optional extra through Claude Code.
 */
export function LimitsBlock({ row, actions, busy, cliMissing }) {
  const [installing, setInstalling] = useState(false);
  if (!row) return <div className="skeleton" style={{ height: 70 }} />;

  const { auth, limits, connected } = row;
  const free = !!row.freePlan;
  const signedIn = connected && auth && auth.loggedIn;
  const checking = connected && auth && auth.pending;
  const live = signedIn && row.plan && row.plan.ok;
  const fromDesktop = desktopMeters(row.desktop);

  const goLive = free ? null : () => {
    if (cliMissing) setInstalling(true);
    else actions.connect(row);
  };
  const liveLabel = connected && !signedIn ? 'Sign in again for live limits' : 'Live limits';

  return (
    <div className="limit-block">
      {live ? (
        <>
          <div className="limit-who">
            Live · signed in to Claude Code as <strong>{auth.email || 'unknown'}</strong>
            {auth.subscriptionType ? ` · ${auth.subscriptionType}` : ''}
          </div>
          <div className="limit-bars">
            {row.plan.meters.map((m) => <Meter key={m.kind + (m.scopeLabel || '')} m={m} />)}
          </div>
          <div className="limit-asof">
            {row.plan.fetchedAt ? `Updated ${relativeTime(row.plan.fetchedAt)}` : ''}
            {extraUsageText(row.plan.extraUsage) ? ` · ${extraUsageText(row.plan.extraUsage)}` : ''}
          </div>
        </>
      ) : (
        <>
          {fromDesktop.length > 0 ? (
            <>
              <div className="limit-bars">
                {fromDesktop.map((m) => <Meter key={m.kind} m={m} />)}
              </div>
              <DesktopAsOf d={row.desktop} onLive={checking || busy ? null : goLive} liveLabel={liveLabel} />
            </>
          ) : (
            <div className="limit-hint">
              Usage shows here once this account's Claude window has been used.
              {goLive && !checking && (
                <>
                  {' '}
                  <button className="link inline-link" onClick={goLive}>{liveLabel}</button>
                </>
              )}
            </div>
          )}

          {checking && <div className="limit-hint">Checking live limits…</div>}

          {signedIn && !row.plan && <div className="limit-hint">Loading live limits…</div>}

          {signedIn && row.plan && !row.plan.ok && (
            <>
              {/* What the status line last recorded, if anything. */}
              {limits && fromDesktop.length === 0 && (
                <div className="limit-bars">
                  <LimitBar title="Session (5hr)" win={limits.fiveHour} />
                  <LimitBar title="Weekly (7 day)" win={limits.sevenDay} weekly />
                </div>
              )}
              <div className="note" style={{ marginTop: 12 }}>
                Live limits: {row.plan.reason}
                {row.plan.needsSignIn && ' Use Sign in again for live limits.'}
                {row.plan.reachedModel && ' Automatic refresh is paused for this account so it cannot spend usage; Refresh still works.'}
              </div>
            </>
          )}

          {installing && cliMissing && (
            <div style={{ marginTop: 12 }}>
              <CcInstall onDone={() => { setInstalling(false); actions.refreshLimits(true); }} />
            </div>
          )}

          {free && (
            <div className="limit-hint">
              Free plan: live limits need Pro, Max or Ultra.{' '}
              <button className="link inline-link" onClick={() => actions.setFreePlan(row, false)}>Upgraded?</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
