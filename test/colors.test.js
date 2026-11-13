'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../src/main/colors.js');

test('the palette has 8 distinct lower-case hex colours', () => {
  assert.strictEqual(C.PALETTE.length, 8);
  const hexes = C.PALETTE.map((c) => c.hex);
  assert.strictEqual(new Set(hexes).size, 8);
  for (const h of hexes) assert.match(h, /^#[0-9a-f]{6}$/);
});

test('the renderer palette matches the main one', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'lib', 'colors.js'), 'utf8');
  const block = src.slice(src.indexOf('PALETTE = ['), src.indexOf('];'));
  const found = [...block.matchAll(/name: '([^']+)', hex: '(#[0-9a-f]{6})'/g)].map((m) => ({ name: m[1], hex: m[2] }));
  assert.deepStrictEqual(found, C.PALETTE);
});

test('isPaletteColor accepts palette colours in any case and nothing else', () => {
  assert.ok(C.isPaletteColor('#d97757'));
  assert.ok(C.isPaletteColor('#D97757'));
  assert.ok(!C.isPaletteColor('#123456'));
  assert.ok(!C.isPaletteColor('red'));
  assert.ok(!C.isPaletteColor(null));
  assert.ok(!C.isPaletteColor(undefined));
});

test('pickColor takes the first colour no account uses', () => {
  assert.strictEqual(C.pickColor([]), C.PALETTE[0].hex);
  assert.strictEqual(C.pickColor([{ color: C.PALETTE[0].hex }]), C.PALETTE[1].hex);
  assert.strictEqual(C.pickColor([{ color: C.PALETTE[1].hex }]), C.PALETTE[0].hex);
  assert.strictEqual(C.pickColor([{ color: '#D97757' }, { color: 'junk' }, {}]), C.PALETTE[1].hex);
});

test('pickColor reuses the least-used colour once all are taken', () => {
  const all = C.PALETTE.map((c) => ({ color: c.hex }));
  assert.strictEqual(C.pickColor(all), C.PALETTE[0].hex);
  assert.strictEqual(C.pickColor([...all, { color: C.PALETTE[0].hex }]), C.PALETTE[1].hex);
});

test('assignMissingColors fills in only missing or invalid colours, in order', () => {
  const accounts = [{ id: 'a' }, { id: 'b', color: C.PALETTE[0].hex }, { id: 'c', color: '#123456' }];
  assert.strictEqual(C.assignMissingColors(accounts), true);
  assert.deepStrictEqual(accounts.map((a) => a.color), [C.PALETTE[1].hex, C.PALETTE[0].hex, C.PALETTE[2].hex]);
  assert.strictEqual(C.assignMissingColors(accounts), false);
});
