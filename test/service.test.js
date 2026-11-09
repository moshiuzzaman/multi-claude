'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createService } = require('../src/main/service.js');

function harness() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-svc-'));
  const userProfile = path.join(base, 'user');
  const profilesRoot = path.join(userProfile, 'ClaudeProfiles');
  const defaultProfileDir = path.join(base, 'default-profile');
  fs.mkdirSync(userProfile, { recursive: true });
  fs.mkdirSync(defaultProfileDir, { recursive: true });

  const launched = [];
  const shortcuts = [];
  const svc = createService({
    configFile: path.join(base, 'cfg', 'accounts.json'),
    storageCacheFile: path.join(base, 'cfg', 'storage-cache.json'),
    activityFile: path.join(base, 'cfg', 'activity.jsonl'),
    usageCacheFile: path.join(base, 'cfg', 'usage-cache.json'),
    claudeProjectsRoot: path.join(base, 'claude-projects'),
    profilesRoot,
    userProfile,
    defaultProfileDir,
    locator: { resolve: async () => 'C:\\fake\\claude.exe' },
    launcher: { launch: (exe, acct) => launched.push({ exe, id: acct.id }) },
    scanner: { scan: async () => ({ dirs: [], ok: true }) },
    shellImpl: {
      writeShortcutLink: (p) => { shortcuts.push(p); return true; },
      openPath: async () => ''
    },
    desktopDir: path.join(base, 'desktop'),
    appExePath: 'C:\\MC\\Multi-Claude.exe'
  });

  return { base, userProfile, profilesRoot, defaultProfileDir, svc, launched, shortcuts };
}

function cleanup(h) {
  fs.rmSync(h.base, { recursive: true, force: true });
}

test('init seeds the default account', async () => {
  const h = harness();
  await h.svc.init();
  const list = await h.svc.list();
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].kind, 'default');
  assert.strictEqual(list[0].label, 'Default');
  cleanup(h);
});

test('init imports an existing Claude_Work folder', async () => {
  const h = harness();
  fs.mkdirSync(path.join(h.userProfile, 'Claude_Work'));
  await h.svc.init();
  const list = await h.svc.list();
  assert.strictEqual(list.length, 2);
  const work = list.find((a) => a.label === 'Work');
  assert.strictEqual(work.kind, 'imported');
  cleanup(h);
});

test('init creates the managed root and is idempotent', async () => {
  const h = harness();
  await h.svc.init();
  await h.svc.init();
  assert.ok(fs.existsSync(h.profilesRoot));
  assert.strictEqual((await h.svc.list()).length, 1);
  cleanup(h);
});

test('add creates a folder, persists, and launches it', async () => {
  const h = harness();
  await h.svc.init();
  const a = await h.svc.add({ label: 'My Personal' });
  assert.strictEqual(a.kind, 'managed');
  assert.strictEqual(a.dir, path.join(h.profilesRoot, 'my-personal'));
  assert.ok(fs.existsSync(a.dir));
  assert.strictEqual(h.launched.length, 1);
  assert.strictEqual(h.launched[0].id, a.id);
  cleanup(h);
});

test('add resolves slug collisions', async () => {
  const h = harness();
  await h.svc.init();
  const a = await h.svc.add({ label: 'Work' });
  const b = await h.svc.add({ label: 'Work' });
  assert.strictEqual(path.basename(a.dir), 'work');
  assert.strictEqual(path.basename(b.dir), 'work-2');
  cleanup(h);
});

test('add rejects a blank label', async () => {
  const h = harness();
  await h.svc.init();
  await assert.rejects(() => h.svc.add({ label: '   ' }), (e) => e.code === 'bad_label');
  cleanup(h);
});

test('rename changes the label but never the folder', async () => {
  const h = harness();
  await h.svc.init();
  const a = await h.svc.add({ label: 'Old' });
  const dirBefore = a.dir;
  const b = await h.svc.rename({ id: a.id, label: 'New Name' });
  assert.strictEqual(b.label, 'New Name');
  assert.strictEqual(b.dir, dirBefore);
  assert.ok(fs.existsSync(dirBefore));
  cleanup(h);
});

test('remove deletes the folder and forgets the account', async () => {
  const h = harness();
  await h.svc.init();
  const a = await h.svc.add({ label: 'Temp' });
  await h.svc.remove({ id: a.id, confirmLabel: 'Temp', unlockOutsideRoot: false });
  assert.ok(!fs.existsSync(a.dir));
  assert.ok(!(await h.svc.list()).some((x) => x.id === a.id));
  cleanup(h);
});

