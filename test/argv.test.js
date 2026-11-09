'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseLaunchArg } = require('../src/main/argv.js');

test('parses both --launch forms', () => {
  assert.strictEqual(parseLaunchArg(['electron.exe', '.', '--launch', 'abc123de']), 'abc123de');
  assert.strictEqual(parseLaunchArg(['app.exe', '--launch=abc123de']), 'abc123de');
});

test('returns null when absent or malformed', () => {
  assert.strictEqual(parseLaunchArg(['app.exe']), null);
  assert.strictEqual(parseLaunchArg(['app.exe', '--launch']), null);
  assert.strictEqual(parseLaunchArg(['app.exe', '--launch', '--other']), null);
  assert.strictEqual(parseLaunchArg(['app.exe', '--launch=']), null);
  assert.strictEqual(parseLaunchArg(null), null);
});

test('rejects ids that are not plain 8-char hex', () => {
  assert.strictEqual(parseLaunchArg(['app.exe', '--launch', '../../etc']), null);
  assert.strictEqual(parseLaunchArg(['app.exe', '--launch', 'abc 123']), null);
  assert.strictEqual(parseLaunchArg(['app.exe', '--launch', 'ABC123DE']), null);
  assert.strictEqual(parseLaunchArg(['app.exe', '--launch', 'abc123']), null);
});
