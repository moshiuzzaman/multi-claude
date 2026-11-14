import React from 'react';
import StatTile from '../components/StatTile.jsx';
import { Avatar, ColorPicker } from '../components/Avatar.jsx';
import { colorOf, colorName } from '../lib/colors.js';
import StackedBar from '../charts/StackedBar.jsx';
import { LimitsBlock } from '../components/AccountLimits.jsx';
import UsageHistory from '../components/UsageHistory.jsx';
import { AccountCheckPill, AccountCheckBanner } from '../components/AccountCheck.jsx';
import { STORAGE_CATEGORIES } from '../lib/storageCategories.js';
import { bytes, duration, relativeTime, clockTime } from '../lib/format.js';

// What each storage category is, in a few words, so the sizes mean something.
const STORAGE_HINTS = {
  vm: 'Sandbox images for Claude\'s tools',
  runtime: 'Claude Code copies kept in this profile',
  cache: 'Rebuilt on next launch, safe to clear',
  sessions: 'Code and agent session logs',
  data: 'Sign-in, settings and everything else'
};

const RECENT_SHOWN = 5;

/** "Today 13:35", "Yesterday 00:37" or "Wed 12 Nov 09:10". */
function sessionWhen(t) {
  const d = new Date(t);
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const startOf = (x) => { const c = new Date(x); c.setHours(0, 0, 0, 0); return c.getTime(); };
  const days = Math.round((startOf(Date.now()) - startOf(t)) / 86400000);
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Yesterday ${time}`;
  return `${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} ${time}`;
}

/**
 * Everything about one account, and nothing about the others: its usage
 * limits, its state and actions, its disk usage, and its launch history.
 */
export default function AccountDetail({
  accountId, accounts, running, scanOk, limits, limitsLoading, storage, activity, settings, actions, setView
}) {
  const account = accounts.find((a) => a.id === accountId);

  if (!account) {
    return (
      <>
        <button className="link back" onClick={() => setView('dashboard')}>← All accounts</button>
        <div className="panel"><div className="empty">This account no longer exists.</div></div>
      </>
    );
  }

  const isDefault = account.kind === 'default';
  const missing = account.exists === false;
  const isRunning = scanOk && running.includes(account.id);

  const limitRow = limits && limits.accounts ? limits.accounts.find((r) => r.id === account.id) : null;
  const store = storage ? storage.find((s) => s.id === account.id) : null;

  const act = activity && activity.accounts ? activity.accounts.find((a) => a.id === account.id) : null;
  const allSessions = activity && activity.recent ? activity.recent.filter((s) => s.id === account.id) : [];
  // The newest few, with real times; the full list is on the History page.
  const recent = allSessions.slice(0, RECENT_SHOWN);
  const totalSessions = act ? Math.max(act.launches || 0, allSessions.length) : allSessions.length;
  const longest = Math.max(1, ...recent.filter((s) => !s.open).map((s) => s.ms || 0));

  return (
    <>
      <button className="link back" onClick={() => setView('dashboard')}>← All accounts</button>

      <div className="page-head detail-head">
        <Avatar account={account} size={58} status={!scanOk ? 'unknown' : isRunning ? 'running' : 'stopped'} />
        <div style={{ minWidth: 0 }}>
          <h1>
            {account.label}
            {isDefault && <span className="pill" style={{ marginLeft: 10 }}>Default</span>}
            {account.kind === 'imported' && <span className="pill" style={{ marginLeft: 10 }}>Imported</span>}
            {account.signedIn === false && (
              <span className="pill warn" style={{ marginLeft: 10 }}
                    title="This account's Claude window isn't signed in yet. Launch shows the one-time steps.">
                Not signed in
              </span>
            )}
            <span style={{ marginLeft: 10 }}><AccountCheckPill account={account} /></span>
          </h1>
          <div className="sub detail-path" title={account.dir}>
            {missing ? 'Folder missing' : account.dir}
          </div>
        </div>
        <span className="spacer" />
        <div className="actions">
          {isRunning ? (
            <>
              <button className="primary" onClick={() => actions.show(account)} title="Bring this account's Claude window to the front">Show</button>
              <button className="subtle" onClick={() => actions.close(account)}>Close</button>
            </>
          ) : (
            <>
              <button className="primary" onClick={() => actions.launch(account)} disabled={missing && !isDefault}>
                Launch
              </button>
              <button className="subtle" disabled title="Not running">Close</button>
            </>
          )}
          {!isDefault && (
            <button className="ghost" onClick={() => actions.signInHelp(account)} title="How to sign in to this account's Claude window">
              Sign-in help
            </button>
          )}
          <button className="ghost" onClick={() => actions.shortcut(account)}>Shortcut</button>
          <button className="ghost" onClick={() => actions.useVsCodeAccount(account)} title="Make VS Code use this account">
            Use in VS Code
          </button>
          <button className="ghost" onClick={() => actions.openTerminal(account)} title="Open a Claude Code terminal for this account">
            Terminal
          </button>
          <button className="ghost" onClick={() => actions.startRename(account)}>Rename</button>
          <button
            className="ghost"
            onClick={() => actions.startDelete(account)}
            disabled={isDefault}
            title={isDefault ? 'The default account cannot be deleted.' : 'Delete permanently'}
          >
            Delete
          </button>
        </div>
      </div>

      <div className="color-row">
        <span className="color-row-label">Colour</span>
        <ColorPicker value={colorOf(account)} onChange={(hex) => actions.setColor(account, hex)} />
        <span className="color-row-name">{colorName(colorOf(account))}</span>
        {settings && settings.alertsSupported && (
          <label className="mute-row" title="This account's usage is still followed; it just shows no notifications.">
            <input
              type="checkbox"
              checked={account.muteAlerts === true}
              onChange={(e) => actions.setMuteAlerts(account, e.target.checked)}
            />
            Mute limit alerts
            {settings.alerts && !settings.alerts.on && <span className="color-row-name">(alerts are off on the Accounts page)</span>}
          </label>
        )}
      </div>

      <AccountCheckBanner account={account} actions={actions} />

      <div className="stack">
        <div className="panel">
          <div className="panel-title" style={{ justifyContent: 'space-between' }}>
            <span>Usage limits</span>
            <button className="ghost" onClick={() => actions.refreshLimits(true)} disabled={limitsLoading}>
              {limitsLoading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
          <div style={{ marginTop: 12 }}>
            <LimitsBlock row={limitRow} actions={actions} cliMissing={limits && !limits.cli} />
          </div>
        </div>

        <UsageHistory account={account} color={colorOf(account)} refreshKey={limits} />

        <div className="grid halves detail-pair">
          <div className="panel">
            <div className="panel-title" style={{ justifyContent: 'space-between' }}>
              <span>Storage{store ? ` · ${bytes(store.total)}` : ''}</span>
              {store && store.exists && (
                <button
                  className="ghost"
                  disabled={isRunning || store.cache === 0}
                  title={isRunning ? 'Close this Claude window first' : 'Delete cache folders'}
                  onClick={() => actions.purgeCache(account)}
                >
                  Clear {bytes(store.cache)} cache
                </button>
              )}
            </div>
            <div className="panel-body">
              {!store && <div className="skeleton" style={{ height: 60 }} />}
              {store && !store.exists && <div className="note">This folder no longer exists.</div>}
              {store && store.exists && (
                <>
                  <StackedBar
                    total={store.total}
                    legend={false}
                    segments={STORAGE_CATEGORIES.map((c) => ({ ...c, value: store[c.key] }))}
                  />
                  <div className="breakdown">
                    {STORAGE_CATEGORIES.map((c) => {
                      const v = store[c.key] || 0;
                      const share = store.total > 0 ? (v / store.total) * 100 : 0;
                      return (
                        <div className="breakdown-row" key={c.key}>
                          <span className="swatch" style={{ background: c.color }} />
                          <span className="breakdown-name">
                            {c.label}
                            <span className="breakdown-hint">{STORAGE_HINTS[c.key]}</span>
                          </span>
                          <span className="breakdown-size">{bytes(v)}</span>
                          <span className="breakdown-pct">{share < 1 && v > 0 ? '<1' : Math.round(share)}%</span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="panel-foot">
                    {isRunning
                      ? 'Close this account\'s Claude window to clear its cache.'
                      : 'Clearing the cache is safe: Claude rebuilds it on its next launch.'}
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="panel">
            <div className="panel-title">Activity · last 30 days</div>
            <div className="mini-tiles">
              <StatTile label="Time open" value={act ? duration(act.ms) : '0m'} />
              <StatTile label="Launches" value={act ? String(act.launches) : '0'} />
              <StatTile label="Last used" value={act && act.lastUsed ? relativeTime(act.lastUsed) : 'never'} />
            </div>
            {recent.length > 0 ? (
              <>
                <div className="recent-head">Recent sessions</div>
                <div className="recent">
                  {recent.map((s, i) => (
                    <div className="recent-row" key={`${s.start}-${i}`} title={clockTime(s.start)}>
                      <span className="recent-when">{sessionWhen(s.start)}</span>
                      <span className="recent-bar">
                        <span style={{ width: `${s.open ? 100 : Math.max(3, (s.ms / longest) * 100)}%` }}
                              className={s.open ? 'open' : ''} />
                      </span>
                      <span className="recent-dur">
                        {s.open ? <span className="pill accent">open</span> : duration(s.ms)}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="panel-foot">
                  {totalSessions > recent.length ? `${recent.length} of ${totalSessions} sessions shown. ` : ''}
                  <button className="link inline-link" onClick={() => setView('history')}>All activity in History →</button>
                </div>
              </>
            ) : (
              <div className="limit-hint">No sessions recorded for this account yet.</div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