test('remove refuses the default account and keeps it listed', async () => {
  const h = harness();
  await h.svc.init();
  const def = (await h.svc.list())[0];
  await assert.rejects(
    () => h.svc.remove({ id: def.id, confirmLabel: 'Default', unlockOutsideRoot: false }),
    (e) => e.code === 'default_account'
  );
  assert.strictEqual((await h.svc.list()).length, 1);
  cleanup(h);
});

test('remove refuses while the profile is running, and keeps the folder', async () => {
  const h = harness();
  await h.svc.init();
  const a = await h.svc.add({ label: 'Live' });
  h.svc._setScannerForTest({ scan: async () => ({ dirs: [a.dir], ok: true }) });
  await assert.rejects(
    () => h.svc.remove({ id: a.id, confirmLabel: 'Live', unlockOutsideRoot: false }),
    (e) => e.code === 'running'
  );
  assert.ok(fs.existsSync(a.dir));
  cleanup(h);
});

test('operations on an unknown id are rejected', async () => {
  const h = harness();
  await h.svc.init();
  for (const op of [
    () => h.svc.launch({ id: 'deadbeef' }),
    () => h.svc.rename({ id: 'deadbeef', label: 'x' }),
    () => h.svc.remove({ id: 'deadbeef', confirmLabel: 'x', unlockOutsideRoot: false }),
    () => h.svc.openFolder({ id: 'deadbeef' }),
    () => h.svc.createShortcut({ id: 'deadbeef' })
  ]) {
    await assert.rejects(op, (e) => e.code === 'unknown_account');
  }
  cleanup(h);
});

test('scan marks the running account by id', async () => {
  const h = harness();
  await h.svc.init();
  const a = await h.svc.add({ label: 'Live' });
  h.svc._setScannerForTest({ scan: async () => ({ dirs: [a.dir.toLowerCase()], ok: true }) });
  const state = await h.svc.scan();
  assert.strictEqual(state.ok, true);
  assert.ok(state.running.includes(a.id));
  cleanup(h);
});

test('scan reports ok:false without claiming anything is stopped', async () => {
  const h = harness();
  await h.svc.init();
  h.svc._setScannerForTest({ scan: async () => ({ dirs: [], ok: false }) });
  const state = await h.svc.scan();
  assert.strictEqual(state.ok, false);
  assert.deepStrictEqual(state.running, []);
  cleanup(h);
});

test('list flags an account whose folder has gone missing', async () => {
  const h = harness();
  await h.svc.init();
  const a = await h.svc.add({ label: 'Gone' });
  fs.rmSync(a.dir, { recursive: true, force: true });
  const row = (await h.svc.list()).find((x) => x.id === a.id);
  assert.strictEqual(row.exists, false);
  cleanup(h);
});

test('forget removes the entry without touching the folder', async () => {
  const h = harness();
  await h.svc.init();
  const a = await h.svc.add({ label: 'Keep Folder' });
  await h.svc.forget({ id: a.id });
  assert.ok(!(await h.svc.list()).some((x) => x.id === a.id));
  assert.ok(fs.existsSync(a.dir), 'forget must not delete anything');
  cleanup(h);
});

test('createShortcut writes to the desktop directory', async () => {
  const h = harness();
  await h.svc.init();
  const a = await h.svc.add({ label: 'Shortcutted' });
  const res = await h.svc.createShortcut({ id: a.id });
  assert.match(res.path, /Claude - Shortcutted\.lnk$/);
  assert.strictEqual(h.shortcuts.length, 1);
  cleanup(h);
});

test('a persisted store is reloaded rather than reseeded', async () => {
  const h = harness();
  await h.svc.init();
  const a = await h.svc.add({ label: 'Persisted' });

  const svc2 = createService({
    configFile: path.join(h.base, 'cfg', 'accounts.json'),
    profilesRoot: h.profilesRoot,
    userProfile: h.userProfile,
    defaultProfileDir: h.defaultProfileDir,
    locator: { resolve: async () => 'C:\\fake\\claude.exe' },
    launcher: { launch: () => {} },
    scanner: { scan: async () => ({ dirs: [], ok: true }) },
    shellImpl: { writeShortcutLink: () => true, openPath: async () => '' },
    desktopDir: path.join(h.base, 'desktop'),
    appExePath: 'C:\\MC\\Multi-Claude.exe'
  });
  await svc2.init();
  const list = await svc2.list();
  assert.strictEqual(list.length, 2);
  assert.ok(list.some((x) => x.id === a.id && x.label === 'Persisted'));
  cleanup(h);
});

