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

test('seedProfile copies nothing when a source file exists but cannot be read', async () => {
  const base = tmp();
  const source = path.join(base, 'Code', 'User');
  const profile = path.join(base, 'profile');
  await fsp.mkdir(source, { recursive: true });
  // A directory where settings.json should be: present, unreadable (EISDIR).
  await fsp.mkdir(path.join(source, 'settings.json'), { recursive: true });
  await fsp.writeFile(path.join(source, 'keybindings.json'), '[]');

  const res = await V.seedProfile(profile, source);

  assert.deepStrictEqual(res, { copied: [], skipped: 'unreadable' });
  assert.strictEqual(fsSync.existsSync(path.join(profile, 'User', 'keybindings.json')), false);
});

test('seedProfile creates User/ even with no source files at all', async () => {
  const base = tmp();
  const profile = path.join(base, 'profile');
  const res = await V.seedProfile(profile, path.join(base, 'nope'));
  assert.deepStrictEqual(res, { copied: [], skipped: null });
  assert.ok(fsSync.existsSync(path.join(profile, 'User')));
});

test('launch passes the profile dir and the account config dir, detached', () => {
  const calls = [];
  let unrefed = false;
  const spawnImpl = (exe, args, opts) => {
    calls.push({ exe, args, opts });
    return { unref: () => { unrefed = true; } };
  };

  V.launch('C:\\vs\\Code.exe',
    { profileDir: 'C:\\mc\\vscode\\abc123', ccDir: 'C:\\mc\\cc\\abc123' }, spawnImpl);

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].exe, 'C:\\vs\\Code.exe');
  assert.deepStrictEqual(calls[0].args, ['--user-data-dir', 'C:\\mc\\vscode\\abc123']);
  assert.strictEqual(calls[0].opts.env.CLAUDE_CONFIG_DIR, 'C:\\mc\\cc\\abc123');
  assert.strictEqual(calls[0].opts.detached, true);
  assert.strictEqual(calls[0].opts.stdio, 'ignore');
  assert.ok(unrefed, 'the child must be unref()ed so Multi-Claude can exit');
});

test('launch never goes through a shell and opens no folder', () => {
  const calls = [];
  const spawnImpl = (exe, args, opts) => { calls.push({ exe, args, opts }); return { unref() {} }; };

  V.launch('C:\\vs\\Code.exe', { profileDir: 'C:\\p', ccDir: 'C:\\c' }, spawnImpl);

  assert.notStrictEqual(calls[0].opts.shell, true);
  assert.strictEqual(calls[0].args.length, 2, 'no folder argument: VS Code restores its own session');
});
