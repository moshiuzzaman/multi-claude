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

test('launch fails cleanly when claude.exe cannot be found', async () => {
  const h = harness();
  await h.svc.init();
  h.svc._setLocatorForTest({ resolve: async () => null });
  const def = (await h.svc.list())[0];
  await assert.rejects(() => h.svc.launch({ id: def.id }), (e) => e.code === 'no_exe');
  cleanup(h);
});