test('scan records launch activity, and a failed scan records nothing', async () => {
  const h = harness();
  await h.svc.init();
  const a = await h.svc.add({ label: 'Tracked' });

  h.svc._setScannerForTest({ scan: async () => ({ dirs: [a.dir], ok: true }) });
  await h.svc.scan();

  h.svc._setScannerForTest({ scan: async () => ({ dirs: [], ok: false }) });
  await h.svc.scan();            // failed scan: must NOT log a stop

  let act = await h.svc.activity({ days: 7 });
  assert.strictEqual(act.recent.length, 1);
  assert.strictEqual(act.recent[0].open, true, 'still open after a failed scan');
  assert.strictEqual(act.recent[0].label, 'Tracked');

  h.svc._setScannerForTest({ scan: async () => ({ dirs: [], ok: true }) });
  await h.svc.scan();            // genuine stop

  act = await h.svc.activity({ days: 7 });
  assert.strictEqual(act.recent[0].open, false);
  assert.strictEqual(act.accounts[0].launches, 1);
  cleanup(h);
});

test('activity labels a session whose account was deleted', async () => {
  const h = harness();
  await h.svc.init();
  const a = await h.svc.add({ label: 'Gone Soon' });
  h.svc._setScannerForTest({ scan: async () => ({ dirs: [a.dir], ok: true }) });
  await h.svc.scan();
  h.svc._setScannerForTest({ scan: async () => ({ dirs: [], ok: true }) });
  await h.svc.scan();
  await h.svc.remove({ id: a.id, confirmLabel: 'Gone Soon', unlockOutsideRoot: false });

  const act = await h.svc.activity({ days: 7 });
  assert.strictEqual(act.recent[0].label, '(removed account)');
  cleanup(h);
});

test('storage reports a breakdown per account', async () => {
  const h = harness();
  await h.svc.init();
  const a = await h.svc.add({ label: 'Sized' });
  fs.mkdirSync(path.join(a.dir, 'Cache'), { recursive: true });
  fs.writeFileSync(path.join(a.dir, 'Cache', 'c.bin'), Buffer.alloc(2048));
  fs.mkdirSync(path.join(a.dir, 'claude-code'), { recursive: true });
  fs.writeFileSync(path.join(a.dir, 'claude-code', 'r.bin'), Buffer.alloc(4096));

  const rows = await h.svc.storage();
  const row = rows.find((r) => r.id === a.id);
  assert.strictEqual(row.cache, 2048);
  assert.strictEqual(row.runtime, 4096);
  assert.strictEqual(row.total, 6144);
  assert.strictEqual(row.label, 'Sized');
  cleanup(h);
});

test('storage caches results and force recalculates them', async () => {
  const h = harness();
  await h.svc.init();
  const a = await h.svc.add({ label: 'Cached' });
  fs.mkdirSync(path.join(a.dir, 'Cache'), { recursive: true });
  fs.writeFileSync(path.join(a.dir, 'Cache', 'c.bin'), Buffer.alloc(1000));

  const first = await h.svc.storage();
  assert.strictEqual(first.find((r) => r.id === a.id).cache, 1000);
  assert.strictEqual(first.find((r) => r.id === a.id).cached, false);

  // Change the folder; a cached read must NOT notice.
  fs.writeFileSync(path.join(a.dir, 'Cache', 'd.bin'), Buffer.alloc(5000));
  const second = await h.svc.storage();
  assert.strictEqual(second.find((r) => r.id === a.id).cache, 1000, 'served from cache');
  assert.strictEqual(second.find((r) => r.id === a.id).cached, true);

  const forced = await h.svc.storage({ force: true });
  assert.strictEqual(forced.find((r) => r.id === a.id).cache, 6000, 'force re-walks');
  assert.strictEqual(forced.find((r) => r.id === a.id).cached, false);
  cleanup(h);
});

test('purgeCache frees cache bytes and refuses while running', async () => {
  const h = harness();
  await h.svc.init();
  const a = await h.svc.add({ label: 'Purge Me' });
  fs.mkdirSync(path.join(a.dir, 'Cache'), { recursive: true });
  fs.writeFileSync(path.join(a.dir, 'Cache', 'c.bin'), Buffer.alloc(1024));

  h.svc._setScannerForTest({ scan: async () => ({ dirs: [a.dir], ok: true }) });
  await assert.rejects(() => h.svc.purgeCache({ id: a.id }), (e) => e.code === 'running');
  assert.ok(fs.existsSync(path.join(a.dir, 'Cache')));

  h.svc._setScannerForTest({ scan: async () => ({ dirs: [], ok: true }) });
  const { freed } = await h.svc.purgeCache({ id: a.id });
  assert.strictEqual(freed, 1024);
  assert.ok(!fs.existsSync(path.join(a.dir, 'Cache')));
  cleanup(h);
});

