'use strict';
// Shortcut and taskbar icons from PNGs, with no image library.
//
// The renderer draws each account's icon on a canvas (it can already draw
// text) and sends the PNGs here. Both icon formats can carry a PNG as it is:
//   .ico  — a 6-byte header, one 16-byte directory entry per image, then the
//           PNGs (understood by Windows Vista and later). Small sizes are drawn
//           separately so the taskbar and desktop don't shrink the big one;
//   .icns — an 8-byte header, then one 'ic08' (256x256 PNG) element.
// Nothing here trusts the bytes it is given: anything that is not a PNG of the
// expected size is refused before it is written anywhere.

const ICON_SIZE = 256;
/** The small images an .ico may carry besides the 256 px one. */
const SMALL_SIZES = [128, 96, 64, 48, 32, 24, 16];
const MAX_BYTES = 512 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function badIcon(msg) {
  const e = new Error(msg);
  e.code = 'bad_icon';
  return e;
}

/** { width, height } from a PNG's IHDR chunk, or null if it is not a PNG. */
function readPngSize(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 24) return null;
  if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  if (buf.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/**
 * The PNG inside a "data:image/png;base64,..." URL, checked to be a square
 * PNG of the given size (256 by default) and a sensible length. Throws
 * { code: 'bad_icon' } otherwise.
 */
function pngFromDataUrl(url, expected = ICON_SIZE) {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(typeof url === 'string' ? url : '');
  if (!m) throw badIcon('The icon is not a PNG image.');
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > MAX_BYTES) throw badIcon('The icon image is too large.');
  const size = readPngSize(buf);
  if (!size) throw badIcon('The icon is not a PNG image.');
  if (size.width !== expected || size.height !== expected) {
    throw badIcon(`The icon must be ${expected}x${expected}.`);
  }
  return buf;
}

/**
 * The small images that go with the 256 px one: an array of PNG data URLs,
 * each one of SMALL_SIZES, at most one per size. Anything else is refused.
 */
function smallPngsFromDataUrls(urls) {
  if (urls == null) return [];
  if (!Array.isArray(urls) || urls.length > SMALL_SIZES.length) throw badIcon('Too many small icon images.');
  const seen = new Set();
  return urls.map((u) => {
    const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(typeof u === 'string' ? u : '');
    const size = m ? readPngSize(Buffer.from(m[1], 'base64')) : null;
    if (!size || !SMALL_SIZES.includes(size.width) || seen.has(size.width)) {
      throw badIcon('A small icon image has the wrong size.');
    }
    seen.add(size.width);
    return pngFromDataUrl(u, size.width);
  });
}

/** One .ico holding every PNG given (largest first is conventional). */
function pngToIco(pngs) {
  const list = Array.isArray(pngs) ? pngs : [pngs];
  const sizes = list.map((p) => readPngSize(p));
  if (list.length === 0 || sizes.some((s) => !s)) throw badIcon('The icon is not a PNG image.');
  const header = Buffer.alloc(6 + 16 * list.length);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(list.length, 4);
  let offset = header.length;
  list.forEach((png, i) => {
    const e = 6 + 16 * i;
    // A width or height of 256 is written as 0.
    header.writeUInt8(sizes[i].width >= 256 ? 0 : sizes[i].width, e);
    header.writeUInt8(sizes[i].height >= 256 ? 0 : sizes[i].height, e + 1);
    header.writeUInt8(0, e + 2); // no palette
    header.writeUInt8(0, e + 3); // reserved
    header.writeUInt16LE(1, e + 4); // colour planes
    header.writeUInt16LE(32, e + 6); // bits per pixel
    header.writeUInt32LE(png.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...list]);
}

function pngToIcns(png) {
  if (!readPngSize(png)) throw badIcon('The icon is not a PNG image.');
  const entry = Buffer.alloc(8);
  entry.write('ic08', 0, 'latin1');
  entry.writeUInt32BE(8 + png.length, 4);
  const header = Buffer.alloc(8);
  header.write('icns', 0, 'latin1');
  header.writeUInt32BE(8 + entry.length + png.length, 4);
  return Buffer.concat([header, entry, png]);
}

module.exports = {
  ICON_SIZE, SMALL_SIZES, readPngSize, pngFromDataUrl, smallPngsFromDataUrls, pngToIco, pngToIcns
};
