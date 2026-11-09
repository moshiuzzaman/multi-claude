'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const A = require('../src/main/activity-log.js');
const S = require('../src/main/storage.js');

// --- activity ---------------------------------------------------------------

test('diffRunning emits starts and stops', () => {
  assert.deepStrictEqual(A.diffRunning([], ['a'], 10), [{ t: 10, id: 'a', event: 'start' }]);
  assert.deepStrictEqual(A.diffRunning(['a'], [], 20), [{ t: 20, id: 'a', event: 'stop' }]);
  assert.deepStrictEqual(A.diffRunning(['a'], ['a'], 30), []);
});

test('diffRunning handles a swap in one tick', () => {
  const e = A.diffRunning(['a'], ['b'], 40);
  assert.strictEqual(e.length, 2);
  assert.ok(e.some((x) => x.id === 'b' && x.event === 'start'));
  assert.ok(e.some((x) => x.id === 'a' && x.event === 'stop'));
});

test('buildSessions pairs starts with stops', () => {
  const s = A.buildSessions([
    { t: 1000, id: 'a', event: 'start' },
    { t: 4000, id: 'a', event: 'stop' }
  ], 9999);
  assert.strictEqual(s.length, 1);
  assert.strictEqual(s[0].ms, 3000);
  assert.strictEqual(s[0].open, false);
});

test('buildSessions closes a dangling start at now and flags it open', () => {
  const s = A.buildSessions([{ t: 1000, id: 'a', event: 'start' }], 5000);
  assert.strictEqual(s[0].ms, 4000);
  assert.strictEqual(s[0].open, true);
});

test('buildSessions ignores a stop with no start', () => {
  assert.deepStrictEqual(A.buildSessions([{ t: 1, id: 'a', event: 'stop' }], 10), []);
});

test('buildSessions ignores a duplicate start', () => {
  const s = A.buildSessions([
    { t: 1000, id: 'a', event: 'start' },
    { t: 2000, id: 'a', event: 'start' },
    { t: 3000, id: 'a', event: 'stop' }
  ], 9999);
  assert.strictEqual(s.length, 1);
  assert.strictEqual(s[0].ms, 2000, 'duration runs from the first start');
});

test('parseLog skips a torn final line', () => {
  const text = JSON.stringify({ t: 1, id: 'a', event: 'start' }) + '\n{"t":2,"id":"a","eve';
  assert.strictEqual(A.parseLog(text).length, 1);
});

test('parseLog rejects records with the wrong shape', () => {
  const text = [
    JSON.stringify({ t: 'nope', id: 'a', event: 'start' }),
    JSON.stringify({ t: 1, id: 'a', event: 'explode' }),
    JSON.stringify({ t: 1, id: 'a', event: 'start' })
  ].join('\n');
  assert.strictEqual(A.parseLog(text).length, 1);
});

test('summariseActivity totals per account and builds a daily series', () => {
  const now = Date.parse('2026-11-09T12:00:00Z');
  const hour = 3600 * 1000;
  const sessions = A.buildSessions([
    { t: now - 2 * hour, id: 'a', event: 'start' },
    { t: now - 1 * hour, id: 'a', event: 'stop' },
    { t: now - 30 * 60 * 1000, id: 'b', event: 'start' },
    { t: now, id: 'b', event: 'stop' }
  ], now);

  const r = A.summariseActivity(sessions, { days: 7, now });
  assert.strictEqual(r.accounts.length, 2);
  assert.strictEqual(r.accounts[0].id, 'a', 'sorted by time used');
  assert.strictEqual(r.accounts[0].ms, hour);
  assert.strictEqual(r.accounts[0].launches, 1);
  assert.strictEqual(r.daily.length, 7);
});

test('activity log round-trips through a real file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-act-'));
  const log = A.createActivityLog({ file: path.join(dir, 'nested', 'activity.jsonl') });

  assert.deepStrictEqual(await log.read(), [], 'missing file reads as empty');
  await log.record(['a'], 1000);
  await log.record(['a'], 2000);          // no change -> no event
  await log.record([], 3000);
  const events = await log.read();
  assert.strictEqual(events.length, 2);
  assert.strictEqual(A.buildSessions(events, 9999)[0].ms, 2000);
  fs.rmSync(dir, { recursive: true, force: true });
});

