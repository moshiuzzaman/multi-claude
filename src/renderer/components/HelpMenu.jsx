import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../lib/api.js';

/** Asks the update line (UpdateFoot) to open its What's new dialog. */
export const WHATS_NEW_EVENT = 'mc:whats-new';

/**
 * The "?" button at the right end of every page header: help and feedback.
 * Report a bug and Suggest an idea open a GitHub issue form with the version
 * (and, for bugs, the OS) filled in; Guide opens docs/GUIDE.md; What's new
 * opens the in-app release notes. The menu renders into <body>, positioned
 * under the button, so no panel can clip it.
 */
export default function HelpMenu() {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const menuRef = useRef(null);

  const toggle = () => {
    if (open) { setOpen(false); return; }
    const r = btnRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => {
      if (menuRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    const close = () => setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  const link = async (kind) => {
    setOpen(false);
    try { await api.openFeedback(kind); } catch { /* the browser did not open; nothing to undo */ }
  };
  const whatsNew = () => {
    setOpen(false);
    window.dispatchEvent(new Event(WHATS_NEW_EVENT));
  };

  return (
    <>
      <button
        ref={btnRef}
        className={`help-btn${open ? ' active' : ''}`}
        onClick={toggle}
        title="Help and feedback"
        aria-label="Help and feedback"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        ?
      </button>
      {open && pos && createPortal(
        <div ref={menuRef} className="help-menu" role="menu" style={{ top: pos.top, right: pos.right }}>
          <div className="help-menu-head">Feedback</div>
          <button role="menuitem" className="help-menu-item" onClick={() => link('bug')}>
            <span className="help-menu-title">Report a bug</span>
            <span className="help-menu-sub">Something doesn&apos;t work</span>
          </button>
          <button role="menuitem" className="help-menu-item" onClick={() => link('idea')}>
            <span className="help-menu-title">Suggest an idea</span>
            <span className="help-menu-sub">Something Multi-Claude could do</span>
          </button>
          <div className="help-menu-sep" />
          <div className="help-menu-head">Help</div>
          <button role="menuitem" className="help-menu-item" onClick={() => link('guide')}>
            <span className="help-menu-title">Guide</span>
            <span className="help-menu-sub">How each feature works</span>
          </button>
          <button role="menuitem" className="help-menu-item" onClick={whatsNew}>
            <span className="help-menu-title">What&apos;s new</span>
            <span className="help-menu-sub">Changes in each version</span>
          </button>
          <div className="help-menu-foot">Feedback and the guide open GitHub in your browser.</div>
        </div>,
        document.body
      )}
    </>
  );
}
