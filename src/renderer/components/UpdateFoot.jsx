import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../lib/api.js';
import WhatsNewDialog from './WhatsNewDialog.jsx';

// States that change on their own; the line polls only while in one.
const MOVING = ['idle', 'checking', 'downloading', 'installing'];

// The minor version the user chose to skip. Per-viewer convenience only: if
// storage is unavailable the prompt simply shows again next launch.
const SKIP_KEY = 'multiClaude.skippedUpdate';
function skippedVersion() {
  try { return localStorage.getItem(SKIP_KEY); } catch { return null; }
}
function rememberSkip(version) {
  try { localStorage.setItem(SKIP_KEY, version); } catch { /* not remembered */ }
}

/**
 * The update line in the sidebar footer. Multi-Claude checks once when it
 * opens; this shows the result and is the only place an update is started.
 *
 * When the check finds a newer version, the update dialog opens on its own —
 * once per launch, and not at all for a minor version the user skipped. A
 * major version always opens it, locked, until the user updates or quits.
 */
export default function UpdateFoot() {
  const [st, setSt] = useState(null);
  const [showNotes, setShowNotes] = useState(false);
  const [prompted, setPrompted] = useState(false);
  const promptedFor = useRef(null);

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

  const locked = !!st && st.kind === 'major' && st.mode !== 'source'
    && ['available', 'downloading', 'installing', 'failed'].includes(st.state);

  // Open the dialog by itself the first time this launch learns of a version.
  useEffect(() => {
    if (!st || st.state !== 'available' || promptedFor.current === st.latest) return;
    promptedFor.current = st.latest;
    if (st.kind !== 'major' && skippedVersion() === st.latest) return;
    setPrompted(true);
    setShowNotes(true);
  }, [st]);

  const install = async () => {
    // A required update keeps its dialog up to show the download.
    if (!locked) setShowNotes(false);
    try { setSt(await api.updateInstall()); } catch { refresh(); }
  };

  const openNotes = () => { setPrompted(false); setShowNotes(true); };
  const closeNotes = () => { if (!locked) setShowNotes(false); };
  const skip = () => {
    if (st && st.latest) rememberSkip(st.latest);
    setShowNotes(false);
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
          <button className="text-btn" onClick={openNotes}>What&apos;s new</button>
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
      {(showNotes || locked) && createPortal(
        <WhatsNewDialog
          status={st}
          prompt={prompted || locked}
          onUpdate={install}
          onSkip={skip}
          onClose={closeNotes}
        />,
        document.body
      )}
    </div>
  );
}
