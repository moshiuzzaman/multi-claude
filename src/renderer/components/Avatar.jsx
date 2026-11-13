import React from 'react';
import { colorOf, letterOf, inkOn, shade, PALETTE } from '../lib/colors.js';

/**
 * The account's round letter badge in its colour, with the running dot on its
 * corner. status: 'running' | 'stopped' | 'unknown' | null (no dot).
 */
export function Avatar({ account, status = null, size = 34, title }) {
  const hex = colorOf(account);
  const dotTitle = status === 'running' ? 'Running' : status === 'unknown' ? 'Could not check' : 'Not running';
  return (
    <span
      className="avatar"
      style={{
        width: size, height: size, fontSize: Math.round(size * 0.46),
        '--c': hex, '--c-hi': shade(hex, 0.25), '--c-lo': shade(hex, -0.3), color: inkOn(hex)
      }}
      title={title}
      aria-hidden={title ? undefined : true}
    >
      {letterOf(account.label)}
      {status && (
        <span className={status === 'running' ? 'dot running' : status === 'unknown' ? 'dot unknown' : 'dot'}
              title={dotTitle} />
      )}
    </span>
  );
}

/** A row of the palette's colours to choose from, as a radio group. */
export function ColorPicker({ value, onChange, disabled }) {
  const current = String(value || '').toLowerCase();
  return (
    <div className="color-picker" role="radiogroup" aria-label="Account colour">
      {PALETTE.map((c) => (
        <button
          key={c.hex}
          type="button"
          role="radio"
          aria-checked={c.hex === current}
          className={c.hex === current ? 'swatch selected' : 'swatch'}
          style={{ '--c': c.hex }}
          title={c.name}
          disabled={disabled}
          onClick={() => { if (c.hex !== current) onChange(c.hex); }}
        >
          <span className="sr-only">{c.name}</span>
        </button>
      ))}
    </div>
  );
}
