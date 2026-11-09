import React from 'react';
import StatTile from '../components/StatTile.jsx';
import StackedBar from '../charts/StackedBar.jsx';
import { bytes } from '../lib/format.js';
import { STORAGE_CATEGORIES as CATEGORIES } from '../lib/storageCategories.js';


export default function Storage({ storage, running, scanOk, actions }) {
  if (!storage) {
    return (
      <>
        <div className="page-head">
          <div>
            <h1>Storage</h1>
            <div className="sub">Measuring profile folders…</div>
          </div>
        </div>
        <div className="panel">
          <div className="panel-title">Working</div>
          <div className="panel-note">
            Adding up every file in each profile. These folders run to several gigabytes,
            so the first pass takes a few seconds — the result is then cached.
          </div>
          <div className="skeleton" style={{ height: 120, marginTop: 14 }} />
        </div>
      </>
    );
  }

  const total = storage.reduce((a, s) => a + s.total, 0);
  const totalCache = storage.reduce((a, s) => a + s.cache, 0);
  const totalRuntime = storage.reduce((a, s) => a + s.runtime + s.vm, 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Storage</h1>
          <div className="sub">Disk used by each Claude profile.</div>
        </div>
        <span className="spacer" />
        <button className="ghost" onClick={actions.refreshStorage}>Recalculate</button>
      </div>

      <div className="stack">
        <div className="grid tiles">
          <StatTile label="Total on disk" value={bytes(total)} color="var(--series-3)"
                    foot={`${storage.length} profiles`} />
          <StatTile label="Runtime + VM bundles" value={bytes(totalRuntime)} color="var(--series-1)"
                    foot="one copy bundled per profile" />
          <StatTile label="Clearable cache" value={bytes(totalCache)} color="var(--series-3)"
                    foot="safe to delete, rebuilds itself" />
        </div>

        {storage.map((s) => {
          const isRunning = running.includes(s.id);
          return (
            <div className="panel" key={s.id}>
              <div className="panel-title" style={{ justifyContent: 'space-between' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {s.label}
                  {s.kind === 'default' && <span className="pill">Default</span>}
                  <span style={{ color: 'var(--text)', fontWeight: 600 }}>{bytes(s.total)}</span>
                </span>
                <button
                  className="ghost"
                  disabled={isRunning || s.cache === 0}
                  title={
                    isRunning
                      ? 'Close this Claude window first'
                      : s.cache === 0 ? 'No cache to clear' : 'Delete cache folders'
                  }
                  onClick={() => actions.purgeCache(s)}
                >
                  Clear {bytes(s.cache)} cache
                </button>
              </div>

              {!s.exists ? (
                <div className="note" style={{ marginTop: 10 }}>This folder no longer exists.</div>
              ) : (
                <div style={{ marginTop: 12 }}>
                  <StackedBar
                    total={s.total}
                    segments={CATEGORIES.map((c) => ({ ...c, value: s[c.key] }))}
                  />
                </div>
              )}
            </div>
          );
        })}

        <div className="note">
          Every profile carries its own copy of the Claude Code runtime and its sandbox VM
          bundles, and those are almost always the bulk of the total. Neither is safe to
          delete here — Claude re-downloads them. Only the cache folders are cleared by the
          button above; Chromium rebuilds those automatically, so the cost is a slightly
          slower next launch. Clearing is refused while a profile is open.
          {!scanOk && ' Running state could not be checked just now.'}
        </div>
      </div>
    </>
  );
}
