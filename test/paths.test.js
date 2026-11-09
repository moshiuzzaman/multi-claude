'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const p = require('../src/main/paths.js');

test('normalizeDir strips quotes, trailing slashes, and lowercases', () => {
  assert.strictEqual(p.normalizeDir('"C:\\Users\\Bob\\X\\"'), 'c:\\users\\bob\\x');
  assert.strictEqual(p.normalizeDir('C:\\Users\\Bob\\X'), 'c:\\users\\bob\\x');
  assert.strictEqual(p.normalizeDir('  C:\\Users\\Bob\\X  '), 'c:\\users\\bob\\x');
});

test('normalizeDir rejects junk', () => {
  assert.strictEqual(p.normalizeDir(''), null);
  assert.strictEqual(p.normalizeDir('   '), null);
  assert.strictEqual(p.normalizeDir(null), null);
  assert.strictEqual(p.normalizeDir(42), null);
});

test('samePath ignores case and trailing separators', () => {
  assert.ok(p.samePath('C:\\A\\B', 'c:\\a\\b\\'));
  assert.ok(!p.samePath('C:\\A\\B', 'C:\\A\\C'));
  assert.ok(!p.samePath('', 'C:\\A'));
});

test('isInside is strict and not fooled by prefixes', () => {
  assert.ok(p.isInside('C:\\Users\\Bob\\Profiles\\x', 'C:\\Users\\Bob\\Profiles'));
  assert.ok(!p.isInside('C:\\Users\\Bobby', 'C:\\Users\\Bob'));
  assert.ok(!p.isInside('C:\\Users\\Bob', 'C:\\Users\\Bob'), 'equal is not inside');
  assert.ok(!p.isInside('C:\\Users', 'C:\\Users\\Bob'));
});

test('segmentCount counts below the drive root', () => {
  assert.strictEqual(p.segmentCount('C:\\'), 0);
  assert.strictEqual(p.segmentCount('C:\\Users'), 1);
  assert.strictEqual(p.segmentCount('C:\\Users\\Bob'), 2);
  assert.strictEqual(p.segmentCount('C:\\Users\\Bob\\Claude_Work'), 3);
  assert.strictEqual(p.segmentCount('C:\\Users\\Bob\\ClaudeProfiles\\personal'), 4);
});

test('isDriveRoot', () => {
  assert.ok(p.isDriveRoot('C:\\'));
  assert.ok(p.isDriveRoot('d:\\'));
  assert.ok(!p.isDriveRoot('C:\\Users'));
});

test('isReparsePoint detects a junction, not a plain directory', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-paths-'));
  const real = path.join(base, 'real');
  const link = path.join(base, 'link');
  fs.mkdirSync(real);
  fs.symlinkSync(real, link, 'junction');
  assert.strictEqual(await p.isReparsePoint(real), false);
  assert.strictEqual(await p.isReparsePoint(link), true);
  fs.rmSync(base, { recursive: true, force: true });
});
