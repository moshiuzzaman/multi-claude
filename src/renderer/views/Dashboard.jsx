import React from 'react';
import { Meter, desktopMeters, DesktopAsOf } from '../components/AccountLimits.jsx';
import { bytes, relativeTime } from '../lib/format.js';
import { Avatar } from '../components/Avatar.jsx';

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
  const free = !!(limitRow && limitRow.freePlan);

  // Live figures when Claude Code is connected; otherwise what the account's
  // own Claude window recorded, so no second sign-in is needed.
  const live = !!(signedIn && plan && plan.ok);
  const desktop = limitRow && limitRow.desktop;
  const meters = live
    ? plan.meters.filter((m) => m.kind === 'session' || m.kind === 'weekly_all')
    : desktopMeters(desktop);
  // Live limits are optional. Without Claude Code on the PC, the account's
  // page offers to download it.
  const goLive = free || checking ? null
    : cliMissing ? open
    : () => actions.connect(limitRow);

  const stop = (fn) => (e) => { e.stopPropagation(); fn(); };

  return (
    <div className={missing ? 'acct-card missing' : 'acct-card'} onClick={open} role="button" tabIndex={0}
         onKeyDown={(e) => { if (e.key === 'Enter') open(); }}>
      <div className="acct-card-head">
        <Avatar account={account} size={46} status={!scanOk ? 'unknown' : isRunning ? 'running' : 'stopped'} />
        <div className="acct-card-title">
          <div className="name">
            {account.label}
            {isDefault && <span className="pill">Default</span>}
            {account.signedIn === false && (
              <span className="pill warn" title="This account's Claude window isn't signed in yet. Launch shows the one-time steps.">
                Not signed in
              </span>
            )}
          </div>
          <div className="acct-card-sub">
            {account.signedIn === false ? 'Claude window not signed in yet'
              : live ? (auth.email || 'Signed in')
              : free ? 'Free plan'
              : account.signedIn ? 'Signed in to Claude'
              : ' '}
          </div>
        </div>
        {isRunning ? (
          <div className="acct-card-btns">
            <button className="primary" onClick={stop(() => actions.show(account))} title="Bring this account's Claude window to the front">Show</button>
            <button className="subtle" onClick={stop(() => actions.close(account))}>Close</button>
          </div>
        ) : (
          <div className="acct-card-btns">
            <button className="primary" disabled={missing && !isDefault} onClick={stop(() => actions.launch(account))}>
              Launch
            </button>
            <button className="subtle" disabled title="Not running" onClick={stop(() => {})}>Close</button>
          </div>
        )}
      </div>

      <div className="acct-card-body">
        {meters.length > 0 && meters.map((m) => <Meter key={m.kind} m={m} />)}

        {!live && desktop && meters.length > 0 && (
          <DesktopAsOf d={desktop} onLive={goLive}
                       liveLabel={limitRow && limitRow.connected && !signedIn ? 'Sign in again for live limits' : 'Live limits'} />
        )}
        {!live && meters.length === 0 && limitRow && (
          <div className="limit-hint">
            {account.signedIn === false
              ? 'Sign in to its Claude window once, then its usage shows here.'
              : "Usage shows here once this account's Claude window has been used."}
          </div>
        )}
        {signedIn && !plan && meters.length === 0 && <div className="limit-hint">Loading limits…</div>}
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
