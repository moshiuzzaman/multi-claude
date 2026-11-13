'use strict';
const test = require('node:test');
const assert = require('node:assert');
const T = require('../src/main/taskbar.js');

const acct = { id: 'abc123de', label: 'Work', dir: 'C:\\Users\\Bob\\ClaudeProfiles\\work' };

test('relaunchCommand opens the account through Multi-Claude', () => {
  assert.strictEqual(T.relaunchCommand('C:\\MC\\Multi-Claude.exe', '', 'abc123de'), '"C:\\MC\\Multi-Claude.exe" --launch abc123de');
  assert.strictEqual(T.relaunchCommand('C:\\e\\electron.exe', '"C:\\src" ', 'x1'), '"C:\\e\\electron.exe" "C:\\src" --launch x1');
});

test('displayName names the button after the account', () => {
  assert.strictEqual(T.displayName('Work'), 'Claude - Work');
  assert.strictEqual(T.displayName('  '), 'Claude - account');
});

test('itemFor uses the shortcut id, the icon file and the account folder', () => {
  const it = T.itemFor(acct, { exePath: 'C:\\MC\\Multi-Claude.exe', argsPrefix: '', iconFile: 'C:\\icons\\abc123de-1.ico' });
  assert.deepStrictEqual(it, {
    dir: acct.dir,
    id: 'dev.multiclaude.app.shortcut.abc123de',
    name: 'Claude - Work',
    icon: 'C:\\icons\\abc123de-1.ico,0',
    command: '"C:\\MC\\Multi-Claude.exe" --launch abc123de'
  });
});

test('buildScript carries the items base64-encoded, never inline', () => {
  const it = T.itemFor({ ...acct, label: "Bob's \"work\" $(rm)" }, { exePath: 'C:\\MC\\x.exe', iconFile: 'C:\\i.ico' });
  const s = T.buildScript('apply', [it]);
  assert.ok(!s.includes("Bob's"), 'the label must not appear in the script text');
  assert.ok(!s.includes('$(rm)'));
  const b64 = /FromBase64String\('([A-Za-z0-9+/=]+)'\)\) \| ConvertFrom-Json/.exec(s)[1];
  assert.deepStrictEqual(JSON.parse(Buffer.from(b64, 'base64').toString('utf8')), [it]);
  assert.ok(s.includes('[MultiClaude.Taskbar]::Apply('));
  assert.ok(!s.includes('[MultiClaude.Taskbar]::Clear('));
});

test('buildScript in clear mode removes only Multi-Claude ids', () => {
  const s = T.buildScript('clear', [{ dir: acct.dir }]);
  assert.ok(s.includes('[MultiClaude.Taskbar]::Clear($h, "dev.multiclaude.app.shortcut.")'));
  assert.ok(!s.includes('[MultiClaude.Taskbar]::Apply('));
});

test('the C# sets the relaunch properties before the id', () => {
  const apply = T.CSHARP.slice(T.CSHARP.indexOf('public static int Apply'));
  const order = ['Set(ps, COMMAND', 'Set(ps, ICON', 'Set(ps, NAME', 'Set(ps, ID'].map((k) => apply.indexOf(k));
  assert.ok(order.every((i) => i > 0));
  assert.deepStrictEqual([...order].sort((a, b) => a - b), order);
});

test('parseResult reads one result or many', () => {
  assert.deepStrictEqual(T.parseResult(''), []);
  assert.deepStrictEqual(T.parseResult('{"dir":"C:\\\\p","pid":5,"windows":1,"changed":1}'),
    [{ dir: 'C:\\p', pid: 5, windows: 1, changed: 1 }]);
  assert.strictEqual(T.parseResult('[{"dir":"a","pid":0,"windows":0,"changed":0},{"dir":"b","pid":2,"windows":2,"changed":0}]').length, 2);
});

test('createTaskbar runs one PowerShell per call and reports failures as ok:false', async () => {
  const scripts = [];
  const tb = T.createTaskbar({ runPowerShell: async (s) => { scripts.push(s); return '[{"dir":"C:\\\\p","pid":7,"windows":1,"changed":1}]'; } });
  assert.deepStrictEqual(await tb.apply([]), { ok: true, results: [] });
  assert.strictEqual(scripts.length, 0, 'nothing to do runs nothing');
  const r = await tb.apply([{ dir: 'C:\\p', id: 'x', name: 'n', icon: 'i,0', command: 'c' }]);
  assert.deepStrictEqual(r.results, [{ dir: 'C:\\p', pid: 7, windows: 1, changed: 1 }]);
  const bad = T.createTaskbar({ runPowerShell: async () => { throw new Error('boom'); } });
  const f = await bad.clear(['C:\\p']);
  assert.strictEqual(f.ok, false);
  assert.deepStrictEqual(f.results, []);
});
