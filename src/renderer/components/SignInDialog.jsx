import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';

/**
 * Connect one account to Claude Code, entirely inside Multi-Claude.
 *
 * Anthropic's own `claude auth login` runs hidden in the main process and opens
 * the browser. Usually the sign-in finishes by itself once you click Authorize.
 * If the browser shows a code instead, paste it here: it goes straight to the
 * Claude Code process, like typing into a terminal, and is not kept.
 */
export default function SignInDialog({ account, onDone, onClose, onFreePlan }) {
  const [state, setState] = useState('starting');
  const [message, setMessage] = useState(null);
  const [hasPage, setHasPage] = useState(false);
  const [showPaste, setShowPaste] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const doneRef = useRef(false);

  const apply = (st) => {
    setState(st.state);
    setMessage(st.message || null);
    setHasPage(!!st.hasPage);
  };

  const start = useCallback(async () => {
    setError(null);
    setCode('');
    setState('starting');
    try {
      apply(await api.connectAccount(account.id));
    } catch (e) {
      setState('failed');
      setMessage(e.message);
    }
  }, [account.id]);

  useEffect(() => { start(); }, [start]);

  // Poll while the sign-in is in progress.
  useEffect(() => {
    if (state !== 'waiting' && state !== 'checking') return undefined;
    const t = setInterval(async () => {
      try { apply(await api.loginStatus(account.id)); } catch { /* keep polling */ }
    }, 1000);
    return () => clearInterval(t);
  }, [state, account.id]);

  useEffect(() => {
    if (state === 'done' && !doneRef.current) {
      doneRef.current = true;
      const t = setTimeout(() => onDone(account), 1200);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [state, account, onDone]);

  const cancel = async () => {
    if (state === 'waiting' || state === 'checking') {
      try { await api.loginCancel(account.id); } catch { /* closing anyway */ }
    }
    onClose();
  };

  const submit = async () => {
    const c = code.trim();
    if (!c) return;
    setError(null);
    try {
      apply(await api.loginSubmit(account.id, c));
      setCode(''); // not kept, here either
    } catch (e) {
      setError(e.message);
    }
  };

  const openPage = async () => {
    setError(null);
    try { await api.loginOpenPage(account.id); } catch (e) { setError(e.message); }
  };

  const busy = state === 'starting' || state === 'checking';

  return (
    <div className="overlay">
      <div className="modal signin" role="dialog" aria-modal="true"
           onKeyDown={(e) => { if (e.key === 'Escape') cancel(); }}>
        <h2>Connect {account.label} to Claude Code</h2>

        {state === 'starting' && (
          <div className="signin-status"><span className="spinner" /> Starting Anthropic's sign-in…</div>
        )}

        {state === 'waiting' && (
          <>
            <div className="signin-status">
              <span className="spinner" />
              {/* One wrapping span: as separate flex children, the bold words
                  were laid out as columns. */}
              <span>
                A sign-in page opened in your browser. Click <strong>Authorize</strong> with
                the <strong>{account.label}</strong> account. This window finishes by itself.
              </span>
            </div>
            <p className="signin-note">
              Make sure the browser is signed in to the same account as this profile. If it's
              a different one, switch accounts on that page before authorizing.
            </p>

            <div className="signin-free">
              <span>
                Browser says <strong>Claude Max, Ultra, or Pro is required</strong>? This account
                is on the free plan. Claude Code can't connect free accounts, so it can't show
                usage limits. Everything else in Multi-Claude still works.
              </span>
              {onFreePlan && (
                <button className="ghost" onClick={async () => {
                  try { await api.loginCancel(account.id); } catch { /* closing anyway */ }
                  onFreePlan(account);
                }}>
                  It's a free plan, stop asking
                </button>
              )}
            </div>

            {!showPaste ? (
              <button className="link" onClick={() => setShowPaste(true)}>
                Browser didn't open, or it showed a code?
              </button>
            ) : (
              <div className="signin-paste">
                {hasPage && (
                  <button className="ghost" onClick={openPage}>Open the sign-in page again</button>
                )}
                <label htmlFor="signin-code">Paste the code from the browser</label>
                <div className="signin-row">
                  <input
                    id="signin-code"
                    type="text"
                    value={code}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(e) => setCode(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
                    placeholder="Paste code here"
                  />
                  <button className="primary" onClick={submit} disabled={!code.trim()}>Submit</button>
                </div>
              </div>
            )}
          </>
        )}

        {state === 'checking' && (
          <div className="signin-status"><span className="spinner" /> Checking the code…</div>
        )}

        {state === 'done' && (
          <div className="signin-status ok">Signed in. Loading this account's limits…</div>
        )}

        {state === 'failed' && (
          <div className="error">{message || "Sign-in didn't complete."}</div>
        )}

        {state === 'cancelled' && (
          <div className="signin-status">Sign-in cancelled.</div>
        )}

        {error && <div className="error">{error}</div>}

        <div className="buttons">
          {(state === 'failed' || state === 'cancelled') && (
            <button className="primary" onClick={start}>Try again</button>
          )}
          <button onClick={cancel} disabled={busy && state === 'checking'}>
            {state === 'done' ? 'Close' : 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  );
}
