import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../lib/api.js';
import WhatsNewDialog from './WhatsNewDialog.jsx';

// States that change on their own; the line polls only while in one.
const MOVING = ['idle', 'checking', 'downloading', 'installing'];

/**
 * The update line in the sidebar footer. Multi-Claude checks once when it
 * opens; this shows the result and is the only place an update is started.
 *
 * When the check finds a newer version, the update dialog opens on its own —
 * once per launch. A major version opens it locked, until the user updates
 * or quits.
 */
export default function UpdateFoot() {
  const [st, setSt] = useState(null);
  const [showNotes, setShowNotes] = useState(false);
  const [prompted, setPrompted] = useState(false);
  const [rechecking, setRechecking] = useState(false);
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
  // While an update downloads and installs, its dialog is up and can't be
  // dismissed: the app is about to restart, so nothing else should start.
  const updating = !!st && ['downloading', 'installing'].includes(st.state);

  // Open the dialog by itself the first time this launch learns of a version.
  useEffect(() => {
    if (!st || st.state !== 'available' || promptedFor.current === st.latest) return;
    promptedFor.current = st.latest;
    setPrompted(true);
    setShowNotes(true);
  }, [st]);

  const install = async () => {
    // The portable copy only opens the download page, so its dialog closes.
    // Every other update keeps the dialog up to show the download and install.
    if (st.mode === 'portable' && !locked) setShowNotes(false);
    else setShowNotes(true);
    try { setSt(await api.updateInstall()); } catch { refresh(); }
  };

  const openNotes = () => { setPrompted(false); setShowNotes(true); };
  const closeNotes = () => { if (!locked && !updating) setShowNotes(false); };

  // Ask GitHub again. The answer usually comes back in well under a second,
  // so "Checking…" is held briefly to show that a check really happened.
  const checkNow = async () => {
    setRechecking(true);
    const held = new Promise((r) => setTimeout(r, 700));
    let next = null;
    try { next = await api.updateCheck(); } catch { /* fall back to the status below */ }
    await held;
    if (next) setSt(next); else await refresh();
    setRechecking(false);
  };

  const retry = () => (st.state === 'failed' ? install() : checkNow());

  if (!st) return null;
  const v = `Version ${st.current}`;
  const state = rechecking ? 'checking' : st.state;

  // Each state: a dot colour, a title, a smaller second line, and at most one action.
  let tone = 'idle';
  let title = null;
  let sub = v;
  let tip;
  let action = null;

  switch (state) {
    case 'idle':
    case 'checking':
      title = 'Checking…';
      action = <RefreshButton spinning label="Checking for updates" />;
      break;
    case 'current':
      tone = 'ok';
      title = 'Up to date';
      tip = st.note || undefined;
      action = <RefreshButton onClick={checkNow} label="Check for updates" />;
      break;
    case 'available':
      tone = 'new';
      title = 'Update available';
      tip = st.mode === 'source' ? 'Update with git pull' : undefined;
      sub = (
        <>
          {`v${st.latest} · `}
          <button className="uf-link" onClick={openNotes}>What&apos;s new</button>
        </>
      );
      if (st.mode !== 'source') {
        action = (
          <button
            className="primary uf-update"
            onClick={install}
            title={st.mode === 'portable' ? 'Opens the download page' : 'Multi-Claude will close and reopen'}
          >
            Update
          </button>
        );
      }
      break;
    case 'downloading': {
      const pct = Math.round((st.progress || 0) * 100);
      tone = 'new';
      title = `Downloading ${pct}%`;
      sub = <span className="uf-bar"><span style={{ width: `${pct}%` }} /></span>;
      break;
    }
    case 'installing':
      tone = 'new';
      title = 'Installing…';
      sub = 'Restarting soon';
      break;
    case 'check-failed':
      tone = 'bad';
      title = "Couldn't check";
      tip = st.reason;
      action = <RefreshButton onClick={retry} label="Try again" />;
      break;
    case 'failed':
      tone = 'bad';
      title = 'Update failed';
      tip = st.reason;
      action = <RefreshButton onClick={retry} label="Try the update again" />;
      break;
    default:
      return null;
  }

  return (
    <div className={`update-foot tone-${tone}`} aria-live="polite">
      <span className="uf-dot" aria-hidden="true" />
      <div className="uf-text" title={tip}>
        <div className="uf-title">{title}</div>
        <div className="uf-sub">{sub}</div>
      </div>
      {action}
      {/* The sidebar has a backdrop-filter, which would trap a fixed overlay
          inside it; the dialog renders into <body> instead. */}
      {(showNotes || locked || updating) && createPortal(
        <WhatsNewDialog
          status={st}
          prompt={prompted || locked}
          blocking={locked || updating}
          onUpdate={install}
          onClose={closeNotes}
        />,
        document.body
      )}
    </div>
  );
}

/** A small square icon button with a circular-arrow icon; spins while busy. */
function RefreshButton({ onClick, label, spinning = false }) {
  return (
    <button
      className={`uf-icon${spinning ? ' spinning' : ''}`}
      onClick={onClick}
      disabled={spinning}
      title={label}
      aria-label={label}
    >
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <path
          d="M13.5 8a5.5 5.5 0 1 1-1.61-3.89"
          fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
        />
        <path d="M13.5 2.5v3.2h-3.2" fill="none" stroke="currentColor" strokeWidth="1.6"
              strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
