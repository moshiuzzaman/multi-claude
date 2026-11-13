'use strict';
// Each account's colour, so accounts can be told apart at a glance: on its
// card, row and page, and on its desktop shortcut's icon.
//
// A fixed palette rather than a free picker keeps every colour readable on the
// dark interface and distinct from the others. The renderer has its own copy
// (src/renderer/lib/colors.js); a test keeps the two in step.

const PALETTE = [
  { name: 'Terracotta', hex: '#d97757' },
  { name: 'Blue', hex: '#4f7be8' },
  { name: 'Teal', hex: '#1fa39a' },
  { name: 'Violet', hex: '#8b5cf6' },
  { name: 'Rose', hex: '#e0457b' },
  { name: 'Green', hex: '#43a047' },
  { name: 'Amber', hex: '#e0a100' },
  { name: 'Slate', hex: '#7a869a' }
];

const HEXES = new Set(PALETTE.map((c) => c.hex));

function isPaletteColor(v) {
  return typeof v === 'string' && HEXES.has(v.toLowerCase());
}

/**
 * The first palette colour no other account uses, or, once all are taken,
 * the one used least (earliest in the palette on a tie).
 */
function pickColor(accounts) {
  const counts = new Map(PALETTE.map((c) => [c.hex, 0]));
  for (const a of accounts || []) {
    const hex = a && typeof a.color === 'string' ? a.color.toLowerCase() : null;
    if (counts.has(hex)) counts.set(hex, counts.get(hex) + 1);
  }
  let best = PALETTE[0].hex;
  for (const c of PALETTE) if (counts.get(c.hex) < counts.get(best)) best = c.hex;
  return best;
}

/**
 * Give every account without a valid colour one, in list order, each seeing
 * the colours already handed out. Returns true when anything changed.
 */
function assignMissingColors(accounts) {
  let changed = false;
  for (const a of accounts) {
    if (isPaletteColor(a.color)) continue;
    a.color = pickColor(accounts.filter((x) => x !== a && isPaletteColor(x.color)));
    changed = true;
  }
  return changed;
}

module.exports = { PALETTE, isPaletteColor, pickColor, assignMissingColors };
