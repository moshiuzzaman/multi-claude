import React from 'react';

/**
 * A headline number. Not a chart — a single value with no comparison has no
 * shape to plot, so it gets a tile.
 */
export default function StatTile({ label, value, unit, foot, color }) {
  return (
    <div className="panel tile">
      <div className="label">
        {color && <span className="tile-dot" style={{ background: color }} />}
        {label}
      </div>
      <div className="value">
        {value}
        {unit && <span className="unit">{unit}</span>}
      </div>
      {foot && <div className="foot">{foot}</div>}
    </div>
  );
}