// --- storage ----------------------------------------------------------------

test('categoryOf classifies the known directories', () => {
  assert.strictEqual(S.categoryOf('Cache'), 'cache');
  assert.strictEqual(S.categoryOf('GPUCache'), 'cache');
  assert.strictEqual(S.categoryOf('claude-code'), 'runtime');
  assert.strictEqual(S.categoryOf('claude-code-sessions'), 'sessions');
  assert.strictEqual(S.categoryOf('Local Storage'), 'data');
});

test('vm_bundles is its own category, not profile data', () => {
  // On the target machine this single folder is 8.8 GB of a 10 GB profile;
  // counting it as "profile data" would badly mislead.
  assert.strictEqual(S.categoryOf('vm_bundles'), 'vm');
});

test('breakdown separates vm bundles from data', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-vm-'));
  fs.mkdirSync(path.join(dir, 'vm_bundles'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'vm_bundles', 'img.bin'), Buffer.alloc(9000));
  fs.mkdirSync(path.join(dir, 'Local Storage'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Local Storage', 'd.bin'), Buffer.alloc(100));

  const b = await S.breakdown(dir);
  assert.strictEqual(b.vm, 9000);
  assert.strictEqual(b.data, 100);
  assert.strictEqual(b.total, 9100);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('purgeCaches never touches vm bundles or runtime', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-vm2-'));
  for (const d of ['vm_bundles', 'claude-code', 'Cache']) {
    fs.mkdirSync(path.join(dir, d), { recursive: true });
    fs.writeFileSync(path.join(dir, d, 'f.bin'), Buffer.alloc(500));
  }
  const account = { id: 'x', label: 'X', kind: 'managed', dir, createdAt: 'x' };
  const { freed } = await S.purgeCaches({ account, runningDirs: [] });
  assert.strictEqual(freed, 500);
  assert.ok(fs.existsSync(path.join(dir, 'vm_bundles')));
  assert.ok(fs.existsSync(path.join(dir, 'claude-code')));
  assert.ok(!fs.existsSync(path.join(dir, 'Cache')));
  fs.rmSync(dir, { recursive: true, force: true });
});

function makeProfile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-store-'));
  const write = (rel, bytes) => {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, Buffer.alloc(bytes));
  };
  write('Cache/a.bin', 1000);
  write('GPUCache/b.bin', 500);
  write('claude-code/2.1.0/runtime.bin', 4000);
  write('claude-code-sessions/s1/x.bin', 200);
  write('Local Storage/data.bin', 300);
  return dir;
}

test('breakdown splits a profile into categories', async () => {
  const dir = makeProfile();
  const b = await S.breakdown(dir);
  assert.strictEqual(b.exists, true);
  assert.strictEqual(b.cache, 1500);
  assert.strictEqual(b.runtime, 4000);
  assert.strictEqual(b.sessions, 200);
  assert.strictEqual(b.data, 300);
  assert.strictEqual(b.total, 6000);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('breakdown reports a missing directory without throwing', async () => {
  const b = await S.breakdown('C:\\definitely\\not\\here');
  assert.strictEqual(b.exists, false);
  assert.strictEqual(b.total, 0);
});

test('purgeCaches removes only cache directories', async () => {
  const dir = makeProfile();
  const account = { id: 'x', label: 'X', kind: 'managed', dir, createdAt: 'x' };

  const { freed } = await S.purgeCaches({ account, runningDirs: [] });
  assert.strictEqual(freed, 1500);
  assert.ok(!fs.existsSync(path.join(dir, 'Cache')));
  assert.ok(!fs.existsSync(path.join(dir, 'GPUCache')));
  assert.ok(fs.existsSync(path.join(dir, 'claude-code')), 'runtime must survive');
  assert.ok(fs.existsSync(path.join(dir, 'Local Storage')), 'profile data must survive');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('purgeCaches refuses while the profile is running', async () => {
  const dir = makeProfile();
  const account = { id: 'x', label: 'X', kind: 'managed', dir, createdAt: 'x' };
  await assert.rejects(
    () => S.purgeCaches({ account, runningDirs: [dir] }),
    (e) => e.code === 'running'
  );
  assert.ok(fs.existsSync(path.join(dir, 'Cache')), 'nothing may be removed');
  fs.rmSync(dir, { recursive: true, force: true });
});
