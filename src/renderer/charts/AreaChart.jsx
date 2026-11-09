import React, { useMemo, useRef, useState } from 'react';
import { compact, shortDate, full } from '../lib/format.js';

/**
 * Single-series area chart with a crosshair and tooltip.
 *
 * One series, so no legend box — the panel title names it, per the chart rules.
 * The y-axis starts at zero because an area's filled region encodes magnitude;
 * a truncated baseline would overstate the differences.
 */
export default function AreaChart({
  data,                 // [{ date, value }]
  height = 170,
  color = 'var(--series-1)',
  valueLabel = 'tokens'
}) {
  const [hover, setHover] = useState(null);
  const wrapRef = useRef(null);

  const W = 1000;
  const H = height;
  const padL = 44;
  const padR = 8;
  const padT = 12;
  const padB = 22;

  const { pts, max, areaPath, linePath, ticks } = useMemo(() => {
    const values = data.map((d) => d.value);
    const rawMax = Math.max(...values, 1);
    // Round the top up to a clean number so the gridlines read well.
    const mag = Math.pow(10, Math.floor(Math.log10(rawMax)));
    const max = Math.ceil(rawMax / mag) * mag;

    const innerW = W - padL - padR;
    const innerH = H - padT - padB;
    const step = data.length > 1 ? innerW / (data.length - 1) : 0;

    const pts = data.map((d, i) => ({
      ...d,
      x: padL + i * step,
      y: padT + innerH - (d.value / max) * innerH
    }));

    const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const areaPath = pts.length
      ? `${linePath} L${pts[pts.length - 1].x.toFixed(1)},${padT + innerH} L${pts[0].x.toFixed(1)},${padT + innerH} Z`
      : '';

    return { pts, max, areaPath, linePath, ticks: [0, max / 2, max] };
  }, [data, H]);

  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const rel = ((e.clientX - rect.left) / rect.width) * W;
    let best = null;
    let bestD = Infinity;
    for (const p of pts) {
      const d = Math.abs(p.x - rel);
      if (d < bestD) { bestD = d; best = p; }
    }
    if (best) setHover({ p: best, left: (best.x / W) * rect.width });
  };

  const gid = useMemo(() => 'g' + Math.random().toString(36).slice(2, 8), []);

  return (
    <div className="chart-wrap" ref={wrapRef}>
      <svg
        className="chart-svg"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label={`${valueLabel} per day`}
      >
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.42" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {ticks.map((t, i) => {
          const y = padT + (H - padT - padB) * (1 - t / max);
          return (
            <g key={i}>
              <line className="grid-line" x1={padL} y1={y} x2={W - padR} y2={y} />
              <text className="axis-label" x={padL - 7} y={y + 3} textAnchor="end">{compact(t)}</text>
            </g>
          );
        })}

        {areaPath && <path d={areaPath} fill={`url(#${gid})`} />}
        {linePath && (
          <path d={linePath} fill="none" stroke={color} strokeWidth="2"
                strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        )}

        {hover && (
          <g>
            <line className="grid-line" x1={hover.p.x} y1={padT} x2={hover.p.x} y2={H - padB}
                  stroke="rgba(255,255,255,0.22)" />
            {/* 2px surface ring keeps the marker readable over the fill */}
            <circle cx={hover.p.x} cy={hover.p.y} r="5" fill={color}
                    stroke="var(--glass-solid)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          </g>
        )}

        {pts.length > 1 && [0, Math.floor(pts.length / 2), pts.length - 1].map((i) => (
          <text key={i} className="axis-label" x={pts[i].x} y={H - 6}
                textAnchor={i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'middle'}>
            {shortDate(pts[i].date)}
          </text>
        ))}
      </svg>

      {hover && (
        <div className="tooltip" style={{ left: hover.left, top: 0 }}>
          <div className="tt-head">{shortDate(hover.p.date)}</div>
          <div className="tt-row">
            <span className="tt-key">
              <span className="swatch" style={{ background: color }} />
              {valueLabel}
            </span>
            <span className="tt-val">{full(hover.p.value)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
