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

const fsp = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function tmp() {
  return fsSync.mkdtempSync(path.join(os.tmpdir(), 'mc-vsc-'));
}

test('seedProfile copies settings and keybindings into User/', async () => {
  const base = tmp();
  const source = path.join(base, 'Code', 'User');
  const profile = path.join(base, 'profile');
  await fsp.mkdir(source, { recursive: true });
  await fsp.writeFile(path.join(source, 'settings.json'), '{ "a": 1, }');
  await fsp.writeFile(path.join(source, 'keybindings.json'), '[]');

  const res = await V.seedProfile(profile, source);

  assert.deepStrictEqual(res, { copied: ['settings.json', 'keybindings.json'], skipped: null });
  assert.strictEqual(
    await fsp.readFile(path.join(profile, 'User', 'settings.json'), 'utf8'),
    '{ "a": 1, }'
  );
});

test('seedProfile tolerates a missing keybindings.json', async () => {
  const base = tmp();
  const source = path.join(base, 'Code', 'User');
  const profile = path.join(base, 'profile');
  await fsp.mkdir(source, { recursive: true });
  await fsp.writeFile(path.join(source, 'settings.json'), '{}');

  const res = await V.seedProfile(profile, source);

  assert.deepStrictEqual(res, { copied: ['settings.json'], skipped: null });
});

test('seedProfile copies nothing when the source settings would override the account', async () => {
  const base = tmp();
  const source = path.join(base, 'Code', 'User');
  const profile = path.join(base, 'profile');
  await fsp.mkdir(source, { recursive: true });
  await fsp.writeFile(path.join(source, 'settings.json'), '{ "claudeCode.environmentVariables": [] }');
  await fsp.writeFile(path.join(source, 'keybindings.json'), '[]');

  const res = await V.seedProfile(profile, source);

  assert.deepStrictEqual(res, { copied: [], skipped: 'override' });
  assert.strictEqual(fsSync.existsSync(path.join(profile, 'User', 'keybindings.json')), false);
});

test('seedProfile creates User/ even with no source files at all', async () => {
  const base = tmp();
  const profile = path.join(base, 'profile');
  const res = await V.seedProfile(profile, path.join(base, 'nope'));
  assert.deepStrictEqual(res, { copied: [], skipped: null });
  assert.ok(fsSync.existsSync(path.join(profile, 'User')));
});
