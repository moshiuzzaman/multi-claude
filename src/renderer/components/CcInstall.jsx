import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { bytes } from '../lib/format.js';

const BUSY = ['checking', 'downloading'];

/**
 * Shown where usage limits would be when the PC has no Claude Code. One click
 * downloads Anthropic's own Claude Code into Multi-Claude's folder (see
 * src/main/cc-install.js). The download lives in the main process, so this
 * only polls its status; leaving the page and coming back picks it up again.
 */
export default function CcInstall({ onDone }) {
  const [st, setSt] = useState({ state: 'idle' });
  const timer = useRef(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  const poll = useCallback(async () => {
    let next;
    try { next = await api.ccInstallStatus(); } catch { return; }
    setSt(next);
    if (BUSY.includes(next.state)) {
      timer.current = setTimeout(poll, 700);
    } else if (next.state === 'done' && doneRef.current) {
      doneRef.current();
    }
  }, []);

  useEffect(() => {
    poll();
    return () => clearTimeout(timer.current);
  }, [poll]);

  const start = async () => {
    clearTimeout(timer.current);
    try { setSt(await api.ccInstallStart()); } catch (err) {
      setSt({ state: 'failed', reason: err.message || 'The download could not start.' });
      return;
    }
    timer.current = setTimeout(poll, 300);
  };

  const pct = Math.round((st.progress || 0) * 100);

  return (
    <div className="cc-install note">
      <div>
        Usage limits come from Anthropic's Claude Code, and this PC doesn't have it. Multi-Claude
        can download it from Anthropic (about 350 MB) into its own folder. Nothing else on the
        PC is changed. You can also open the Code tab in Claude Desktop once, or install Claude
        Code from code.claude.com, then refresh.
      </div>

      {(st.state === 'idle' || st.state === 'failed') && (
        <button className="primary" onClick={start}>
          {st.state === 'failed' ? 'Try again' : 'Set up usage limits'}
        </button>
      )}

      {st.state === 'checking' && <div className="cc-install-line">Checking Anthropic for the latest Claude Code…</div>}

      {st.state === 'downloading' && (
        <div className="cc-install-line">
          Downloading Claude Code {st.version}… {pct}%{st.size ? ` of ${bytes(st.size)}` : ''}
          <div className="bar"><div style={{ width: `${pct}%` }} /></div>
        </div>
      )}

      {st.state === 'done' && (
        <div className="cc-install-line">Claude Code {st.version} is ready. Loading usage limits…</div>
      )}

      {st.state === 'failed' && <div className="cc-install-line error">{st.reason}</div>}
    </div>
  );
}
