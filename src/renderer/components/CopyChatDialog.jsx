import React, { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { colorOf } from '../lib/colors.js';
import { bytes } from '../lib/format.js';

/**
 * Copy one Claude Code chat to another account (roadmap feature 20).
 *
 * For a chat started in the wrong account. The account list deliberately
 * shows no usage figures and is not sorted by usage: this is about putting
 * work in the right account, never about working past a limit.
 *
 * Copy only: nothing opens afterwards, and the original always stays.
 * 1. Pick the account (never pre-selected).
 * 2. Tick where it should show:
 *    - Claude Desktop's Code tab (ticked by default): needs that account's
 *      Claude window closed while copying, so the dialog offers to close it.
 *    - Terminal & VS Code: the account's own Claude Code folder.
 */
export default function CopyChatDialog({ chat, from, accounts, running = [], scanOk = false, onDone, onCancel }) {
  const [toId, setToId] = useState(null);
  const [toDesktop, setToDesktop] = useState(true);
  const [toCode, setToCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [closingWindow, setClosingWindow] = useState(false);
  const [closedHere, setClosedHere] = useState([]); // windows closed from this dialog
  const [error, setError] = useState(null);
  const cancelRef = useRef(null);

  useEffect(() => { cancelRef.current?.focus(); }, []);

  const to = accounts.find((a) => a.id === toId) || null;
  const title = chat.title || 'Untitled chat';
  const isOpen = (a) => scanOk && running.includes(a.id) && !closedHere.includes(a.id);
  const windowBlocks = !!(to && toDesktop && isOpen(to));
  const nothingTicked = !toDesktop && !toCode;
  const canCopy = !!to && !nothingTicked && !windowBlocks && !busy && !closingWindow;

  const run = async () => {
    if (!canCopy) return;
    setBusy(true);
    setError(null);
    const done = [];
    try {
      if (toDesktop) {
        await api.copyChatToDesktop(from.id, to.id, chat.id, chat.source);
        done.push('Claude Desktop\'s Code tab');
      }
      if (toCode) {
        try {
          await api.copyChat(from.id, to.id, chat.id, 'copy', chat.source, false);
          done.push('Terminal & VS Code');
        } catch (e) {
          // Already copied there before: that part is done, carry on.
          if (e.code !== 'exists') throw e;
          done.push('Terminal & VS Code (already there)');
        }
      }
      onDone({ to, title, places: done });
    } catch (e) {
      const partly = done.length ? ` Already copied to: ${done.join(', ')}.` : '';
      setError(`${e.message}${partly}`);
      setBusy(false);
    }
  };

  const closeWindow = async () => {
    if (!to || closingWindow) return;
    setClosingWindow(true);
    setError(null);
    try {
      const r = await api.closeAccount(to.id);
      if (r.stillRunning) setError(`${to.label}'s Claude window is still closing. Try again in a moment.`);
      else setClosedHere((c) => [...c, to.id]);
    } catch (e) {
      setError(e.message);
    }
    setClosingWindow(false);
  };

  const tick = (set) => (e) => { set(e.target.checked); setError(null); };

  let buttonLabel = 'Copy';
  if (busy) buttonLabel = 'Copying…';
  else if (!to) buttonLabel = 'Choose an account';
  else if (nothingTicked) buttonLabel = 'Tick where it should show';
  else buttonLabel = `Copy to ${to.label}`;

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <div className="modal copy-chat" role="dialog" aria-modal="true"
           onKeyDown={(e) => { if (e.key === 'Escape' && !busy) onCancel(); }}>
        <h2>Copy &quot;{title}&quot;</h2>
        <p>For a chat that was started in the wrong account. Only copy chats between accounts you own.</p>

        <div className="copy-step">
          <div className="copy-step-head"><span className="copy-step-num">1</span>Which account should get it?</div>
          <div className="copy-chat-accounts" role="radiogroup" aria-label="Account to copy to">
            {accounts.map((a) => {
              const selected = toId === a.id;
              return (
                <button
                  key={a.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={selected ? 'copy-chat-account selected' : 'copy-chat-account'}
                  onClick={() => { setToId(a.id); setError(null); }}
                  disabled={busy}
                >
                  <span className="copy-radio" aria-hidden="true" />
                  <span className="copy-dot" style={{ background: colorOf(a) }} aria-hidden="true" />
                  <span className="copy-chat-account-name">{a.label}</span>
                  <span className={`copy-state ${!scanOk ? 'unknown' : isOpen(a) ? 'open' : 'closed'}`}>
                    {!scanOk ? 'Window unknown' : isOpen(a) ? 'Window open' : 'Window closed'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="copy-step">
          <div className="copy-step-head"><span className="copy-step-num">2</span>Where should it show?</div>
          <div className="copy-chat-modes">
            <label className="copy-chat-mode">
              <input type="checkbox" checked={toDesktop} onChange={tick(setToDesktop)} disabled={busy} />
              <span>
                <strong>Claude Desktop&apos;s Code tab</strong>
                <span className="copy-chat-hint">In the Code tab sidebar next time its Claude window opens</span>
              </span>
            </label>
            <label className="copy-chat-mode">
              <input type="checkbox" checked={toCode} onChange={tick(setToCode)} disabled={busy} />
              <span>
                <strong>Terminal &amp; VS Code</strong>
                <span className="copy-chat-hint">For <code>claude --resume</code> in its terminal, and VS Code</span>
              </span>
            </label>
          </div>
        </div>

        {windowBlocks && (
          <div className="copy-window-warn">
            <span>
              <strong>{to.label}&apos;s Claude window is open.</strong> It has to be closed while the chat is
              added to its Code tab. Anything running in it stops.
            </span>
            <button onClick={closeWindow} disabled={closingWindow || busy}>
              {closingWindow ? 'Closing…' : `Close ${to.label}'s window`}
            </button>
          </div>
        )}

        <div className="note copy-chat-note">
          The chat stays in {from.label} too. The first message in {to ? to.label : 'the other account'} reads
          the whole chat again ({bytes(chat.size)}); earlier reasoning steps don&apos;t carry over, the
          conversation does.
        </div>

        {error && <div className="error">{error}</div>}

        <div className="buttons">
          <button ref={cancelRef} onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="primary" onClick={run} disabled={!canCopy}>{buttonLabel}</button>
        </div>
      </div>
    </div>
  );
}
