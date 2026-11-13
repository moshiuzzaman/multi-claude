'use strict';
// Shortcut icons from a PNG, with no image library.
//
// The renderer draws each account's icon on a canvas (it can already draw
// text) and sends the PNG here. Both icon formats can carry a PNG as it is:
//   .ico  — a 6-byte header, one 16-byte directory entry, then the PNG
//           (understood by Windows Vista and later);
//   .icns — an 8-byte header, then one 'ic08' (256x256 PNG) element.
// Nothing here trusts the bytes it is given: anything that is not a PNG of the
// expected size is refused before it is written anywhere.

const ICON_SIZE = 256;
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
 * The PNG inside a "data:image/png;base64,..." URL, checked to be a
 * 256x256 PNG of a sensible size. Throws { code: 'bad_icon' } otherwise.
 */
function pngFromDataUrl(url) {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(typeof url === 'string' ? url : '');
  if (!m) throw badIcon('The icon is not a PNG image.');
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > MAX_BYTES) throw badIcon('The icon image is too large.');
  const size = readPngSize(buf);
  if (!size) throw badIcon('The icon is not a PNG image.');
  if (size.width !== ICON_SIZE || size.height !== ICON_SIZE) {
    throw badIcon(`The icon must be ${ICON_SIZE}x${ICON_SIZE}.`);
  }
  return buf;
}

function pngToIco(png) {
  const size = readPngSize(png);
  if (!size) throw badIcon('The icon is not a PNG image.');
  const header = Buffer.alloc(6 + 16);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // one image
  // A width or height of 256 is written as 0.
  header.writeUInt8(size.width >= 256 ? 0 : size.width, 6);
  header.writeUInt8(size.height >= 256 ? 0 : size.height, 7);
  header.writeUInt8(0, 8); // no palette
  header.writeUInt8(0, 9); // reserved
  header.writeUInt16LE(1, 10); // colour planes
  header.writeUInt16LE(32, 12); // bits per pixel
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(header.length, 18); // the image starts right after
  return Buffer.concat([header, png]);
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

module.exports = { ICON_SIZE, readPngSize, pngFromDataUrl, pngToIco, pngToIcns };
