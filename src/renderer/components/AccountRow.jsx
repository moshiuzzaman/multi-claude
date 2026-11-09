import React from 'react';
import { bytes, relativeTime } from '../lib/format.js';

export default function AccountRow({ account, running, scanOk, size, lastUsed, actions, compactView }) {
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

      <div className="info">
        <div className="name">
          <span>{account.label}</span>
          {isDefault && <span className="pill">Default</span>}
          {account.kind === 'imported' && <span className="pill">Imported</span>}
          {running && scanOk && <span className="pill accent">Running</span>}
        </div>
        <div className="meta" title={account.dir}>{meta.join('  ·  ')}</div>
      </div>

      <div className="actions">
        <button className="primary" onClick={() => actions.launch(account)} disabled={missing && !isDefault}>
          Launch
        </button>
        {!compactView && (
          <>
            <button className="ghost" onClick={() => actions.openFolder(account)} disabled={missing}>Folder</button>
            <button className="ghost" onClick={() => actions.shortcut(account)}>Shortcut</button>
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
