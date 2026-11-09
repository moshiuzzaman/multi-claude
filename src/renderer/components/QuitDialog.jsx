import React, { useEffect, useRef, useState } from 'react';

/**
 * Confirmation before quitting a running profile.
 *
 * Claude Desktop lives in the system tray, so closing its window only hides it —
 * the only way to actually stop it is to end the process, which also stops
 * anything running inside it. That is worth one deliberate click.
 */
export default function QuitDialog({ account, onConfirm, onCancel }) {
  const [busy, setBusy] = useState(false);
  const quitRef = useRef(null);

  useEffect(() => { quitRef.current?.focus(); }, []);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirm();
    } catch {
      setBusy(false); // the caller surfaces the error
    }
  };

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        onKeyDown={(e) => { if (e.key === 'Escape' && !busy) onCancel(); }}
      >
        <h2>Quit &quot;{account.label}&quot;?</h2>
        <p>
          Claude stays running in the system tray when its window is closed, so this ends
          the whole process to fully stop it.
        </p>
        <p>
          Anything running in that profile stops with it, including an active chat or a
          Claude Code session. You stay signed in, and nothing is deleted.
        </p>
        <div className="buttons">
          <button onClick={onCancel} disabled={busy}>Cancel</button>
          <button ref={quitRef} className="danger" onClick={submit} disabled={busy}>
            {busy ? 'Quitting…' : 'Quit Claude'}
          </button>
        </div>
      </div>
    </div>
  );
}
