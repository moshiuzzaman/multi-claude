'use strict';
const test = require('node:test');
const assert = require('node:assert');
const V = require('../src/main/vscode.js');

const fakeFs = (present) => ({ existsSync: (p) => present.includes(p) });

test('candidateEditors prefers the per-user install over the system one', () => {
  const env = { LOCALAPPDATA: 'C:\\u\\AppData\\Local', ProgramFiles: 'C:\\Program Files' };
  const user = 'C:\\u\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe';
  const system = 'C:\\Program Files\\Microsoft VS Code\\Code.exe';
  assert.deepStrictEqual(V.candidateEditors(env, fakeFs([user, system])), [user, system]);
});

test('candidateEditors drops paths that do not exist', () => {
  const env = { LOCALAPPDATA: 'C:\\u\\AppData\\Local', ProgramFiles: 'C:\\Program Files' };
  const system = 'C:\\Program Files\\Microsoft VS Code\\Code.exe';
  assert.deepStrictEqual(V.candidateEditors(env, fakeFs([system])), [system]);
});

test('candidateEditors builds no path from a missing environment variable', () => {
  assert.deepStrictEqual(V.candidateEditors({}, fakeFs([])), []);
});

test('findVsCode returns null when VS Code is not installed', () => {
  assert.strictEqual(V.findVsCode({ LOCALAPPDATA: 'C:\\u' }, fakeFs([])), null);
});

test('launch starts VS Code with no arguments, detached', () => {
  const calls = [];
  let unrefed = false;
  const spawnImpl = (exe, args, opts) => {
    calls.push({ exe, args, opts });
    return { unref: () => { unrefed = true; } };
  };

  V.launch('C:\\vs\\Code.exe', spawnImpl);

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].exe, 'C:\\vs\\Code.exe');
  assert.deepStrictEqual(calls[0].args, [], 'the setting carries the account, not argv');
  assert.strictEqual(calls[0].opts.detached, true);
  assert.strictEqual(calls[0].opts.stdio, 'ignore');
  assert.ok(!calls[0].opts.shell, 'never through a shell');
  assert.ok(unrefed, 'the child must be unref()ed so Multi-Claude can exit');
});

test('parseRunning reads the probe output', () => {
  assert.strictEqual(V.parseRunning('yes\r\n'), true);
  assert.strictEqual(V.parseRunning('no\r\n'), false);
  assert.strictEqual(V.parseRunning(''), false);
});

test('isRunning asks PowerShell once and reports the answer', async () => {
  const asked = [];
  const probe = V.createVsCodeProbe({
    runPowerShell: async (cmd) => { asked.push(cmd); return 'yes\r\n'; }
  });
  assert.strictEqual(await probe.isRunning(), true);
  assert.strictEqual(asked.length, 1);
  assert.ok(asked[0].includes('Code'), 'the probe looks for Code');
});

test('isRunning reports false when the probe fails', async () => {
  const probe = V.createVsCodeProbe({
    runPowerShell: async () => { throw new Error('powershell is unavailable'); }
  });
  assert.strictEqual(await probe.isRunning(), false);
});
