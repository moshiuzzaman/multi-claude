// Draws an account's icon for its taskbar button and desktop shortcut:
// Multi-Claude's own icon, with a round badge at the bottom right in the
// account's colour carrying its first letter. The badge looks like the account's
// avatar in the app (the same glossy colour), so the two match.
// Each size (256 down to 16 px) is drawn at its own size from the nearest copy of
// the app icon (build/icon.ico), with a larger badge in the small sizes so the
// letter stays readable on the taskbar. The main process wraps the PNGs as
// .ico / .icns.

import icon256 from '../assets/app-icon-256.png';
import icon64 from '../assets/app-icon-64.png';
import icon32 from '../assets/app-icon-32.png';
import { colorOf, letterOf, shade, inkOn } from './colors.js';

const SIZE = 256;
const SMALL_SIZES = [128, 96, 64, 48, 32, 24, 16];

const sources = new Map();
function loadImage(src) {
  if (!sources.has(src)) {
    sources.set(src, new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    }));
  }
  return sources.get(src);
}

/** The smallest copy of the app icon that is at least this big. */
function iconFor(size) {
  return size <= 32 ? icon32 : size <= 64 ? icon64 : icon256;
}

async function drawIcon(account, size) {
  const hex = colorOf(account);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // Multi-Claude's own icon, full size.
  try {
    ctx.drawImage(await loadImage(iconFor(size)), 0, 0, size, size);
  } catch { /* the badge alone still tells the account apart */ }

  // The badge: bigger in the small sizes so the letter stays readable.
  const ratio = size >= 96 ? 0.54 : size >= 48 ? 0.6 : 0.66;
  const d = size * ratio;
  const r = d / 2;
  const cx = size - r;
  const cy = size - r;
  const edge = Math.max(1, size * 0.018);

  // A darker ring of the same colour separates it from the logo.
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = shade(hex, -0.45);
  ctx.fill();

  // The badge itself: the account's colour, lighter at the top (as the avatar).
  ctx.beginPath();
  ctx.arc(cx, cy, r - edge, 0, Math.PI * 2);
  const fill = ctx.createLinearGradient(0, cy - r, 0, cy + r);
  fill.addColorStop(0, shade(hex, 0.25));
  fill.addColorStop(0.55, hex);
  fill.addColorStop(1, shade(hex, -0.3));
  ctx.fillStyle = fill;
  ctx.fill();

  if (size >= 32) {
    // Gloss on the upper part.
    ctx.save();
    ctx.clip();
    const gloss = ctx.createRadialGradient(cx, cy - r, 0, cx, cy - r, r * 1.2);
    gloss.addColorStop(0, 'rgba(255, 255, 255, 0.38)');
    gloss.addColorStop(0.6, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = gloss;
    ctx.fillRect(cx - r, cy - r, d, d);
    ctx.restore();
  }

  // The letter, in whichever of dark or white reads better on the colour.
  const fontPx = d * 0.62;
  ctx.font = `700 ${fontPx}px "Segoe UI", -apple-system, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = inkOn(hex);
  if (size >= 48) {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
    ctx.shadowBlur = size * 0.02;
    ctx.shadowOffsetY = size * 0.006;
  }
  ctx.fillText(letterOf(account.label), cx, cy + fontPx * 0.05);
  ctx.shadowColor = 'transparent';

  return canvas.toDataURL('image/png');
}

/** The large icon (256 px). */
export function drawAccountIcon(account) {
  return drawIcon(account, SIZE);
}

/** Everything an account's .ico needs: { iconPng, iconSmall }. */
export async function drawAccountIconSet(account) {
  return {
    iconPng: await drawIcon(account, SIZE),
    iconSmall: await Promise.all(SMALL_SIZES.map((s) => drawIcon(account, s)))
  };
}
