// Draws an account's desktop-shortcut icon: a glossy rounded tile in the
// account's colour with its first letter, and the Multi-Claude mark in the
// corner so it still reads as a Multi-Claude shortcut. Returns a 256x256 PNG
// data URL; the main process checks it and wraps it as .ico / .icns.

import logoMark from '../assets/logo-mark.png';
import { colorOf, letterOf, shade, inkOn } from './colors.js';

const SIZE = 256;

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export async function drawAccountIcon(account) {
  const hex = colorOf(account);
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');

  // The tile: a top-to-bottom gradient of the colour, slightly inset so the
  // rounded corners aren't clipped by the icon's edge.
  const inset = 12;
  const tile = SIZE - inset * 2;
  roundRect(ctx, inset, inset, tile, tile, 52);
  const fill = ctx.createLinearGradient(0, inset, 0, inset + tile);
  fill.addColorStop(0, shade(hex, 0.22));
  fill.addColorStop(0.55, hex);
  fill.addColorStop(1, shade(hex, -0.28));
  ctx.fillStyle = fill;
  ctx.fill();

  // Gloss on the upper half.
  ctx.save();
  ctx.clip();
  const gloss = ctx.createLinearGradient(0, inset, 0, inset + tile * 0.55);
  gloss.addColorStop(0, 'rgba(255,255,255,0.38)');
  gloss.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gloss;
  ctx.beginPath();
  ctx.ellipse(SIZE / 2, inset - tile * 0.18, tile * 0.78, tile * 0.62, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // The letter.
  ctx.fillStyle = inkOn(hex);
  ctx.font = '700 136px "Segoe UI", -apple-system, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 3;
  ctx.fillText(letterOf(account.label), SIZE / 2, SIZE / 2 + 6);
  ctx.shadowColor = 'transparent';

  // The Multi-Claude mark on a dark disc, bottom right.
  try {
    const mark = await loadImage(logoMark);
    const d = 84;
    const cx = SIZE - inset - d / 2 + 6;
    const cy = SIZE - inset - d / 2 + 6;
    ctx.beginPath();
    ctx.arc(cx, cy, d / 2, 0, Math.PI * 2);
    ctx.fillStyle = '#1d1b19';
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.stroke();
    const m = d * 0.62;
    const ratio = mark.width / mark.height || 1;
    const w = ratio >= 1 ? m : m * ratio;
    const h = ratio >= 1 ? m / ratio : m;
    ctx.drawImage(mark, cx - w / 2, cy - h / 2, w, h);
  } catch { /* the letter tile alone is fine */ }

  return canvas.toDataURL('image/png');
}
