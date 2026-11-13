import React from 'react';
import AccountRow from '../components/AccountRow.jsx';

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
              <strong>Separate taskbar button for each added account</strong>
              <span className="setting-hint">
                Each added account's Claude window gets its own taskbar button with its colour
                and letter. The default account stays on Claude's own button.
              </span>
            </span>
          </label>
        )}

        <div className="note">
          Deleting an account erases its profile folder on this PC — the local login and
          cached data. Your Anthropic account is not affected and cannot be deleted from here.
        </div>
      </div>
    </>
  );
}
