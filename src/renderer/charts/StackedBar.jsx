import React, { useState } from 'react';
import { bytes } from '../lib/format.js';

/**
 * Part-to-whole bar for one profile's disk usage.
 *
 * Four segments, each with a legend entry and a hover tooltip. Two of the
 * palette slots used here sit close together under tritanopia, so the legend
 * and tooltips are doing real work, not decoration — never rely on the fill
 * alone to tell them apart.
 */
export default function StackedBar({ segments, total }) {
  const [hover, setHover] = useState(null);
  const sum = total || segments.reduce((a, s) => a + s.value, 0);

  if (sum <= 0) return <div className="note">This profile has no data on disk yet.</div>;

  return (
    <div className="chart-wrap">
      <div className="stacked" onMouseLeave={() => setHover(null)}>
        {segments.map((s) => {
          const pct = (s.value / sum) * 100;
          if (pct <= 0) return null;
          return (
            <div
              key={s.key}
              className="stacked-seg"
              style={{ width: `${pct}%`, background: s.color }}
              onMouseEnter={(e) => {
                const host = e.currentTarget.parentElement.getBoundingClientRect();
                const own = e.currentTarget.getBoundingClientRect();
                setHover({ seg: s, pct, left: own.left - host.left + own.width / 2 });
              }}
            />
          );
        })}
      </div>

      {hover && (
        <div className="tooltip" style={{ left: hover.left, top: -4 }}>
          <div className="tt-row">
            <span className="tt-key">
              <span className="swatch" style={{ background: hover.seg.color }} />
              {hover.seg.label}
            </span>
            <span className="tt-val">{bytes(hover.seg.value)}</span>
          </div>
          <div className="tt-head" style={{ marginTop: 4, marginBottom: 0 }}>
            {hover.pct.toFixed(0)}% of this profile
          </div>
        </div>
      )}

      <div className="legend">
        {segments.map((s) => (
          <span className="legend-item" key={s.key}>
            <span className="swatch" style={{ background: s.color }} />
            {s.label} <strong style={{ color: 'var(--text)', fontWeight: 560 }}>{bytes(s.value)}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}
