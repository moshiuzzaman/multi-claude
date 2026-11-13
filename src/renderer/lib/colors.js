// Each account's colour. Must match src/main/colors.js (a test checks).

export const PALETTE = [
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

/** The account's colour, or the first palette colour if it has none yet. */
export function colorOf(account) {
  const c = account && typeof account.color === 'string' ? account.color.toLowerCase() : '';
  return HEXES.has(c) ? c : PALETTE[0].hex;
}

export function colorName(hex) {
  const c = PALETTE.find((p) => p.hex === String(hex).toLowerCase());
  return c ? c.name : 'Custom';
}

/** The first letter (or symbol) of the account's name, upper-cased. */
export function letterOf(label) {
  const first = Array.from(String(label || '').trim())[0];
  return first ? first.toLocaleUpperCase() : '?';
}

function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Mix a colour towards white (t > 0) or black (t < 0). */
export function shade(hex, t) {
  const target = t > 0 ? 255 : 0;
  const k = Math.abs(t);
  const [r, g, b] = rgb(hex).map((v) => Math.round(v + (target - v) * k));
  return `rgb(${r}, ${g}, ${b})`;
}

/** Dark or white text, whichever reads better on the colour. */
export function inkOn(hex) {
  const [r, g, b] = rgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // Contrast against white vs. against near-black (#1a1a1a, lum ~0.010).
  return (1.05 / (lum + 0.05)) >= ((lum + 0.05) / 0.06) ? '#ffffff' : '#1a1a1a';
}
