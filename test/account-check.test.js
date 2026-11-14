'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const C = require('../src/main/account-check.js');
const { readDesktopAccountKey } = require('../src/main/desktop-signin.js');

const UUID = '0b6b1f6e-3f1a-4c55-9a0e-1234567890ab';

test('readDesktopAccountKey: a fingerprint of the id, never the id; null when absent or odd', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-key-'));
  const write = (o) => fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(o));
  write({ lastKnownAccountUuid: UUID, 'oauth:tokenCache': 'never-read' });
  const k = readDesktopAccountKey(dir);
  assert.match(k, /^[0-9a-f]{24}$/);
  assert.ok(!k.includes(UUID.slice(0, 8)), 'the id itself does not show through');
  write({ lastKnownAccountUuid: UUID.toUpperCase() });
  assert.strictEqual(readDesktopAccountKey(dir), k, 'case does not matter');
  write({ lastKnownAccountUuid: 'not-a-uuid' });
  assert.strictEqual(readDesktopAccountKey(dir), null);
  write({});
  assert.strictEqual(readDesktopAccountKey(dir), null);
  fs.writeFileSync(path.join(dir, 'config.json'), '{broken');
  assert.strictEqual(readDesktopAccountKey(dir), null);
  assert.strictEqual(readDesktopAccountKey(path.join(dir, 'missing')), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('bindNewAccounts remembers the first account, but not one another profile uses', () => {
  const accounts = [{ id: 'a' }, { id: 'b', accountKey: 'kb' }, { id: 'c' }, { id: 'd' }];
  const current = new Map([['a', 'ka'], ['b', 'kb'], ['c', 'kb'], ['d', 'kd']]);
  assert.strictEqual(C.bindNewAccounts(accounts, current), true);
  assert.deepStrictEqual(accounts.map((a) => a.accountKey), ['ka', 'kb', undefined, 'kd']);
  assert.strictEqual(C.bindNewAccounts(accounts, current), false, 'nothing new the second time');
});

test('accountStates: none, ok, mismatch, and who shares an account', () => {
  const accounts = [{ id: 'a', accountKey: 'ka' }, { id: 'b', accountKey: 'kb' }, { id: 'c' }];
  const current = new Map([['a', 'ka'], ['b', 'ka']]);
  const s = C.accountStates(accounts, current);
  assert.deepStrictEqual(s.get('a'), { kind: 'ok', sharedWith: ['b'] });
  assert.deepStrictEqual(s.get('b'), { kind: 'mismatch', sharedWith: ['a'] });
  assert.deepStrictEqual(s.get('c'), { kind: 'none', sharedWith: [] });
});
