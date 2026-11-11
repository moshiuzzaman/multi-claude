import React, { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { notesToBlocks } from '../lib/release-notes.js';
import { releaseDate } from '../lib/format.js';

/**
 * Every published version newer than this one, newest first, with its notes.
 *
 * Opened two ways: from the footer's "What's new" link, or on its own when a
 * check finds a newer version (`prompt`). A major update (`status.kind` is
 * 'major') locks the dialog: it has no Close, ignores Escape and the backdrop,
 * and stays up through the download — the only ways out are to update or to
 * quit. A minor update can be put off with "Later" until the next launch.
 */
export default function WhatsNewDialog({ status, prompt = false, onUpdate, onClose }) {
  const [log, setLog] = useState(null);
  const firstRef = useRef(null);

  // A copy run from source cannot install itself, so it is never locked in.
  const locked = status.kind === 'major' && status.mode !== 'source';
  const close = () => { if (!locked) onClose(); };

  useEffect(() => { firstRef.current?.focus(); }, []);
  useEffect(() => {
    let live = true;
    api.updateChangelog().then(
      (r) => { if (live) setLog(r); },
      (e) => { if (live) setLog({ ok: false, reason: e.message }); }
    );
    return () => { live = false; };
  }, []);

  const busy = status.state === 'downloading' || status.state === 'installing';
  const canUpdate = (status.state === 'available' || status.state === 'failed') && status.mode !== 'source';
  const updateLabel = status.state === 'failed'
    ? 'Try again'
    : status.mode === 'portable' ? `Download v${status.latest}` : `Update to v${status.latest}`;

  let title = "What's new";
  if (locked) title = 'Update required';
  else if (prompt) title = 'Update available';

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div
        className="modal whats-new"
        role={locked ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        onKeyDown={(e) => { if (e.key === 'Escape') close(); }}
      >
        <h2>{title}</h2>

        {locked && (
          <p className="update-banner major">
            v{status.latest} is a major update. You have v{status.current}, which can no longer
            be used — install the new version to keep using Multi-Claude.
            {status.mode === 'portable' && ' Download it, then close this copy and open the new one.'}
          </p>
        )}
        {!locked && prompt && (
          <p className="update-banner">
            Multi-Claude v{status.latest} is available. You have v{status.current}.
            {status.mode === 'source' && ' Update with git pull.'}
          </p>
        )}

        {status.state === 'downloading' && (
          <div className="update-progress" aria-live="polite">
            <span>Downloading v{status.latest}… {Math.round((status.progress || 0) * 100)}%</span>
            <div className="bar"><div style={{ width: `${Math.round((status.progress || 0) * 100)}%` }} /></div>
          </div>
        )}
        {status.state === 'installing' && (
          <p className="update-progress" aria-live="polite">Installing — Multi-Claude will restart.</p>
        )}
        {status.state === 'failed' && (
          <p className="error">The update failed{status.reason ? `: ${status.reason}` : '.'}</p>
        )}

        {!log && <p>Loading release notes…</p>}

        {log && !log.ok && (
          <>
            <p>The release notes could not be loaded{log.reason ? ` (${log.reason})` : ''}.</p>
            <p><button className="text-btn" onClick={() => { Promise.resolve(api.updateOpenPage()).catch(() => {}); }}>Open the releases page</button></p>
          </>
        )}

        {log && log.ok && log.releases.length === 0 && <p>No release notes were published for this version.</p>}

        {log && log.ok && log.releases.map((r) => {
          const blocks = notesToBlocks(r.notes);
          return (
            <section key={r.version} className="release">
              <h3>
                v{r.version}
                {releaseDate(r.date) && <span className="release-date"> · {releaseDate(r.date)}</span>}
              </h3>
              {blocks.length === 0 && <p>No notes for this version.</p>}
              {blocks.map((b, i) => {
                if (b.type === 'h') return <h4 key={i}>{b.text}</h4>;
                if (b.type === 'li') return <p key={i} className="li">• {b.text}</p>;
                return <p key={i}>{b.text}</p>;
              })}
            </section>
          );
        })}

        <div className="buttons">
          {locked ? (
            <button
              ref={canUpdate ? undefined : firstRef}
              className="ghost"
              disabled={status.state === 'installing'}
              onClick={() => { Promise.resolve(api.updateQuit()).catch(() => {}); }}
            >
              Quit Multi-Claude
            </button>
          ) : (
            <button ref={canUpdate ? undefined : firstRef} className="ghost" onClick={close}>
              {prompt ? 'Later' : 'Close'}
            </button>
          )}
          {canUpdate && (
            <button ref={firstRef} className="primary" onClick={onUpdate} disabled={busy}>
              {updateLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
