import React from 'react';
import AccountRow from '../components/AccountRow.jsx';
import AlertSettings from '../components/AlertSettings.jsx';
import { isMac } from '../lib/api.js';

export default function Accounts({ accounts, running, scanOk, sizes, activity, settings, actions, onAdd, openAccount }) {
  const lastUsed = {};
  if (activity) for (const a of activity.accounts) lastUsed[a.id] = a.lastUsed;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Accounts</h1>
          <div className="sub">Each account is a separate Claude profile. Click one to open its page.</div>
        </div>
        <span className="spacer" />
        <button className="primary" onClick={onAdd}>+ Add account</button>
      </div>

      <div className="stack">
        {accounts.length === 0 && <div className="empty">No accounts yet.</div>}
        {accounts.map((a) => (
          <AccountRow
            key={a.id}
            account={a}
            running={running.includes(a.id)}
            scanOk={scanOk}
            size={sizes[a.id]}
            lastUsed={lastUsed[a.id]}
            actions={actions}
            onOpen={() => openAccount(a.id)}
          />
        ))}

        {settings && settings.taskbarSupported && (
          <label className="setting-row">
            <input
              type="checkbox"
              checked={settings.taskbarGroups}
              onChange={(e) => actions.setTaskbarGroups(e.target.checked)}
            />
            <span>
              <strong>Account icons on the taskbar and in the tray</strong>
              <span className="setting-hint">
                Each added account's Claude window gets its own taskbar button with its colour
                and letter, and every account's Claude tray icon shows its letter too. The default
                account keeps Claude's own taskbar button.
              </span>
            </span>
          </label>
        )}

        {settings && settings.traySupported && (
          <label className="setting-row">
            <input
              type="checkbox"
              checked={settings.closeToTray}
              onChange={(e) => actions.setCloseToTray(e.target.checked)}
            />
            <span>
              <strong>Keep running in the {isMac ? 'menu bar' : 'tray'} when the window is closed</strong>
              <span className="setting-hint">
                Limit alerts and usage history keep working, and the {isMac ? 'menu-bar' : 'tray'} icon
                shows every account's usage with Launch, Show and Close.{' '}
                {isMac ? 'Quit from the menu-bar icon.' : 'Right-click the icon to quit.'}
              </span>
            </span>
          </label>
        )}

        <AlertSettings settings={settings} actions={actions} />

        <div className="note">
          Deleting an account erases its profile folder on this PC — the local login and
          cached data. Your Anthropic account is not affected and cannot be deleted from here.
        </div>
      </div>
    </>
  );
}
