import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../lib/api.js';
import { bytes, relativeTime } from '../lib/format.js';
import CopyChatDialog from './CopyChatDialog.jsx';
import { filterChats } from '../lib/chatSearch.js';

const SHOWN = 6;

/** Last part of a folder path, for a short label. */
function folderName(p) {
  if (!p) return 'unknown folder';
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

/**
 * One account's Claude Code chats (Terminal and VS Code), with Continue and
 * "Copy to…" for a chat that was started in the wrong account.
 */
export default function ChatsPanel({ account, accounts, actions, running = [], scanOk = false }) {
  const [chats, setChats] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [all, setAll] = useState(false);
  const [copying, setCopying] = useState(null);
  const [closing, setClosing] = useState(null); // chat awaiting the Close confirmation
  const [closeBusy, setCloseBusy] = useState(false);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    try {
      setChats(await api.listChats(account.id));
      setLoadError(null);
    } catch (e) {
      setChats([]);
      setLoadError(e.message);
    }
  }, [account.id]);

  useEffect(() => { setChats(null); setAll(false); setQuery(''); load(); }, [load]);

  const others = accounts.filter((a) => a.id !== account.id && a.exists !== false);
  const searching = query.trim() !== '';
  const matches = chats ? filterChats(chats, query) : [];
  // While searching, every match shows; otherwise the newest few.
  const shown = searching || all ? matches : matches.slice(0, SHOWN);

  const resume = async (c) => {
    try {
      await api.resumeChat(account.id, c.id, c.source);
      actions.notify(`Continuing "${c.title || 'Untitled chat'}" in a terminal for ${account.label}.`);
    } catch (e) { actions.notify(e.message, true); }
  };

  const closeChat = async () => {
    const c = closing;
    setCloseBusy(true);
    try {
      const r = await api.closeChat(account.id, c.id, c.source);
      if (r.stillRunning) actions.notify(`"${c.title || 'Untitled chat'}" is still running. Try again in a moment.`, true);
      else actions.notify(`Closed "${c.title || 'Untitled chat'}". You can continue or copy it now.`);
    } catch (e) { actions.notify(e.message, true); }
    setCloseBusy(false);
    setClosing(null);
    load();
  };

  const done = ({ to, title, places }) => {
    setCopying(null);
    load();
    const desktop = places.some((p) => p.startsWith('Claude Desktop'));
    actions.notify(`Copied "${title}" to ${to.label}: ${places.join(' and ')}.` +
      (desktop ? ` Launch ${to.label} to see it in its Code tab.` : ''));
  };

  return (
    <div className="panel">
      <div className="panel-title" style={{ justifyContent: 'space-between' }}>
        <span>Claude Code chats{chats && chats.length ? ` · ${chats.length}` : ''}</span>
        <button className="ghost" onClick={load}>Refresh</button>
      </div>

      <div className="panel-body">
        {!chats && <div className="skeleton" style={{ height: 48 }} />}
        {loadError && <div className="note">{loadError}</div>}

        {chats && chats.length > 0 && (
          <div className="chat-search">
            <svg className="chat-search-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <input
              type="search"
              placeholder="Search chats by title or folder"
              aria-label="Search chats"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') setQuery(''); }}
            />
            {searching && (
              <>
                <span className="chat-search-count">{matches.length} of {chats.length}</span>
                <button className="chat-search-clear" onClick={() => setQuery('')} title="Clear search" aria-label="Clear search">×</button>
              </>
            )}
          </div>
        )}

        {searching && matches.length === 0 && (
          <div className="note">No chats match &quot;{query.trim()}&quot;.</div>
        )}
        {chats && chats.length === 0 && !loadError && (
          <div className="note">
            No Claude Code chats yet. Chats from this account&apos;s Terminal and VS Code show here.
          </div>
        )}

        {shown.length > 0 && (
          <div className="chat-list">
            {shown.map((c) => {
              const blocked = c.running ? 'Close this chat first.'
                : !c.folderExists ? 'Its project folder is not on this PC.'
                : null;
              return (
                <div className="chat-row" key={`${c.source}:${c.id}`}>
                  <div className="chat-info">
                    <div className="chat-title">
                      {c.running && <span className="dot running" title="Open now" />}
                      <span>{c.title || 'Untitled chat'}</span>
                      {c.source === 'home' && (
                        <span className="pill" title="In ~/.claude: plain claude and Claude Desktop's Code tab keep chats here">~/.claude</span>
                      )}
                    </div>
                    <div className="chat-meta" title={c.cwd || ''}>
                      {folderName(c.cwd)}{!c.folderExists ? ' (missing)' : ''}  ·  {relativeTime(c.lastUsed)}  ·  {bytes(c.size)}
                    </div>
                  </div>
                  <div className="chat-actions">
                    {c.running ? (
                      <button className="subtle" onClick={() => setClosing(c)} title="End this chat's Claude Code process, so it can be copied">
                        Close
                      </button>
                    ) : (
                      <button className="ghost" onClick={() => resume(c)} disabled={!!blocked} title={blocked || 'Continue this chat in a terminal'}>
                        Continue
                      </button>
                    )}
                    <button
                      className="ghost"
                      onClick={() => setCopying(c)}
                      disabled={!!blocked || others.length === 0}
                      title={blocked || (others.length === 0 ? 'Add another account first.' : 'For a chat started in the wrong account')}
                    >
                      Copy to…
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {account.kind === 'default' && chats && chats.length > 0 && (
          <div className="panel-foot">
            Also shows chats in <code>~/.claude</code>, where plain <code>claude</code> and Claude
            Desktop&apos;s Code tab keep them, whichever account was signed in there.
          </div>
        )}

        {!searching && chats && chats.length > SHOWN && (
          <button className="link" style={{ marginTop: 8 }} onClick={() => setAll(!all)}>
            {all ? 'Show fewer' : `Show all ${chats.length}`}
          </button>
        )}
      </div>

      {closing && createPortal(
        <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && !closeBusy && setClosing(null)}>
          <div className="modal" role="dialog" aria-modal="true"
               onKeyDown={(e) => { if (e.key === 'Escape' && !closeBusy) setClosing(null); }}>
            <h2>Close &quot;{closing.title || 'Untitled chat'}&quot;?</h2>
            <p>
              This ends the Claude Code process running this chat. Anything Claude is doing in it
              right now stops; the conversation so far is kept and can be continued or copied.
            </p>
            {closing.source === 'home' && (
              <p>If it is open in Claude Desktop&apos;s Code tab, that tab shows it as stopped.</p>
            )}
            <div className="buttons">
              <button autoFocus onClick={() => setClosing(null)} disabled={closeBusy}>Cancel</button>
              <button className="danger" onClick={closeChat} disabled={closeBusy}>
                {closeBusy ? 'Closing…' : 'Close chat'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Rendered at page level: the panel's backdrop blur would otherwise
          trap the fixed overlay inside it, under the panels below. */}
      {copying && createPortal(
        <CopyChatDialog
          chat={copying}
          from={account}
          accounts={others}
          running={running}
          scanOk={scanOk}
          onDone={done}
          onCancel={() => setCopying(null)}
        />,
        document.body
      )}
    </div>
  );
}
