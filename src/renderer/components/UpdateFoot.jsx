import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../lib/api.js';
import WhatsNewDialog from './WhatsNewDialog.jsx';

// States that change on their own; the line polls only while in one.
const MOVING = ['idle', 'checking', 'downloading', 'installing'];

/**
 * The update line in the sidebar footer. Multi-Claude checks once when it
 * opens; this shows the result and is the only place an update is started.
 */
export default function UpdateFoot() {
  const [st, setSt] = useState(null);
  const [showNotes, setShowNotes] = useState(false);

  const refresh = useCallback(async () => {
    try { setSt(await api.updateStatus()); } catch { /* keep showing the last state */ }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const moving = !st || MOVING.includes(st.state);
  useEffect(() => {
    if (!moving) return undefined;
    const t = setInterval(refresh, 500);
    return () => clearInterval(t);
  }, [moving, refresh]);

  const install = async () => {
    setShowNotes(false);
    try { setSt(await api.updateInstall()); } catch { refresh(); }
  };

  const retry = async () => {
    if (st.state === 'failed') return install();
    setSt({ ...st, state: 'checking' });
    try { setSt(await api.updateCheck()); } catch { refresh(); }
    return undefined;
  };

  if (!st) return null;
  const v = `v${st.current}`;
  let line = null;

  switch (st.state) {
    case 'idle':
    case 'checking':
      line = <span>Checking for updates…</span>;
      break;
    case 'current':
      line = <span title={st.note || undefined}>{v} · Everything is up to date</span>;
      break;
    case 'available':
      line = (
        <>
          <span>
            v{st.latest} available{st.mode === 'source' && ' — update with git pull'}
          </span>
          <button className="text-btn" onClick={() => setShowNotes(true)}>What&apos;s new</button>
          {st.mode !== 'source' && (
            <button
              className="primary"
              onClick={install}
              title={st.mode === 'portable' ? 'Opens the download page' : 'Multi-Claude will close and reopen'}
            >
              Update
            </button>
          )}
        </>
      );
      break;
    case 'downloading':
      line = <span>Downloading v{st.latest}… {Math.round((st.progress || 0) * 100)}%</span>;
      break;
    case 'installing':
      line = <span>Installing — Multi-Claude will restart</span>;
      break;
    case 'check-failed':
      line = (
        <>
          <span title={st.reason}>{v} · Couldn&apos;t check for updates</span>
          <button className="text-btn" onClick={retry}>Retry</button>
        </>
      );
      break;
    case 'failed':
      line = (
        <>
          <span title={st.reason}>Update failed</span>
          <button className="text-btn" onClick={retry}>Retry</button>
        </>
      );
      break;
    default:
      line = null;
  }

  return (
    <div className="update-foot">
      {line}
      {/* The sidebar has a backdrop-filter, which would trap a fixed overlay
          inside it; the dialog renders into <body> instead. */}
      {showNotes && createPortal(
        <WhatsNewDialog status={st} onUpdate={install} onClose={() => setShowNotes(false)} />,
        document.body
      )}
    </div>
  );
}