test('usage reads real session logs and caches across calls', async () => {
  const h = harness();
  const projRoot = path.join(h.base, 'claude-projects', 'proj');
  fs.mkdirSync(projRoot, { recursive: true });
  fs.writeFileSync(path.join(projRoot, 's1.jsonl'), [
    JSON.stringify({ type: 'user', sessionId: 's1', cwd: 'C:\\work\\demo', timestamp: '2026-11-08T10:00:00Z' }),
    JSON.stringify({
      type: 'assistant', sessionId: 's1', timestamp: '2026-11-08T10:00:01Z',
      message: { model: 'claude-opus-5-5', usage: { input_tokens: 3, output_tokens: 40 } }
    })
  ].join('\n'));

  await h.svc.init();
  const first = await h.svc.usage({ days: 30 });
  assert.strictEqual(first.totals.output, 40);
  assert.strictEqual(first.scan.parsed, 1);
  assert.strictEqual(first.byProject[0].key, 'demo');

  const second = await h.svc.usage({ days: 30 });
  assert.strictEqual(second.scan.reused, 1, 'second call must hit the cache');
  assert.strictEqual(second.scan.parsed, 0);
  cleanup(h);
});

test('usage fails clearly when there is no log directory', async () => {
  const h = harness();
  await h.svc.init();
  const r = await h.svc.usage({ days: 30 });
  assert.strictEqual(r.totals.output, 0, 'an absent directory yields empty data, not a crash');
  assert.strictEqual(r.coverage.sessions, 0);
  cleanup(h);
});

test('closeAccount reports stillRunning:false once the scan agrees it is gone', async () => {
  const h = harness();
  await h.svc.init();
  const a = await h.svc.add({ label: 'Quit Me' });

  let alive = true;
  h.svc._setCloserForTest({ close: async () => { alive = false; return { closed: 1, pids: [1] }; } });
  h.svc._setSleepForTest(async () => {});
  h.svc._setScannerForTest({ scan: async () => ({ dirs: alive ? [a.dir] : [], ok: true }) });

  const r = await h.svc.closeAccount({ id: a.id });
  assert.deepStrictEqual(r, { closed: 1, stillRunning: false });
  cleanup(h);
});

test('closeAccount tells the truth when the instance survives', async () => {
  const h = harness();
  await h.svc.init();
  const a = await h.svc.add({ label: 'Stubborn' });

  h.svc._setCloserForTest({ close: async () => ({ closed: 1, pids: [1] }) });
  h.svc._setSleepForTest(async () => {});
  h.svc._setScannerForTest({ scan: async () => ({ dirs: [a.dir], ok: true }) });

  const r = await h.svc.closeAccount({ id: a.id });
  assert.strictEqual(r.stillRunning, true, 'must not claim success while the scan still sees it');
  cleanup(h);
});

test('closeAccount does not read a failed scan as success', async () => {
  const h = harness();
  await h.svc.init();
  const a = await h.svc.add({ label: 'Unknown' });

  h.svc._setCloserForTest({ close: async () => ({ closed: 1, pids: [1] }) });
  h.svc._setSleepForTest(async () => {});
  h.svc._setScannerForTest({ scan: async () => ({ dirs: [], ok: false }) });

  const r = await h.svc.closeAccount({ id: a.id });
  assert.strictEqual(r.stillRunning, true, 'an empty set from a failed scan proves nothing');
  cleanup(h);
});

test('closeAccount on an idle profile closes nothing', async () => {
  const h = harness();
  await h.svc.init();
  const a = await h.svc.add({ label: 'Idle' });
  h.svc._setCloserForTest({ close: async () => ({ closed: 0, pids: [] }) });
  const r = await h.svc.closeAccount({ id: a.id });
  assert.deepStrictEqual(r, { closed: 0, stillRunning: false });
  cleanup(h);
});

test('launch fails cleanly when claude.exe cannot be found', async () => {
  const h = harness();
  await h.svc.init();
  h.svc._setLocatorForTest({ resolve: async () => null });
  const def = (await h.svc.list())[0];
  await assert.rejects(() => h.svc.launch({ id: def.id }), (e) => e.code === 'no_exe');
  cleanup(h);
});
