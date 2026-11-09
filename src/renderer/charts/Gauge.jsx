import React from 'react';
import { compact, full } from '../lib/format.js';

/**
 * A meter shaped like Claude's own Session/Weekly bars — with an honest
 * denominator.
 *
 * Multi-Claude cannot read your plan limits, so this is NOT a percentage of
 * any allowance. It compares your token volume in the window against your own
 * busiest comparable window in the last 30 days, which is a real number this
 * app can actually compute. Every label says so.
 */
export default function Gauge({ label, value, peak, color, resetNote }) {
  const pct = peak > 0 ? Math.min(100, (value / peak) * 100) : 0;
  const atPeak = peak > 0 && value >= peak;

  return (
    <div className="gauge">
      <div className="gauge-head">
        <span className="gauge-label">{label}</span>
        <span className="gauge-value" title={full(value) + ' tokens'}>
          {compact(value)} <span className="gauge-unit">tokens</span>
        </span>
      </div>

      <div className="gauge-track">
        <div
          className="gauge-fill"
          style={{ width: `${Math.max(pct, 1.5)}%`, background: color, color }}
        />
      </div>

      <div className="gauge-foot">
        {peak > 0
          ? atPeak
            ? 'Your busiest stretch of this length in 30 days'
            : `${Math.round(pct)}% of your busiest ${label.toLowerCase().replace('last ', '')} in 30 days`
          : 'No comparable window recorded yet'}
        {resetNote ? ` · ${resetNote}` : ''}
      </div>
    </div>
  );
}
