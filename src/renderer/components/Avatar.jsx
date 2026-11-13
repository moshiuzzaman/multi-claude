import React from 'react';
import { colorOf, letterOf, inkOn, shade, PALETTE } from '../lib/colors.js';
import appIcon from '../assets/app-icon-64.png';

/**
 * The account's icon, the same as its taskbar button and desktop shortcut:
 * Multi-Claude's logo with a round badge at the bottom right in the account's
 * colour and its first letter. The running dot sits on the top right corner.
 * status: 'running' | 'stopped' | 'unknown' | null (no dot).
 */
export function Avatar({ account, status = null, size = 34, title }) {
  const hex = colorOf(account);
  const badge = Math.round(size * 0.56);
  const dotTitle = status === 'running' ? 'Running' : status === 'unknown' ? 'Could not check' : 'Not running';
  return (
    <span className="avatar" style={{ width: size, height: size }} title={title} aria-hidden={title ? undefined : true}>
      <img className="avatar-logo" src={appIcon} alt="" draggable={false} />
      <span
        className="avatar-badge"
        style={{
          width: badge, height: badge, fontSize: Math.round(badge * 0.6),
          '--c': hex, '--c-hi': shade(hex, 0.25), '--c-lo': shade(hex, -0.3), '--c-edge': shade(hex, -0.45),
          color: inkOn(hex)
        }}
      >
        {letterOf(account.label)}
      </span>
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
