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

const STORE_EXE = 'C:\\Program Files\\WindowsApps\\Claude_5.11492.2.0_x64__pzs8sxrjxfjjc\\app\\claude.exe';

function recordingLauncher() {
  const calls = [];
  const spawnImpl = (exe, args, opts) => {
    calls.push({ exe, args, opts });
    return { unref: () => {} };
  };
  return { calls, launcher: L.createLauncher({ spawnImpl }) };
}

test('storeAppId reads the Store app id from the install path', () => {
  assert.strictEqual(L.storeAppId(STORE_EXE), 'Claude_pzs8sxrjxfjjc!Claude');
  assert.strictEqual(L.storeAppId('c:/program files/windowsapps/Claude_1.0.0.0_arm64__abcdefghijklm/app/claude.exe'),
    'Claude_abcdefghijklm!Claude');
});

test('storeAppId is null for anything but the Store build', () => {
  assert.strictEqual(L.storeAppId('C:\\Users\\Bob\\AppData\\Local\\AnthropicClaude\\app-1.0.0\\claude.exe'), null);
  assert.strictEqual(L.storeAppId(''), null);
  assert.strictEqual(L.storeAppId(null), null);
});

test('show reaches the Store build\'s default Claude through its app id', () => {
  const { calls, launcher } = recordingLauncher();
  launcher.show(STORE_EXE, { kind: 'default', dir: 'C:\\whatever' });
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].exe, 'explorer.exe');
  assert.deepStrictEqual(calls[0].args, ['shell:AppsFolder\\Claude_pzs8sxrjxfjjc!Claude']);
  assert.strictEqual(calls[0].opts.detached, true);
});

test('show starts any other account again with its own folder', () => {
  const { calls, launcher } = recordingLauncher();
  launcher.show(STORE_EXE, { kind: 'managed', dir: 'C:\\Users\\Bob\\ClaudeProfiles\\work' });
  assert.strictEqual(calls[0].exe, STORE_EXE);
  assert.deepStrictEqual(calls[0].args, ['--user-data-dir=C:\\Users\\Bob\\ClaudeProfiles\\work']);
});

test('show for the default account of a classic install just starts claude.exe', () => {
  const { calls, launcher } = recordingLauncher();
  const exe = 'C:\\Users\\Bob\\AppData\\Local\\AnthropicClaude\\app-1.0.0\\claude.exe';
  launcher.show(exe, { kind: 'default', dir: 'C:\\whatever' });
  assert.strictEqual(calls[0].exe, exe);
  assert.deepStrictEqual(calls[0].args, []);
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

test('createShortcut prefixes args for a development run', () => {
  const written = [];
  const shell = {
    writeShortcutLink: (p, op, opts) => { written.push(opts); return true; }
  };
  S.createShortcut({
    shell, desktopDir: 'C:\\Desktop', exePath: 'C:\\el\\electron.exe',
    account: { id: 'abc123de', label: 'Work' },
    argsPrefix: '"C:\\proj" '
  });
  assert.strictEqual(written[0].args, '"C:\\proj" --launch abc123de');
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
