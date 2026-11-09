import React from 'react';
import { formatSize } from '../lib/api.js';

export default function AccountRow({
  account, running, scanOk, size,
  onLaunch, onOpenFolder, onShortcut, onRename, onDelete, onForget
}) {
  const isDefault = account.kind === 'default';
  const missing = account.exists === false;

  // A failed scan must read as "unknown", never as "not running" — the latter
  // would imply it is safe to delete.
  const dotClass = !scanOk ? 'dot unknown' : running ? 'dot running' : 'dot';
  const dotTitle = !scanOk ? 'Could not check' : running ? 'Running' : 'Not running';

  const sizeText = formatSize(size);

  return (
    <div className={missing ? 'row missing' : 'row'}>
      <span className={dotClass} title={dotTitle} />

      <div className="info">
        <div className="name">
          <span>{account.label}</span>
          {isDefault && <span className="pill">Default</span>}
          {account.kind === 'imported' && <span className="pill">Imported</span>}
        </div>
        <div className="meta" title={account.dir}>
          {missing ? 'folder missing' : account.dir}
          {sizeText && !missing ? ` · ${sizeText}` : ''}
        </div>
      </div>

      <div className="actions">
        <button className="ghost" onClick={onLaunch} disabled={missing && !isDefault}>
          Launch
        </button>
        <button className="ghost" onClick={onOpenFolder} disabled={missing}>
          Folder
        </button>
        <button className="ghost" onClick={onShortcut}>
          Shortcut
        </button>
        <button className="ghost" onClick={onRename}>
          Rename
        </button>

        {missing && !isDefault ? (
          <button className="ghost" onClick={onForget} title="Remove from this list only">
            Forget
          </button>
        ) : (
          <button
            className="ghost"
            onClick={onDelete}
            disabled={isDefault}
            title={isDefault ? 'The default account cannot be deleted.' : 'Delete permanently'}
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
