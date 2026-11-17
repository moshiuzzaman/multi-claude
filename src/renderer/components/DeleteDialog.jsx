import React, { useEffect, useRef, useState } from 'react';

export default function DeleteDialog({ account, onConfirm, onCancel, onForget }) {
  const [typed, setTyped] = useState('');
  const [unlock, setUnlock] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const cancelRef = useRef(null);

  // An imported account points at a folder outside the managed profiles root,
  // so it needs the extra unlock before the main process will touch it.
  const needsUnlock = account.kind === 'imported';
  const matches = typed === account.label;
  const canDelete = matches && (!needsUnlock || unlock) && !busy;
  // The folder is already gone, so there is nothing to erase: offer only to
  // drop the list entry. Typing a name cannot help here.
  const folderGone = account.exists === false;

  useEffect(() => { cancelRef.current?.focus(); }, []);

  if (folderGone) {
    return (
      <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
        <div className="modal" role="dialog" aria-modal="true">
          <h2>Remove &quot;{account.label}&quot; from the list?</h2>
          <p>Its profile folder is already gone from this PC:</p>
          <p className="path">{account.dir}</p>
          <p className="reassure">
            Nothing on disk will be touched. This only removes the entry from Multi-Claude.
            Your Anthropic account is not affected.
          </p>
          <div className="buttons">
            <button ref={cancelRef} onClick={onCancel}>Cancel</button>
            <button className="danger" onClick={onForget}>Remove from list</button>
          </div>
        </div>
      </div>
    );
  }

  const submit = async () => {
    if (!canDelete) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(typed, unlock);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal" role="dialog" aria-modal="true">
        <h2>Permanently delete &quot;{account.label}&quot;?</h2>

        <p>This erases the profile folder on this PC:</p>
        <p className="path">{account.dir}</p>
        <p className="reassure">
          Your Anthropic account is not affected. Nothing can delete that from here —
          only the local login and cached data for this profile are removed.
        </p>

        {needsUnlock && (
          <label className="check">
            <input
              type="checkbox"
              checked={unlock}
              onChange={(e) => setUnlock(e.target.checked)}
            />
            <span>
              This folder is outside the Multi-Claude profiles folder. Delete it anyway.
            </span>
          </label>
        )}

        <label htmlFor="confirm-input">
          Type <strong>{account.label}</strong> to confirm
        </label>
        <input
          id="confirm-input"
          type="text"
          value={typed}
          autoComplete="off"
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
            if (e.key === 'Escape') onCancel();
          }}
        />

        {error && <div className="error">{error}</div>}

        <div className="buttons">
          <button ref={cancelRef} onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="danger" onClick={submit} disabled={!canDelete}>
            {busy ? 'Deleting…' : 'Delete permanently'}
          </button>
        </div>
      </div>
    </div>
  );
}
