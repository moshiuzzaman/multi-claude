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
