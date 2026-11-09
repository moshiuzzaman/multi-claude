'use strict';
const test = require('node:test');
const assert = require('node:assert');
const L = require('../src/main/launcher.js');
const S = require('../src/main/shortcuts.js');

test('the default account launches with no flag', () => {
  assert.deepStrictEqual(L.buildArgs({ kind: 'default', dir: 'C:\\whatever' }), []);
});

test('other accounts launch with --user-data-dir', () => {
  assert.deepStrictEqual(
    L.buildArgs({ kind: 'managed', dir: 'C:\\Users\\Bob\\ClaudeProfiles\\personal' }),
    ['--user-data-dir=C:\\Users\\Bob\\ClaudeProfiles\\personal']
  );
});

test('launch spawns detached, unreferenced, with stdio ignored', () => {
  const calls = [];
  let unrefed = false;
  const spawnImpl = (exe, args, opts) => {
    calls.push({ exe, args, opts });
    return { unref: () => { unrefed = true; } };
  };
  const launcher = L.createLauncher({ spawnImpl });
  launcher.launch('C:\\x\\claude.exe', { kind: 'managed', dir: 'C:\\p' });

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].exe, 'C:\\x\\claude.exe');
  assert.deepStrictEqual(calls[0].args, ['--user-data-dir=C:\\p']);
  assert.strictEqual(calls[0].opts.detached, true);
  assert.strictEqual(calls[0].opts.stdio, 'ignore');
  assert.ok(unrefed, 'the child must be unref()ed so Multi-Claude can exit');
});

test('shortcutName is a legal filename', () => {
  assert.strictEqual(S.shortcutName('Work'), 'Claude - Work.lnk');
  assert.strictEqual(S.shortcutName('A/B:C*?'), 'Claude - ABC.lnk');
  assert.strictEqual(S.shortcutName(''), 'Claude - account.lnk');
});

test('createShortcut targets Multi-Claude with --launch <id>', () => {
  const written = [];
  const shell = {
    writeShortcutLink: (p, op, opts) => { written.push({ p, op, opts }); return true; }
  };
  const out = S.createShortcut({
    shell, desktopDir: 'C:\\Desktop', exePath: 'C:\\MC\\Multi-Claude.exe',
    account: { id: 'abc123de', label: 'Work' }
  });
  assert.strictEqual(out, 'C:\\Desktop\\Claude - Work.lnk');
  assert.strictEqual(written[0].opts.target, 'C:\\MC\\Multi-Claude.exe');
  assert.strictEqual(written[0].opts.args, '--launch abc123de');
});

test('createShortcut surfaces a failed write', () => {
  const shell = { writeShortcutLink: () => false };
  assert.throws(
    () => S.createShortcut({
      shell, desktopDir: 'C:\\Desktop', exePath: 'C:\\MC\\Multi-Claude.exe',
      account: { id: 'abc123de', label: 'Work' }
    }),
    (e) => e.code === 'shortcut_failed'
  );
});
