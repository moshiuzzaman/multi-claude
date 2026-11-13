'use strict';
const test = require('node:test');
const assert = require('node:assert');
const I = require('../src/main/icons.js');

/** A PNG-shaped buffer: signature + IHDR with the given size + some payload. */
function fakePng(w, h, extra = 64) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(4 + 4 + 13 + 4);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4, 'latin1');
  ihdr.writeUInt32BE(w, 8);
  ihdr.writeUInt32BE(h, 12);
  return Buffer.concat([sig, ihdr, Buffer.alloc(extra, 7)]);
}
const dataUrl = (buf) => `data:image/png;base64,${buf.toString('base64')}`;

test('readPngSize reads width and height, and rejects non-PNGs', () => {
  assert.deepStrictEqual(I.readPngSize(fakePng(256, 128)), { width: 256, height: 128 });
  assert.strictEqual(I.readPngSize(Buffer.from('GIF89a this is not a png at all')), null);
  assert.strictEqual(I.readPngSize('nope'), null);
});

test('pngFromDataUrl accepts a 256x256 PNG', () => {
  const png = fakePng(256, 256);
  assert.ok(I.pngFromDataUrl(dataUrl(png)).equals(png));
});

test('pngFromDataUrl refuses anything else', () => {
  const bad = (v) => assert.throws(() => I.pngFromDataUrl(v), (e) => e.code === 'bad_icon');
  bad(null);
  bad('data:image/jpeg;base64,AAAA');
  bad('data:image/png;base64,' + Buffer.from('not a png').toString('base64'));
  bad(dataUrl(fakePng(128, 128)));
  bad(dataUrl(fakePng(256, 256, 600 * 1024)));
});

test('pngToIco wraps the PNG in a one-image icon', () => {
  const png = fakePng(256, 256);
  const ico = I.pngToIco(png);
  assert.strictEqual(ico.readUInt16LE(0), 0);
  assert.strictEqual(ico.readUInt16LE(2), 1);
  assert.strictEqual(ico.readUInt16LE(4), 1);
  assert.strictEqual(ico.readUInt8(6), 0, '256 is written as 0');
  assert.strictEqual(ico.readUInt8(7), 0);
  assert.strictEqual(ico.readUInt16LE(12), 32);
  assert.strictEqual(ico.readUInt32LE(14), png.length);
  assert.strictEqual(ico.readUInt32LE(18), 22);
  assert.ok(ico.subarray(22).equals(png));
});

test('pngToIcns wraps the PNG as an ic08 element', () => {
  const png = fakePng(256, 256);
  const icns = I.pngToIcns(png);
  assert.strictEqual(icns.toString('latin1', 0, 4), 'icns');
  assert.strictEqual(icns.readUInt32BE(4), icns.length);
  assert.strictEqual(icns.toString('latin1', 8, 12), 'ic08');
  assert.strictEqual(icns.readUInt32BE(12), 8 + png.length);
  assert.ok(icns.subarray(16).equals(png));
});

test('the wrappers refuse a non-PNG', () => {
  assert.throws(() => I.pngToIco(Buffer.from('x'.repeat(40))), (e) => e.code === 'bad_icon');
  assert.throws(() => I.pngToIcns(Buffer.from('x'.repeat(40))), (e) => e.code === 'bad_icon');
});


test('pngToIco holds several sizes, each pointing at its own image', () => {
  const big = fakePng(256, 256, 40);
  const small = [fakePng(48, 48, 30), fakePng(16, 16, 20)];
  const ico = I.pngToIco([big, ...small]);
  assert.strictEqual(ico.readUInt16LE(4), 3);
  const entries = [0, 1, 2].map((i) => ({
    w: ico.readUInt8(6 + 16 * i), len: ico.readUInt32LE(6 + 16 * i + 8), off: ico.readUInt32LE(6 + 16 * i + 12)
  }));
  assert.deepStrictEqual(entries.map((e) => e.w), [0, 48, 16]);
  assert.strictEqual(entries[0].off, 6 + 16 * 3);
  [big, ...small].forEach((png, i) => {
    assert.ok(ico.subarray(entries[i].off, entries[i].off + entries[i].len).equals(png));
  });
});

test('smallPngsFromDataUrls takes only the small sizes, once each', () => {
  assert.deepStrictEqual(I.smallPngsFromDataUrls(undefined), []);
  const ok = I.smallPngsFromDataUrls([dataUrl(fakePng(48, 48)), dataUrl(fakePng(16, 16))]);
  assert.strictEqual(ok.length, 2);
  const bad = (v) => assert.throws(() => I.smallPngsFromDataUrls(v), (e) => e.code === 'bad_icon');
  bad([dataUrl(fakePng(20, 20))]);
  bad([dataUrl(fakePng(32, 32)), dataUrl(fakePng(32, 32))]);
  bad([dataUrl(fakePng(256, 256))]);
  bad('nope');
  bad(new Array(8).fill(dataUrl(fakePng(16, 16))));
});
