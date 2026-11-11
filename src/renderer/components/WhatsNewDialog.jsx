import React, { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { notesToBlocks } from '../lib/release-notes.js';
import { releaseDate } from '../lib/format.js';

/** Every published version newer than this one, newest first, with its notes. */
export default function WhatsNewDialog({ status, onUpdate, onClose }) {
  const [log, setLog] = useState(null);
  const closeRef = useRef(null);

  useEffect(() => { closeRef.current?.focus(); }, []);
  useEffect(() => {
    let live = true;
    api.updateChangelog().then(
      (r) => { if (live) setLog(r); },
      (e) => { if (live) setLog({ ok: false, reason: e.message }); }
    );
    return () => { live = false; };
  }, []);

  const canUpdate = status.state === 'available' && status.mode !== 'source';

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="modal whats-new"
        role="dialog"
        aria-modal="true"
        onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
      >
        <h2>What&apos;s new</h2>

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
          <button ref={closeRef} className="ghost" onClick={onClose}>Close</button>
          {canUpdate && <button className="primary" onClick={onUpdate}>Update to v{status.latest}</button>}
        </div>
      </div>
    </div>
  );
}
