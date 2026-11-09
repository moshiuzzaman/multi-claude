'use strict';
const test = require('node:test');
const assert = require('node:assert');
const sc = require('../src/main/scanner.js');

test('parseScanOutput normalises, dedupes and drops blanks', () => {
  const out = [
    'C:\\Users\\BS01085\\AppData\\Local\\Claude-Data\\claude_pzs8sxrjxfjjc',
    '"C:\\Users\\BS01085\\AppData\\Local\\Claude-Data\\claude_pzs8sxrjxfjjc"',
    'C:\\Users\\BS01085\\Claude_Work\\',
    '',
    '   '
  ].join('\r\n');
  assert.deepStrictEqual(sc.parseScanOutput(out), [
    'c:\\users\\bs01085\\appdata\\local\\claude-data\\claude_pzs8sxrjxfjjc',
    'c:\\users\\bs01085\\claude_work'
  ]);
});

test('parseScanOutput on empty input yields an empty list', () => {
  assert.deepStrictEqual(sc.parseScanOutput(''), []);
  assert.deepStrictEqual(sc.parseScanOutput('\r\n\r\n'), []);
});

test('scan reports ok:true and the parsed dirs', async () => {
  const scanner = sc.createScanner({ runPowerShell: async () => 'C:\\A\\B' });
  assert.deepStrictEqual(await scanner.scan(), { dirs: ['c:\\a\\b'], ok: true });
});

test('scan reports ok:false and no dirs when PowerShell fails', async () => {
  const scanner = sc.createScanner({
    runPowerShell: async () => { throw new Error('boom'); }
  });
  assert.deepStrictEqual(await scanner.scan(), { dirs: [], ok: false });
});

test('PS_COMMAND targets claude.exe and extracts user-data-dir', () => {
  assert.match(sc.PS_COMMAND, /Win32_Process/);
  assert.match(sc.PS_COMMAND, /claude\.exe/i);
  assert.match(sc.PS_COMMAND, /--user-data-dir/);
});
