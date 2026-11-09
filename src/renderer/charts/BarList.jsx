import React from 'react';
import { seriesColor } from '../lib/format.js';

/**
 * Horizontal bars with the name and value direct-labelled above each track.
 *
 * Horizontal rather than vertical because the categories are text of varying
 * length (model ids, project folders) — rotated x-axis labels are an
 * anti-pattern. Every row carries its own label, so colour is never the only
 * thing distinguishing two bars.
 */
export default function BarList({ items, max, renderValue, colorAt }) {
  if (!items || items.length === 0) {
    return <div className="empty">Nothing recorded yet.</div>;
  }

  const top = max ?? Math.max(...items.map((i) => i.value), 1);

  return (
    <div className="bars">
      {items.map((item, i) => {
        const color = colorAt ? colorAt(i, item) : seriesColor(i);
        const pct = Math.max(1.5, (item.value / top) * 100);
        return (
          <div className="bar-row" key={item.key}>
            <div className="bar-head">
              <span className="bar-name">
                <span className="swatch" style={{ background: color }} />
                <span title={item.title || item.key}>{item.label || item.key}</span>
              </span>
              <span className="bar-val">
                {renderValue ? renderValue(item) : item.value}
              </span>
            </div>
            <div className="bar-track">
              <div
                className="bar-fill"
                style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${color}, ${color}cc)` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
