import React, { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { notesToBlocks } from '../lib/release-notes.js';
import { releaseDate } from '../lib/format.js';
import logoMark from '../assets/logo-mark.png';

/**
 * Every published version newer than this one, newest first, with its notes.
 *
 * Opened two ways: from the footer's "What's new" link, or on its own when a
 * check finds a newer version (`prompt`). A major update (`status.kind` is
 * 'major') locks the dialog: it has no Close, ignores Escape and the backdrop,
 * and stays up through the download — the only ways out are to update or to
 * quit. A minor update can be put off with "Later" until the next launch.
 *
 * Once an update is downloading or installing, the dialog turns into a
 * progress screen that can't be closed (`blocking`), until Multi-Claude restarts.
 */
export default function WhatsNewDialog({ status, prompt = false, blocking = false, onUpdate, onClose }) {
  const [log, setLog] = useState(null);
  const firstRef = useRef(null);

  // A copy run from source cannot install itself, so it is never locked in.
  const locked = status.kind === 'major' && status.mode !== 'source';
  const close = () => { if (!locked && !blocking) onClose(); };

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
  if (busy) return <UpdateProgress status={status} />;
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

/**
 * The liquid's top edge: two wave periods side by side, slid left by one
 * period on a loop, so it moves without a seam.
 */
function Wave({ className }) {
  return (
    <svg className={className} viewBox="0 0 120 12" preserveAspectRatio="none">
      <path d="M0 6 Q15 0 30 6 T60 6 T90 6 T120 6 V12 H0 Z" />
    </svg>
  );
}

/**
 * The blocking screen shown while an update downloads and installs. There is
 * nothing to click: Multi-Claude closes and reopens on its own when it's done.
 */
function UpdateProgress({ status }) {
  const installing = status.state === 'installing';
  const pct = installing ? 100 : Math.round((status.progress || 0) * 100);
  const steps = [
    { label: 'Download', state: installing ? 'done' : 'active' },
    { label: 'Install', state: installing ? 'active' : 'todo' },
    { label: 'Restart', state: 'todo' }
  ];

  return (
    <div className="overlay update-overlay">
      <div className="modal upm" role="alertdialog" aria-modal="true"
           aria-labelledby="upm-title" aria-describedby="upm-note">
        <div className="upm-hero">
          <div className="upm-logo">
            <svg className="upm-ring" viewBox="0 0 76 76" aria-hidden="true">
              <circle className="upm-ring-track" cx="38" cy="38" r="35" />
              <circle className="upm-ring-arc" cx="38" cy="38" r="35" />
            </svg>
            {/* A glass ball that fills with liquid as the update downloads. */}
            <div className="upm-orb" aria-hidden="true">
              <div className="upm-liquid" style={{ height: `${Math.max(pct, 6)}%` }}>
                <Wave className="upm-wave back" />
                <Wave className="upm-wave front" />
              </div>
              <span className="upm-gloss" />
            </div>
            <img src={logoMark} alt="" />
          </div>
          <h2 id="upm-title">Updating Multi-Claude</h2>
          <div className="upm-versions">
            <span className="upm-ver">v{status.current}</span>
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path d="M3 8h9.5M9 4.5 12.5 8 9 11.5" fill="none" stroke="currentColor"
                    strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="upm-ver new">v{status.latest}</span>
          </div>
        </div>

        <ol className="upm-steps" aria-label="Update steps">
          {steps.map((s, i) => (
            <li key={s.label} className={`upm-step ${s.state}`}
                aria-current={s.state === 'active' ? 'step' : undefined}>
              <span className="upm-step-dot" aria-hidden="true">
                {s.state === 'done' ? (
                  <svg viewBox="0 0 16 16" width="11" height="11">
                    <path d="M3.5 8.5 6.5 11.5 12.5 5" fill="none" stroke="currentColor"
                          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : i + 1}
              </span>
              <span className="upm-step-label">{s.label}</span>
            </li>
          ))}
        </ol>

        <div className="upm-panel" aria-live="polite">
          <div className="upm-status">
            <span>{installing ? 'Installing the update' : 'Downloading the update'}</span>
            <span className="upm-pct">{installing ? 'Almost done' : `${pct}%`}</span>
          </div>
          <div className={`upm-bar${installing ? ' indeterminate' : ''}`}
               role="progressbar" aria-valuemin={0} aria-valuemax={100}
               aria-valuenow={installing ? undefined : pct}>
            <div style={installing ? undefined : { width: `${pct}%` }} />
          </div>
          <div className="upm-caption">
            {installing
              ? 'Multi-Claude will close and open again by itself.'
              : 'The download is checked against the release before it is installed.'}
          </div>
        </div>

        <p id="upm-note" className="upm-note">
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
            <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
            <path d="M8 7.2v3.6M8 5.1v.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <span>Please keep Multi-Claude open. Your accounts are kept, and Claude windows you have open keep running.</span>
        </p>
      </div>
    </div>
  );
}
