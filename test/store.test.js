'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const store = require('../src/main/store.js');

function tmpFile() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-store-'));
  return path.join(d, 'accounts.json');
}

const GOOD = {
  version: 1,
  exePath: 'C:\\x\\claude.exe',
  accounts: [{
    id: 'a1', label: 'Work', kind: 'imported',
    dir: 'C:\\Users\\Bob\\Claude_Work', createdAt: '2026-11-09T00:00:00.000Z'
  }]
};

test('validate accepts a good store', () => {
  assert.deepStrictEqual(store.validate(GOOD), GOOD);
});

test('validate rejects bad shapes with code INVALID_SCHEMA', () => {
  const bad = [
    null, 42, 'x', {},
    { version: 2, exePath: null, accounts: [] },
    { version: 1, exePath: null, accounts: 'nope' },
    { version: 1, exePath: null, accounts: [{ id: 'a', label: 'L', kind: 'weird', dir: 'C:\\x', createdAt: 'x' }] },
    { version: 1, exePath: null, accounts: [{ id: 'a', label: 'L', kind: 'managed', createdAt: 'x' }] }
  ];
  for (const b of bad) {
    assert.throws(() => store.validate(b), (e) => e.code === 'INVALID_SCHEMA', JSON.stringify(b));
  }
});

test('validate rejects duplicate ids', () => {
  const dup = {
    version: 1, exePath: null, accounts: [
      { id: 'a', label: 'A', kind: 'managed', dir: 'C:\\x\\a', createdAt: 'x' },
      { id: 'a', label: 'B', kind: 'managed', dir: 'C:\\x\\b', createdAt: 'x' }
    ]
  };
  assert.throws(() => store.validate(dup), (e) => e.code === 'INVALID_SCHEMA');
});

test('save then load round-trips', async () => {
  const f = tmpFile();
  await store.save(f, GOOD);
  const { data, recoveredFrom } = await store.load(f);
  assert.deepStrictEqual(data, GOOD);
  assert.strictEqual(recoveredFrom, null);
});

test('load returns an empty store when the file is absent', async () => {
  const { data, recoveredFrom } = await store.load(tmpFile());
  assert.deepStrictEqual(data, store.emptyStore());
  assert.strictEqual(recoveredFrom, null);
});

test('load quarantines a corrupt file instead of destroying it', async () => {
  const f = tmpFile();
  fs.writeFileSync(f, '{ this is not json');
  const { data, recoveredFrom } = await store.load(f);
  assert.deepStrictEqual(data, store.emptyStore());
  assert.ok(recoveredFrom, 'should report the quarantine filename');
  assert.ok(fs.existsSync(recoveredFrom), 'quarantined file must still exist on disk');
  assert.strictEqual(fs.readFileSync(recoveredFrom, 'utf8'), '{ this is not json');
});

test('load quarantines a schema-invalid file too', async () => {
  const f = tmpFile();
  fs.writeFileSync(f, JSON.stringify({ version: 99 }));
  const { data, recoveredFrom } = await store.load(f);
  assert.deepStrictEqual(data, store.emptyStore());
  assert.ok(recoveredFrom);
});

test('save leaves no .tmp file behind', async () => {
  const f = tmpFile();
  await store.save(f, GOOD);
  assert.ok(!fs.existsSync(f + '.tmp'));
});
