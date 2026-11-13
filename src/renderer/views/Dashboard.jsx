import React from 'react';
import { Meter } from '../components/AccountLimits.jsx';
import CcInstall from '../components/CcInstall.jsx';
import { bytes, relativeTime } from '../lib/format.js';

/**
 * One card per account. Each card shows only that account's own figures —
 * nothing here is summed or merged across accounts. Click a card to open the
 * account's page.
 */
function AccountCard({ account, running, scanOk, limitRow, size, lastUsed, cliMissing, actions, open }) {
  const isDefault = account.kind === 'default';
  const missing = account.exists === false;
  const isRunning = scanOk && running;

  const auth = limitRow && limitRow.auth;
  const signedIn = limitRow && limitRow.connected && auth && auth.loggedIn;
  const checking = limitRow && limitRow.connected && auth && auth.pending;
  const plan = limitRow && limitRow.plan;

  // The two meters Claude's own panel leads with.
  const meters = plan && plan.ok
    ? plan.meters.filter((m) => m.kind === 'session' || m.kind === 'weekly_all')
    : [];

  const stop = (fn) => (e) => { e.stopPropagation(); fn(); };

  return (
    <div className={missing ? 'acct-card missing' : 'acct-card'} onClick={open} role="button" tabIndex={0}
         onKeyDown={(e) => { if (e.key === 'Enter') open(); }}>
      <div className="acct-card-head">
        <span className={!scanOk ? 'dot unknown' : isRunning ? 'dot running' : 'dot'} />
        <div className="acct-card-title">
          <div className="name">
            {account.label}
            {isDefault && <span className="pill">Default</span>}
          </div>
          <div className="acct-card-sub">
            {cliMissing ? 'Usage limits need Claude Code installed'
              : !limitRow ? ' '
              : !limitRow.connected ? 'Not connected'
              : checking ? 'Checking sign-in…'
              : signedIn ? (auth.email || 'Signed in')
              : 'Sign-in not finished'}
          </div>
        </div>
        {isRunning ? (
          <button className="subtle" onClick={stop(() => actions.close(account))}>Close</button>
        ) : (
          <button className="primary" disabled={missing && !isDefault} onClick={stop(() => actions.launch(account))}>
            Launch
          </button>
        )}
      </div>

      <div className="acct-card-body">
        {meters.length > 0 && meters.map((m) => <Meter key={m.kind} m={m} />)}

        {signedIn && !plan && <div className="limit-hint">Loading limits…</div>}
        {signedIn && plan && !plan.ok && <div className="limit-hint">{plan.reason}</div>}

        {!cliMissing && limitRow && !signedIn && !checking && (
          <button className="ghost connect-inline" onClick={stop(() => actions.connect(limitRow))}>
            {limitRow.connected ? 'Sign in again to see limits' : 'Connect to see usage limits'}
          </button>
        )}
      </div>

      <div className="acct-card-foot">
        {size ? bytes(size) : ''}
        {size && lastUsed ? '  ·  ' : ''}
        {lastUsed ? `last used ${relativeTime(lastUsed)}` : ''}
        <span className="spacer" />
        <span className="open-hint">Open →</span>
      </div>
    </div>
  );
}

export default function Dashboard({
  accounts, running, scanOk, sizes, limits, limitsLoading, activity, actions, openAccount, onAdd
}) {
  const runningCount = accounts.filter((a) => running.includes(a.id)).length;
  const cliMissing = !!(limits && !limits.cli);
  const lastUsed = {};
  if (activity) for (const a of activity.accounts) lastUsed[a.id] = a.lastUsed;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <div className="sub">
            {accounts.length} {accounts.length === 1 ? 'account' : 'accounts'}
            {scanOk && runningCount > 0 ? ` · ${runningCount} running` : ''}
          </div>
        </div>
        <span className="spacer" />
        <button className="ghost" onClick={() => actions.refreshLimits(true)} disabled={limitsLoading}>
          {limitsLoading ? 'Refreshing…' : 'Refresh limits'}
        </button>
        <button className="primary" onClick={onAdd}>+ Add account</button>
      </div>

      {accounts.length === 0 && <div className="panel"><div className="empty">No accounts yet.</div></div>}

      {cliMissing && accounts.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <CcInstall onDone={() => actions.refreshLimits(true)} />
        </div>
      )}

      <div className="card-grid">
        {accounts.map((a) => (
          <AccountCard
            key={a.id}
            account={a}
            running={running.includes(a.id)}
            scanOk={scanOk}
            limitRow={limits && limits.accounts ? limits.accounts.find((r) => r.id === a.id) : null}
            size={sizes[a.id]}
            lastUsed={lastUsed[a.id]}
            cliMissing={cliMissing}
            actions={actions}
            open={() => openAccount(a.id)}
          />
        ))}
      </div>
    </>
  );
}
