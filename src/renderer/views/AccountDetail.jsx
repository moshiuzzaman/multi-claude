import React from 'react';
import StatTile from '../components/StatTile.jsx';
import StackedBar from '../charts/StackedBar.jsx';
import { LimitsBlock } from '../components/AccountLimits.jsx';
import { STORAGE_CATEGORIES } from '../lib/storageCategories.js';
import { bytes, duration, relativeTime, clockTime } from '../lib/format.js';

/**
 * Everything about one account, and nothing about the others: its usage
 * limits, its state and actions, its disk usage, and its launch history.
 */
export default function AccountDetail({
  accountId, accounts, running, scanOk, limits, limitsLoading, storage, activity, actions, setView
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
  const sessions = activity && activity.recent ? activity.recent.filter((s) => s.id === account.id).slice(0, 10) : [];

  return (
    <>
      <button className="link back" onClick={() => setView('dashboard')}>← All accounts</button>

      <div className="page-head detail-head">
        <span className={!scanOk ? 'dot unknown' : isRunning ? 'dot running' : 'dot'} />
        <div style={{ minWidth: 0 }}>
          <h1>
            {account.label}
            {isDefault && <span className="pill" style={{ marginLeft: 10 }}>Default</span>}
            {account.kind === 'imported' && <span className="pill" style={{ marginLeft: 10 }}>Imported</span>}
          </h1>
          <div className="sub detail-path" title={account.dir}>
            {missing ? 'Folder missing' : account.dir}
          </div>
        </div>
        <span className="spacer" />
        <div className="actions">
          {isRunning ? (
            <button className="subtle" onClick={() => actions.close(account)}>Close</button>
          ) : (
            <button className="primary" onClick={() => actions.launch(account)} disabled={missing && !isDefault}>
              Launch
            </button>
          )}
          <button className="ghost" onClick={() => actions.openFolder(account)} disabled={missing}>Folder</button>
          <button className="ghost" onClick={() => actions.shortcut(account)}>Shortcut</button>
          <button className="ghost" onClick={() => actions.openVsCode(account)} title="Open VS Code signed in as this account">
            VS Code
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

        <div className="grid halves">
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
            <div style={{ marginTop: 12 }}>
              {!store && <div className="skeleton" style={{ height: 60 }} />}
              {store && !store.exists && <div className="note">This folder no longer exists.</div>}
              {store && store.exists && (
                <StackedBar
                  total={store.total}
                  segments={STORAGE_CATEGORIES.map((c) => ({ ...c, value: store[c.key] }))}
                />
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
            {sessions.length > 0 ? (
              <table className="table">
                <thead>
                  <tr><th>Started</th><th style={{ textAlign: 'right' }}>Duration</th></tr>
                </thead>
                <tbody>
                  {sessions.map((s, i) => (
                    <tr key={`${s.start}-${i}`}>
                      <td title={clockTime(s.start)} style={{ color: 'var(--muted)' }}>{relativeTime(s.start)}</td>
                      <td className="num">{s.open ? <span className="pill accent">open</span> : duration(s.ms)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="limit-hint">No sessions recorded for this account yet.</div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
