import React from 'react';
import { bytes, relativeTime } from '../lib/format.js';

export default function AccountRow({ account, running, scanOk, size, lastUsed, actions, compactView, onOpen }) {
  const isDefault = account.kind === 'default';
  const missing = account.exists === false;

  // A failed scan reads as "unknown", never as "not running" — the latter would
  // imply it is safe to delete.
  const dotClass = !scanOk ? 'dot unknown' : running ? 'dot running' : 'dot';
  const dotTitle = !scanOk ? 'Could not check' : running ? 'Running' : 'Not running';

  const meta = [];
  if (missing) meta.push('folder missing');
  else meta.push(account.dir);
  if (size) meta.push(bytes(size));
  if (lastUsed) meta.push(`last used ${relativeTime(lastUsed)}`);

  return (
    <div className={missing ? 'acct missing' : 'acct'}>
      <span className={dotClass} title={dotTitle} />

      <div
        className={onOpen ? 'info clickable' : 'info'}
        onClick={onOpen}
        role={onOpen ? 'button' : undefined}
        title={onOpen ? 'Open this account' : undefined}
      >
        <div className="name">
          <span>{account.label}</span>
          {isDefault && <span className="pill">Default</span>}
          {account.kind === 'imported' && <span className="pill">Imported</span>}
          {account.signedIn === false && (
            <span className="pill warn" title="This account's Claude window isn't signed in yet. Launch shows the one-time steps.">
              Not signed in
            </span>
          )}
          {/* No "Running" pill: the dot and the Close button already say so. */}
        </div>
        <div className="meta" title={account.dir}>{meta.join('  ·  ')}</div>
      </div>

      <div className="actions">
        {/* One button, two states. When the scan could not run we fall back to
            Launch: clicking it on an already-open profile just focuses the
            existing window, whereas offering Close for something that may not
            be running would be a lie. */}
        {running && scanOk ? (
          <>
            <button className="primary" onClick={() => actions.show(account)} title="Bring this account's Claude window to the front">
              Show
            </button>
            <button className="subtle" onClick={() => actions.close(account)} title="Close this Claude window">
              Close
            </button>
          </>
        ) : (
          <button className="primary" onClick={() => actions.launch(account)} disabled={missing && !isDefault}>
            Launch
          </button>
        )}
        {!compactView && (
          <>
            <button className="ghost" onClick={() => actions.openFolder(account)} disabled={missing}>Folder</button>
            <button className="ghost" onClick={() => actions.shortcut(account)}>Shortcut</button>
            <button className="ghost" onClick={() => actions.useVsCodeAccount(account)} title="Make VS Code use this account">
              Use in VS Code
            </button>
            <button className="ghost" onClick={() => actions.openTerminal(account)} title="Open a Claude Code terminal for this account">
              Terminal
            </button>
            <button className="ghost" onClick={() => actions.startRename(account)}>Rename</button>
            {missing && !isDefault ? (
              <button className="ghost" onClick={() => actions.forget(account)} title="Remove from this list only">
                Forget
              </button>
            ) : (
              <button
                className="ghost"
                onClick={() => actions.startDelete(account)}
                disabled={isDefault}
                title={isDefault ? 'The default account cannot be deleted.' : 'Delete permanently'}
              >
                Delete
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
