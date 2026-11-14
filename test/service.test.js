'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createService } = require('../src/main/service.js');

function harness(extra = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-svc-'));
  const userProfile = path.join(base, 'user');
  const profilesRoot = path.join(userProfile, 'ClaudeProfiles');
  const defaultProfileDir = path.join(base, 'default-profile');
  fs.mkdirSync(userProfile, { recursive: true });
  fs.mkdirSync(defaultProfileDir, { recursive: true });

  const launched = [];
  const opened = [];
  const shortcuts = [];
  const terminals = [];
  const vsLaunches = [];
  const vsCodeInstalled = { value: true };
  const vsCodeRunning = { value: false };
  const authCalls = [];
  const authReply = { value: { loggedIn: false } };
  const cliInstalled = { value: true };
  const logins = [];
  const cancelled = [];
  const usageFetches = [];
  const usageReply = { value: { ok: true, reachedModel: false, meters: [
    { kind: 'session', group: 'session', percent: 52, resetsAt: 1, severity: 'normal', isActive: true, title: 'Session (5hr)' }
  ], extraUsage: null } };
  const svc = createService({
    configFile: path.join(base, 'cfg', 'accounts.json'),
    ccRoot: path.join(base, 'cfg', 'cc'),
    vscodeSettingsFile: path.join(base, 'code-user', 'settings.json'),
    vscode: {
      find: async () => (vsCodeInstalled.value ? 'C:\\vs\\Code.exe' : null),
      isRunning: async () => vsCodeRunning.value,
      launch: (exe) => { vsLaunches.push(exe); }
    },
    ccUsage: {
      fetch: async (cli, dir) => { usageFetches.push(dir); return JSON.parse(JSON.stringify(usageReply.value)); }
    },
    loginManager: {
      start: (id, opts) => { logins.push({ id, ...opts }); return { state: 'waiting' }; },
      status: () => ({ state: 'waiting' }),
      submit: () => ({ state: 'checking' }),
      cancel: (id) => { cancelled.push(id); return { state: 'cancelled' }; },
      openPage: () => ({ ok: true }),
      cancelAll: () => {}
    },
    recorderFile: path.join(base, 'cfg', 'limits-recorder.ps1'),
    ccCli: {
      find: async () => (cliInstalled.value ? { path: 'C:\\cc\\claude.exe', version: [2, 1, 319] } : null),
      authStatus: async (cli, dir) => { authCalls.push(dir); return authReply.value; },
      openTerminal: (cli, dir, args) => { terminals.push({ dir, args }); }
    },
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
      openPath: async () => '',
      openExternal: async (u) => { opened.push(u); }
    },
    desktopDir: path.join(base, 'desktop'),
    appExePath: 'C:\\MC\\Multi-Claude.exe',
    // Last, so a test can replace any default.
    ...extra
  });

  return { base, userProfile, profilesRoot, defaultProfileDir, svc, launched, opened, shortcuts,
           terminals, vsLaunches, vsCodeInstalled, vsCodeRunning,
           vscodeSettingsFile: path.join(base, 'code-user', 'settings.json'), authCalls, authReply, cliInstalled, logins, cancelled, usageFetches, usageReply };
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

test('add creates a folder and persists it, without launching Claude', async () => {
  const h = harness();
  await h.svc.init();
  const a = await h.svc.add({ label: 'My Personal' });
  assert.strictEqual(a.kind, 'managed');
  assert.strictEqual(a.dir, path.join(h.profilesRoot, 'my-personal'));
  assert.ok(fs.existsSync(a.dir));
  assert.strictEqual(h.launched.length, 0, 'Claude opens only on Launch');
  assert.ok((await h.svc.list()).some((x) => x.id === a.id));
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

test('limits shows an account as not connected until it signs in', async () => {
  const h = harness();
  await h.svc.init();
  const r = await h.svc.limits();
  assert.strictEqual(r.cli.version, '2.1.319');
  assert.strictEqual(r.accounts[0].connected, false);
  assert.strictEqual(r.accounts[0].limits, null);
  assert.strictEqual(h.authCalls.length, 0, 'no CLI call for an account never connected');
  cleanup(h);
});

test('connectAccount wires the status line and starts the hidden official sign-in', async () => {
  const h = harness();
  await h.svc.init();
  const a = await h.svc.add({ label: 'Plan Test' });

  await h.svc.connectAccount({ id: a.id });
  const dir = path.join(h.base, 'cfg', 'cc', a.id);
  const settings = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
  assert.match(settings.statusLine.command, /limits-recorder\.ps1/);
  assert.match(settings.statusLine.command, /multi-claude-limits\.json/);
  assert.ok(fs.existsSync(path.join(h.base, 'cfg', 'limits-recorder.ps1')));
  assert.strictEqual(h.terminals.length, 0, 'no terminal window for sign-in any more');
  assert.deepStrictEqual(h.logins[0], { id: a.id, cliPath: 'C:\\cc\\claude.exe', configDir: dir });
  cleanup(h);
});

test('limits reports the signed-in account and its recorded windows', async () => {
  const h = harness();
  await h.svc.init();
  const a = await h.svc.add({ label: 'Has Limits' });
  await h.svc.connectAccount({ id: a.id });

  const dir = path.join(h.base, 'cfg', 'cc', a.id);
  const later = Math.floor(Date.now() / 1000) + 3600;
  fs.writeFileSync(path.join(dir, 'multi-claude-limits.json'), JSON.stringify({
    recordedAt: Date.now(),
    rate_limits: { five_hour: { used_percentage: 67, resets_at: later }, seven_day: { used_percentage: 16, resets_at: later } }
  }));
  h.authReply.value = { loggedIn: true, email: 'me@x.com', subscriptionType: 'pro' };

  const row = (await h.svc.limits({ force: true })).accounts.find((r) => r.id === a.id);
  assert.strictEqual(row.connected, true);
  assert.strictEqual(row.auth.email, 'me@x.com');
  assert.strictEqual(row.limits.fiveHour.usedPct, 67);
  assert.strictEqual(row.limits.sevenDay.usedPct, 16);
  cleanup(h);
});

test('limits caches the auth status between refreshes', async () => {
  const h = harness();
  await h.svc.init();
  const a = await h.svc.add({ label: 'Cached Auth' });
  await h.svc.connectAccount({ id: a.id });
  await h.svc.limits();
  await h.svc.limits();
  assert.strictEqual(h.authCalls.length, 1, 'second refresh reuses the cached status');
  await h.svc.limits({ force: true });
  assert.strictEqual(h.authCalls.length, 2, 'force re-asks the CLI');
  cleanup(h);
});

test('connectAccount fails clearly when Claude Code is not installed', async () => {
  const h = harness();
  h.cliInstalled.value = false;
  await h.svc.init();
  const a = await h.svc.add({ label: 'No CLI' });
  await assert.rejects(() => h.svc.connectAccount({ id: a.id }), (e) => e.code === 'no_claude_code');
  assert.strictEqual(h.logins.length, 0);
  cleanup(h);
});

test('deleting an account also removes its Claude Code sign-in folder', async () => {
  const h = harness();
  await h.svc.init();
  const a = await h.svc.add({ label: 'Gone With CC' });
  await h.svc.connectAccount({ id: a.id });
  const dir = path.join(h.base, 'cfg', 'cc', a.id);
  assert.ok(fs.existsSync(dir));

  await h.svc.remove({ id: a.id, confirmLabel: 'Gone With CC', unlockOutsideRoot: false });
  assert.ok(!fs.existsSync(dir), 'the per-account sign-in must not be left behind');
  assert.ok(fs.existsSync(path.join(h.base, 'cfg', 'cc')), 'the cc root itself survives');
  cleanup(h);
});

test('limits fetches the /usage report for a signed-in account', async () => {
  const h = harness();
  await h.svc.init();
  const a = await h.svc.add({ label: 'Plan' });
  await h.svc.connectAccount({ id: a.id });
  h.authReply.value = { loggedIn: true, email: 'me@x.com' };

  const row = (await h.svc.limits({ force: true })).accounts.find((r) => r.id === a.id);
  assert.strictEqual(row.plan.ok, true);
  assert.strictEqual(row.plan.meters[0].percent, 52);
  assert.strictEqual(h.usageFetches.length, 1);
  cleanup(h);
});

test('limits does not fetch for an account that is not signed in', async () => {
  const h = harness();
  await h.svc.init();
  const a = await h.svc.add({ label: 'Not Yet' });
  await h.svc.connectAccount({ id: a.id });
  h.authReply.value = { loggedIn: false };
  const row = (await h.svc.limits({ force: true })).accounts.find((r) => r.id === a.id);
  assert.strictEqual(row.plan, null);
  assert.strictEqual(h.usageFetches.length, 0, 'never spawn /usage for a signed-out account');
  cleanup(h);
});

test('the /usage report is cached between quick refreshes', async () => {
  const h = harness();
  await h.svc.init();
  const a = await h.svc.add({ label: 'Cached Plan' });
  await h.svc.connectAccount({ id: a.id });
  h.authReply.value = { loggedIn: true };
  await h.svc.limits();
  await h.svc.limits();
  await h.svc.limits();
  assert.strictEqual(h.usageFetches.length, 1, 'the 20s panel refresh must not spawn Claude Code each time');
  await h.svc.limits({ force: true });
  assert.strictEqual(h.usageFetches.length, 2, 'Refresh fetches fresh');
  cleanup(h);
});

test('a fetch that reached a model pauses automatic refresh for that account', async () => {
  const h = harness();
  await h.svc.init();
  const a = await h.svc.add({ label: 'Spent' });
  await h.svc.connectAccount({ id: a.id });
  h.authReply.value = { loggedIn: true };
  h.usageReply.value = { ok: false, reachedModel: true, reason: 'reached the model' };

  await h.svc.limits({ force: true });
  assert.strictEqual(h.usageFetches.length, 1);

  // Even after the cache window, a non-forced refresh must not try again.
  h.svc._expirePlanCacheForTest();
  const row = (await h.svc.limits()).accounts.find((r) => r.id === a.id);
  assert.strictEqual(h.usageFetches.length, 1, 'no automatic retry once it cost something');
  assert.strictEqual(row.plan.reachedModel, true);
  cleanup(h);
});

test('cachedOnly answers instantly without starting Claude Code', async () => {
  const h = harness();
  await h.svc.init();
  const a = await h.svc.add({ label: 'Quick' });
  await h.svc.connectAccount({ id: a.id });

  const quick = (await h.svc.limits({ cachedOnly: true })).accounts.find((r) => r.id === a.id);
  assert.strictEqual(quick.auth.pending, true, 'unknown yet, shown as checking');
  assert.strictEqual(quick.plan, null);
  assert.strictEqual(h.authCalls.length, 0, 'no CLI started for first paint');
  assert.strictEqual(h.usageFetches.length, 0);
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

test('show starts the account again (falling back to launch) and records no activity', async () => {
  const h = harness();
  await h.svc.init();
  const def = (await h.svc.list())[0];
  const res = await h.svc.show({ id: def.id });
  assert.deepStrictEqual(res, { ok: true });
  assert.deepStrictEqual(h.launched, [{ exe: 'C:\\fake\\claude.exe', id: def.id }]);
  assert.deepStrictEqual((await h.svc.activity()).accounts, []);
  cleanup(h);
});

test('show fails cleanly for an unknown account or a missing claude.exe', async () => {
  const h = harness();
  await h.svc.init();
  await assert.rejects(() => h.svc.show({ id: 'nope' }), (e) => e.code === 'unknown_account');
  h.svc._setLocatorForTest({ resolve: async () => null });
  const def = (await h.svc.list())[0];
  await assert.rejects(() => h.svc.show({ id: def.id }), (e) => e.code === 'no_exe');
  cleanup(h);
});

// ---------------------------------------------------------- account colour --

const { PALETTE } = require('../src/main/colors.js');

/** A PNG-shaped data URL; fill makes different "pictures". */
function fakeIconUrl(fill = 0, size = 256) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4, 'latin1');
  ihdr.writeUInt32BE(size, 8);
  ihdr.writeUInt32BE(size, 12);
  return `data:image/png;base64,${Buffer.concat([sig, ihdr, Buffer.alloc(32, fill)]).toString('base64')}`;
}

test('init gives existing accounts a colour, and add picks an unused one', async () => {
  const h = harness();
  fs.mkdirSync(path.join(h.userProfile, 'Claude_Work'));
  await h.svc.init();
  const list = await h.svc.list();
  assert.deepStrictEqual(list.map((a) => a.color), [PALETTE[0].hex, PALETTE[1].hex]);
  const added = await h.svc.add({ label: 'Personal' });
  assert.strictEqual(added.color, PALETTE[2].hex);
  cleanup(h);
});

test('an account list saved before colours existed gets colours on start', async () => {
  const h = harness();
  await h.svc.init();
  const file = path.join(h.base, 'cfg', 'accounts.json');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete saved.accounts[0].color;
  fs.writeFileSync(file, JSON.stringify(saved));
  await h.svc.init();
  assert.strictEqual((await h.svc.list())[0].color, PALETTE[0].hex);
  const after = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.strictEqual(after.accounts[0].color, PALETTE[0].hex, 'saved');
  assert.strictEqual(after.version, 1, 'schema version unchanged');
  cleanup(h);
});

test('setColor saves a palette colour and refuses anything else', async () => {
  const h = harness();
  await h.svc.init();
  const a = (await h.svc.list())[0];
  const r = await h.svc.setColor({ id: a.id, color: PALETTE[3].hex.toUpperCase() });
  assert.deepStrictEqual(r, { ok: true, color: PALETTE[3].hex, shortcutUpdated: false });
  assert.strictEqual((await h.svc.list())[0].color, PALETTE[3].hex);
  await assert.rejects(() => h.svc.setColor({ id: a.id, color: '#123456' }), (e) => e.code === 'bad_color');
  await assert.rejects(() => h.svc.setColor({ id: a.id, color: 'red' }), (e) => e.code === 'bad_color');
  cleanup(h);
});

test('createShortcut writes the account icon as .ico and points the shortcut at it', async () => {
  const made = [];
  const base = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'mc-icons-'));
  const iconsDir = path.join(base, 'icons');
  const h = harness({
    iconsDir,
    makeShortcut: (opts) => { made.push(opts); return path.join(opts.desktopDir, 'x.lnk'); }
  });
  await h.svc.init();
  const a = (await h.svc.list())[0];
  await h.svc.createShortcut({ id: a.id, iconPng: fakeIconUrl() });
  const icon = made[0].iconFile;
  assert.ok(icon.startsWith(iconsDir) && icon.endsWith('.ico'));
  assert.strictEqual(fs.readFileSync(icon).readUInt16LE(2), 1, 'an icon file');
  // Without an icon the shortcut falls back to Multi-Claude's own.
  await h.svc.createShortcut({ id: a.id });
  assert.strictEqual(made[1].iconFile, null);
  await assert.rejects(() => h.svc.createShortcut({ id: a.id, iconPng: 'data:image/png;base64,AAAA' }),
    (e) => e.code === 'bad_icon');
  cleanup(h);
  fs.rmSync(base, { recursive: true, force: true });
});

test('setColor rewrites an existing shortcut with a new icon and drops the old one', async () => {
  const made = [];
  const base = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'mc-icons-'));
  const iconsDir = path.join(base, 'icons');
  const h = harness({
    iconsDir,
    makeShortcut: (opts) => {
      made.push(opts);
      const p = path.join(opts.desktopDir, `Claude - ${opts.account.label}.lnk`);
      fs.writeFileSync(p, 'lnk');
      return p;
    }
  });
  await h.svc.init();
  const a = (await h.svc.list())[0];

  // No shortcut on the desktop yet: only the colour changes.
  let r = await h.svc.setColor({ id: a.id, color: PALETTE[2].hex, iconPng: fakeIconUrl() });
  assert.strictEqual(r.shortcutUpdated, false);
  assert.strictEqual(made.length, 0);

  await h.svc.createShortcut({ id: a.id, iconPng: fakeIconUrl() });
  const first = made[0].iconFile;
  r = await h.svc.setColor({ id: a.id, color: PALETTE[4].hex, iconPng: fakeIconUrl(4) });
  assert.strictEqual(r.shortcutUpdated, true);
  const second = made[1].iconFile;
  assert.notStrictEqual(second, first);
  assert.ok(fs.existsSync(second));
  assert.ok(!fs.existsSync(first), 'the old icon file is removed');
  assert.deepStrictEqual(fs.readdirSync(iconsDir).length, 1);
  cleanup(h);
  fs.rmSync(base, { recursive: true, force: true });
});

// ------------------------------------------------------- taskbar buttons --

/** A service with a fake taskbar and scanner; nothing sleeps. */
/** Just the taskbar part of settings(). */
const tb = ({ taskbarGroups, taskbarSupported }) => ({ taskbarGroups, taskbarSupported });

function taskbarHarness() {
  const runs = [];
  const running = { dirs: [] };
  const windowsFor = { value: 1 };
  const base = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'mc-tb-'));
  const taskbar = {
    apply: async (items) => {
      runs.push({ mode: 'apply', items });
      return { ok: true, results: items.map((i) => ({ dir: i.dir, pid: 9, windows: windowsFor.value, changed: 1 })) };
    },
    clear: async (dirs) => { runs.push({ mode: 'clear', dirs }); return { ok: true, results: [] }; }
  };
  const h = harness({
    taskbar,
    iconsDir: path.join(base, 'icons'),
    taskbarDelays: [0],
    sleep: async () => {},
    scanner: { scan: async () => ({ dirs: running.dirs, ok: true }) }
  });
  const done = () => { cleanup(h); fs.rmSync(base, { recursive: true, force: true }); };
  return { h, runs, running, windowsFor, done };
}

async function addedWithIcon(h, label = 'Work') {
  const a = await h.svc.add({ label });
  await h.svc.saveIcon({ id: a.id, iconPng: fakeIconUrl(1), iconSmall: [fakeIconUrl(2, 32), fakeIconUrl(3, 16)] });
  return a;
}

test('saveIcon writes one multi-size .ico, named by its content', async () => {
  const { h, done } = taskbarHarness();
  await h.svc.init();
  const a = await h.svc.add({ label: 'Work' });
  const r1 = await h.svc.saveIcon({ id: a.id, iconPng: fakeIconUrl(1), iconSmall: [fakeIconUrl(2, 32)] });
  assert.deepStrictEqual(r1, { ok: true, changed: true, shortcutUpdated: false });
  const r2 = await h.svc.saveIcon({ id: a.id, iconPng: fakeIconUrl(1), iconSmall: [fakeIconUrl(2, 32)] });
  assert.strictEqual(r2.changed, false, 'the same icon keeps its file');
  await h.svc.saveIcon({ id: a.id, iconPng: fakeIconUrl(5), iconSmall: [] });
  await assert.rejects(() => h.svc.saveIcon({ id: a.id, iconPng: fakeIconUrl(1), iconSmall: [fakeIconUrl(2, 20)] }),
    (e) => e.code === 'bad_icon');
  done();
});

test('launching an added account gives its window its own taskbar button', async () => {
  const { h, runs, done } = taskbarHarness();
  await h.svc.init();
  const a = await addedWithIcon(h);
  await h.svc.launch({ id: a.id });
  await h.svc._taskbarIdle();
  assert.strictEqual(runs.length, 1);
  const it = runs[0].items[0];
  assert.strictEqual(it.dir, a.dir);
  assert.strictEqual(it.id, `dev.multiclaude.app.shortcut.${a.id}`);
  assert.strictEqual(it.name, 'Claude - Work');
  assert.match(it.icon, /\.ico,0$/);
  assert.strictEqual(it.command, `"C:\\MC\\Multi-Claude.exe" --launch ${a.id}`);
  done();
});

test('the default account is never moved off Claude\'s taskbar button', async () => {
  const { h, runs, running, done } = taskbarHarness();
  await h.svc.init();
  const def = (await h.svc.list())[0];
  await h.svc.saveIcon({ id: def.id, iconPng: fakeIconUrl(1) });
  await h.svc.launch({ id: def.id });
  running.dirs = [def.dir];
  await h.svc.scan();
  await h.svc._taskbarIdle();
  assert.strictEqual(runs.length, 0);
  done();
});

test('an account started outside Multi-Claude gets its button on the next scan, once', async () => {
  const { h, runs, running, done } = taskbarHarness();
  await h.svc.init();
  const a = await addedWithIcon(h);
  running.dirs = [a.dir];
  await h.svc.scan(); await h.svc._taskbarIdle();
  await h.svc.scan(); await h.svc._taskbarIdle();
  assert.strictEqual(runs.length, 1, 'applied once, not on every scan');
  // Closed and opened again: a new window, so it is applied again.
  running.dirs = [];
  await h.svc.scan();
  running.dirs = [a.dir];
  await h.svc.scan(); await h.svc._taskbarIdle();
  assert.strictEqual(runs.length, 2);
  done();
});

test('a window that wasn\'t up yet is tried again on the next scan', async () => {
  const { h, runs, running, windowsFor, done } = taskbarHarness();
  await h.svc.init();
  const a = await addedWithIcon(h);
  windowsFor.value = 0;
  running.dirs = [a.dir];
  await h.svc.scan(); await h.svc._taskbarIdle();
  windowsFor.value = 1;
  await h.svc.scan(); await h.svc._taskbarIdle();
  await h.svc.scan(); await h.svc._taskbarIdle();
  assert.strictEqual(runs.length, 2);
  done();
});

test('without an icon yet, nothing is applied', async () => {
  const { h, runs, running, done } = taskbarHarness();
  await h.svc.init();
  const a = await h.svc.add({ label: 'NoIcon' });
  running.dirs = [a.dir];
  await h.svc.scan(); await h.svc._taskbarIdle();
  await h.svc.launch({ id: a.id }); await h.svc._taskbarIdle();
  assert.strictEqual(runs.length, 0);
  done();
});

test('turning the setting off clears running windows and stops applying; on applies again', async () => {
  const { h, runs, running, done } = taskbarHarness();
  await h.svc.init();
  assert.deepStrictEqual(tb(h.svc.settings()), { taskbarGroups: true, taskbarSupported: true });
  const a = await addedWithIcon(h);
  running.dirs = [a.dir];
  await h.svc.scan(); await h.svc._taskbarIdle();

  assert.deepStrictEqual(tb(await h.svc.setTaskbarGroups({ on: false })), { taskbarGroups: false, taskbarSupported: true });
  await h.svc._taskbarIdle();
  assert.deepStrictEqual(runs[runs.length - 1], { mode: 'clear', dirs: [a.dir] });
  const before = runs.length;
  await h.svc.scan(); await h.svc._taskbarIdle();
  await h.svc.launch({ id: a.id }); await h.svc._taskbarIdle();
  assert.strictEqual(runs.length, before, 'nothing applied while off');
  const saved = JSON.parse(fs.readFileSync(path.join(h.base, 'cfg', 'accounts.json'), 'utf8'));
  assert.strictEqual(saved.taskbarGroups, false);

  await h.svc.setTaskbarGroups({ on: true }); await h.svc._taskbarIdle();
  assert.strictEqual(runs[runs.length - 1].mode, 'apply');
  done();
});

test('a new colour re-applies the running window\'s button with the new icon', async () => {
  const { h, runs, running, done } = taskbarHarness();
  await h.svc.init();
  const a = await addedWithIcon(h);
  running.dirs = [a.dir];
  await h.svc.scan(); await h.svc._taskbarIdle();
  const firstIcon = runs[0].items[0].icon;
  await h.svc.setColor({ id: a.id, color: PALETTE[5].hex, iconPng: fakeIconUrl(9) });
  await h.svc._taskbarIdle();
  assert.strictEqual(runs.length, 2);
  assert.notStrictEqual(runs[1].items[0].icon, firstIcon);
  done();
});

test('with no taskbar (a Mac), the setting is unsupported and nothing runs', async () => {
  const h = harness();
  await h.svc.init();
  assert.deepStrictEqual(tb(h.svc.settings()), { taskbarGroups: true, taskbarSupported: false });
  cleanup(h);
});

test('useVsCodeAccount writes the account config dir into settings', async () => {
  const h = harness();
  await h.svc.init();
  const accounts = await h.svc.list();
  const a = accounts[0];

  const res = await h.svc.useVsCodeAccount({ id: a.id });

  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.switched, true);
  const text = fs.readFileSync(h.vscodeSettingsFile, 'utf8');
  assert.ok(text.includes(a.id), 'the account config dir is in the file');
  assert.ok(!fs.existsSync(`${h.vscodeSettingsFile}.tmp`), 'no temp file is left behind');
  cleanup(h);
});

test('useVsCodeAccount starts VS Code only when it is not already running', async () => {
  const h = harness();
  await h.svc.init();
  const accounts = await h.svc.list();

  h.vsCodeRunning.value = true;
  const running = await h.svc.useVsCodeAccount({ id: accounts[0].id });
  assert.strictEqual(running.launched, false);
  assert.strictEqual(h.vsLaunches.length, 0, 'an open editor is never given a second window');

  h.vsCodeRunning.value = false;
  const closed = await h.svc.useVsCodeAccount({ id: accounts[0].id });
  assert.strictEqual(closed.launched, true);
  assert.deepStrictEqual(h.vsLaunches, ['C:\\vs\\Code.exe']);
  cleanup(h);
});

test('useVsCodeAccount still switches when VS Code cannot be found, and says so', async () => {
  const h = harness();
  await h.svc.init();
  const accounts = await h.svc.list();
  h.vsCodeInstalled.value = false;

  const res = await h.svc.useVsCodeAccount({ id: accounts[0].id });

  assert.strictEqual(res.switched, true);
  assert.strictEqual(res.launched, false);
  assert.strictEqual(res.notFound, true);
  assert.ok(fs.existsSync(h.vscodeSettingsFile), 'the setting is written regardless');
  cleanup(h);
});

test('useVsCodeAccount refuses to fight a setting the user made', async () => {
  const h = harness();
  await h.svc.init();
  const accounts = await h.svc.list();
  fs.mkdirSync(path.dirname(h.vscodeSettingsFile), { recursive: true });
  fs.writeFileSync(h.vscodeSettingsFile, '{\n  "claudeCode.environmentVariables": [],\n}\n');

  const res = await h.svc.useVsCodeAccount({ id: accounts[0].id });

  assert.strictEqual(res.switched, false);
  assert.strictEqual(res.reason, 'foreign');
  assert.strictEqual(
    fs.readFileSync(h.vscodeSettingsFile, 'utf8'),
    '{\n  "claudeCode.environmentVariables": [],\n}\n',
    'the file is untouched'
  );
  assert.strictEqual(h.vsLaunches.length, 0);
  cleanup(h);
});

test('useVsCodeAccount fails clearly when the settings file cannot be read', async () => {
  const h = harness();
  await h.svc.init();
  const accounts = await h.svc.list();
  // A directory where settings.json should be: present, unreadable (EISDIR).
  fs.mkdirSync(h.vscodeSettingsFile, { recursive: true });

  await assert.rejects(
    () => h.svc.useVsCodeAccount({ id: accounts[0].id }),
    (e) => e.code === 'vscode_settings'
  );
  assert.strictEqual(h.vsLaunches.length, 0);
  cleanup(h);
});

test('useVsCodeAccount backs the settings file up before changing it', async () => {
  const h = harness();
  await h.svc.init();
  const accounts = await h.svc.list();
  fs.mkdirSync(path.dirname(h.vscodeSettingsFile), { recursive: true });
  fs.writeFileSync(h.vscodeSettingsFile, '{\n  "editor.fontSize": 13,\n}\n');

  await h.svc.useVsCodeAccount({ id: accounts[0].id });

  const backups = fs.readdirSync(path.dirname(h.vscodeSettingsFile))
    .filter((n) => n.includes('multi-claude') && n.endsWith('.bak'));
  assert.strictEqual(backups.length, 1);
  assert.ok(fs.readFileSync(path.join(path.dirname(h.vscodeSettingsFile), backups[0]), 'utf8')
    .includes('editor.fontSize'), 'the backup holds the previous version');
  assert.ok(fs.readFileSync(h.vscodeSettingsFile, 'utf8').includes('editor.fontSize'),
    'the user setting survives the switch');
  cleanup(h);
});

const vscodeSettings = require('../src/main/vscode-settings.js');

test('deleting the account VS Code uses takes the block out of settings', async () => {
  const h = harness();
  await h.svc.init();
  const a = await h.svc.add({ label: 'In Use' });
  fs.mkdirSync(path.dirname(h.vscodeSettingsFile), { recursive: true });
  fs.writeFileSync(h.vscodeSettingsFile, '{\n  "editor.fontSize": 13,\n}\n');

  await h.svc.useVsCodeAccount({ id: a.id });
  await h.svc.remove({ id: a.id, confirmLabel: 'In Use', unlockOutsideRoot: false });

  const text = fs.readFileSync(h.vscodeSettingsFile, 'utf8');
  assert.strictEqual(vscodeSettings.readManaged(text), null, 'VS Code is not left pointing at a deleted folder');
  assert.strictEqual(text, '{\n  "editor.fontSize": 13,\n}\n', 'the user settings are as they were');
  cleanup(h);
});

test('deleting a different account leaves the VS Code setting alone', async () => {
  const h = harness();
  await h.svc.init();
  const keep = (await h.svc.list())[0];
  const gone = await h.svc.add({ label: 'Other' });

  await h.svc.useVsCodeAccount({ id: keep.id });
  await h.svc.remove({ id: gone.id, confirmLabel: 'Other', unlockOutsideRoot: false });

  const pointed = vscodeSettings.readManaged(fs.readFileSync(h.vscodeSettingsFile, 'utf8'));
  assert.ok(pointed && pointed.endsWith(keep.id));
  cleanup(h);
});

test('useVsCodeAccount keeps only the newest three backups', async () => {
  const h = harness();
  await h.svc.init();
  const accounts = await h.svc.list();
  fs.mkdirSync(path.dirname(h.vscodeSettingsFile), { recursive: true });
  fs.writeFileSync(h.vscodeSettingsFile, '{\n  "editor.fontSize": 13,\n}\n');

  for (let i = 0; i < 6; i++) {
    await h.svc.useVsCodeAccount({ id: accounts[0].id });
    await new Promise((r) => setTimeout(r, 5)); // distinct timestamps
  }

  const dir = path.dirname(h.vscodeSettingsFile);
  const backups = fs.readdirSync(dir).filter((n) => n.endsWith('.bak'));
  assert.strictEqual(backups.length, 3);
  assert.ok(fs.readdirSync(dir).includes('settings.json'));
  cleanup(h);
});

test('useVsCodeAccount applies clicks one at a time, last click wins', async () => {
  const h = harness();
  await h.svc.init();
  const a = (await h.svc.list())[0];
  const b = await h.svc.add({ label: 'Second' });

  const ids = [a.id, b.id, a.id, b.id, a.id, b.id];
  const results = await Promise.all(ids.map((id) => h.svc.useVsCodeAccount({ id })));

  assert.ok(results.every((r) => r.switched));
  const text = fs.readFileSync(h.vscodeSettingsFile, 'utf8');
  assert.ok(vscodeSettings.readManaged(text).endsWith(b.id), 'the last click decides');
  assert.strictEqual(text.split(vscodeSettings.BEGIN).length - 1, 1, 'exactly one block');
  assert.ok(!fs.existsSync(`${h.vscodeSettingsFile}.tmp`));
  cleanup(h);
});

test('useVsCodeAccount writes through a symlinked settings.json', async (t) => {
  const h = harness();
  await h.svc.init();
  const a = (await h.svc.list())[0];
  const real = path.join(h.base, 'dotfiles', 'settings.json');
  fs.mkdirSync(path.dirname(real), { recursive: true });
  fs.mkdirSync(path.dirname(h.vscodeSettingsFile), { recursive: true });
  fs.writeFileSync(real, '{\n  "editor.fontSize": 13,\n}\n');
  try {
    fs.symlinkSync(real, h.vscodeSettingsFile, 'file');
  } catch (e) {
    cleanup(h);
    // Windows refuses file symlinks without Developer Mode or elevation.
    return t.skip(`cannot create a symlink here (${e.code})`);
  }

  await h.svc.useVsCodeAccount({ id: a.id });

  assert.ok(fs.lstatSync(h.vscodeSettingsFile).isSymbolicLink(), 'the link is kept');
  assert.ok(vscodeSettings.readManaged(fs.readFileSync(real, 'utf8')).endsWith(a.id),
    'the linked file got the block');
  cleanup(h);
});

test('ccInstallStart starts the download without waiting and reports its status', async () => {
  let started = 0;
  let state = { state: 'idle' };
  const h = harness({
    ccInstaller: {
      start: async () => { started += 1; state = { state: 'done', version: '2.1.323' }; return state; },
      status: () => state
    }
  });
  const svc = h.svc;
  await svc.init();
  assert.deepStrictEqual(svc.ccInstallStatus(), { state: 'idle' });
  svc.ccInstallStart();
  assert.strictEqual(started, 1);
  await new Promise((r) => setImmediate(r));
  assert.deepStrictEqual(svc.ccInstallStatus(), { state: 'done', version: '2.1.323' });
  cleanup(h);
});

test('ccInstallStart says so when downloading is not available', async () => {
  const h = harness();
  await h.svc.init();
  assert.deepStrictEqual(h.svc.ccInstallStatus(), { state: 'idle' });
  assert.throws(() => h.svc.ccInstallStart(), (e) => e.code === 'unsupported');
  cleanup(h);
});

test('openGmail opens only the fixed Gmail address', async () => {
  const h = harness();
  await h.svc.openGmail({ url: 'https://evil.example/' });
  assert.deepStrictEqual(h.opened, ['https://mail.google.com/']);
  cleanup(h);
});

test('a free-plan account is never asked about Claude Code, and survives a reload', async () => {
  const h = harness();
  await h.svc.init();
  const a = await h.svc.add({ label: 'Free One' });
  await h.svc.connectAccount({ id: a.id });
  h.authReply.value = { loggedIn: true };

  const res = await h.svc.setFreePlan({ id: a.id, free: true });
  assert.strictEqual(res.freePlan, true);
  const row = (await h.svc.limits({ force: true })).accounts.find((r) => r.id === a.id);
  assert.strictEqual(row.freePlan, true);
  assert.strictEqual(row.plan, null);
  assert.strictEqual(h.authCalls.length, 0, 'no Claude Code process for a free account');
  assert.strictEqual(h.usageFetches.length, 0);

  const saved = JSON.parse(fs.readFileSync(path.join(h.base, 'cfg', 'accounts.json'), 'utf8'));
  assert.strictEqual(saved.accounts.find((x) => x.id === a.id).freePlan, true);

  await h.svc.setFreePlan({ id: a.id, free: false });
  const again = (await h.svc.limits({ force: true })).accounts.find((r) => r.id === a.id);
  assert.notStrictEqual(again.freePlan, true);
  assert.strictEqual(h.authCalls.length, 1, 'undoing it asks Claude Code again');
  assert.strictEqual(
    JSON.parse(fs.readFileSync(path.join(h.base, 'cfg', 'accounts.json'), 'utf8')).accounts.find((x) => x.id === a.id).freePlan,
    undefined
  );
  cleanup(h);
});

test('setFreePlan rejects an unknown account', async () => {
  const h = harness();
  await h.svc.init();
  await assert.rejects(() => h.svc.setFreePlan({ id: 'deadbeef', free: true }));
  cleanup(h);
});

test('deleting an account stops a sign-in still running for it', async () => {
  const h = harness();
  await h.svc.init();
  const a = await h.svc.add({ label: 'Gone Soon' });
  await h.svc.connectAccount({ id: a.id });
  await h.svc.remove({ id: a.id, confirmLabel: 'Gone Soon', unlockOutsideRoot: false });
  assert.ok(h.cancelled.includes(a.id), 'no hidden Claude Code is left running');
  cleanup(h);
});

test("list says whether each account's Claude window is signed in", async () => {
  const seen = [];
  const h = harness({ desktopSignIn: (dir) => { seen.push(dir); return dir.endsWith('work'); } });
  await h.svc.init();
  const work = await h.svc.add({ label: 'Work' });
  const home = await h.svc.add({ label: 'Home' });
  const list = await h.svc.list();
  assert.strictEqual(list.find((a) => a.id === work.id).signedIn, true);
  assert.strictEqual(list.find((a) => a.id === home.id).signedIn, false);
  assert.ok(seen.includes(work.dir));
  cleanup(h);
});

test('limits carry what each account\'s Claude window recorded, with no sign-in', async () => {
  const h = harness({ desktopUsage: (dir) => (dir.endsWith('work') ? { recordedAt: 1, session: 12, weekly: 34, extra: null } : null) });
  await h.svc.init();
  const work = await h.svc.add({ label: 'Work' });
  const home = await h.svc.add({ label: 'Home' });
  const res = await h.svc.limits({ cachedOnly: true });
  const row = (id) => res.accounts.find((r) => r.id === id);
  assert.deepStrictEqual(row(work.id).desktop, { recordedAt: 1, session: 12, weekly: 34, extra: null });
  assert.strictEqual(row(home.id).desktop, null);
  assert.strictEqual(row(work.id).connected, false, 'no Claude Code sign-in was needed');
  cleanup(h);
});

// ---- limit alerts -----------------------------------------------------------

function alertHarness(extra = {}) {
  const notes = [];
  const h = harness({
    alertStateFile: path.join(os.tmpdir(), `mc-alerts-${process.pid}-${Math.random().toString(36).slice(2)}.json`),
    notify: (n) => notes.push(n),
    ...extra
  });
  h.notes = notes;
  return h;
}

async function connectedAccount(h, label = 'Work') {
  const a = await h.svc.add({ label });
  await h.svc.connectAccount({ id: a.id });
  h.authReply.value = { loggedIn: true };
  return a;
}

const sessionAt = (percent) => ({ ok: true, reachedModel: false, extraUsage: null, meters: [
  { kind: 'session', group: 'session', percent, resetsAt: null, severity: 'normal', isActive: true, title: 'Session (5hr)' }
] });

test('alerts: a crossed threshold notifies once, labelled, from a real fetch only', async () => {
  const h = alertHarness();
  await h.svc.init();
  const a = await connectedAccount(h);
  h.usageReply.value = sessionAt(85);
  await h.svc.limits({ cachedOnly: true });
  assert.strictEqual(h.notes.length, 0, 'the instant first paint never alerts');
  await h.svc.limits({ force: true });
  assert.deepStrictEqual(h.notes.map((n) => [n.id, n.title]), [[a.id, 'Work: Session at 85%']]);
  await h.svc.limits({ force: true });
  assert.strictEqual(h.notes.length, 1, 'no repeat on the next refresh');
  h.usageReply.value = sessionAt(96);
  await h.svc.limits({ force: true });
  assert.strictEqual(h.notes[1].title, 'Work: Session at 96%');
  await h.svc._alertSaved();
  fs.rmSync(h.svc._alertStateFileForTest(), { force: true });
  cleanup(h);
});

test('alerts: what was shown is remembered across a restart', async () => {
  const h = alertHarness();
  await h.svc.init();
  await connectedAccount(h);
  h.usageReply.value = sessionAt(85);
  await h.svc.limits({ force: true });
  assert.strictEqual(h.notes.length, 1);
  await h.svc._alertSaved();

  // A second service on the same files: the same 85% must not alert again.
  const notes2 = [];
  const h2 = harness({
    configFile: path.join(h.base, 'cfg', 'accounts.json'),
    ccRoot: path.join(h.base, 'cfg', 'cc'),
    alertStateFile: h.svc._alertStateFileForTest(),
    notify: (n) => notes2.push(n)
  });
  h2.usageReply.value = sessionAt(86);
  h2.authReply.value = { loggedIn: true };
  await h2.svc.init();
  await h2.svc.limits({ force: true });
  assert.strictEqual(notes2.length, 0);
  fs.rmSync(h.svc._alertStateFileForTest(), { force: true });
  cleanup(h);
  cleanup(h2);
});

test('alerts: off, muted, and the settings round-trip', async () => {
  const h = alertHarness();
  await h.svc.init();
  const a = await connectedAccount(h);
  assert.deepStrictEqual(h.svc.settings().alerts, { on: true, thresholds: [80, 95], reset: false });
  assert.strictEqual(h.svc.settings().alertsSupported, true);

  await h.svc.setMuteAlerts({ id: a.id, mute: true });
  assert.strictEqual((await h.svc.list()).find((x) => x.id === a.id).muteAlerts, true);
  h.usageReply.value = sessionAt(85);
  await h.svc.limits({ force: true });
  assert.strictEqual(h.notes.length, 0, 'muted');
  await h.svc.setMuteAlerts({ id: a.id, mute: false });
  await h.svc.limits({ force: true });
  assert.strictEqual(h.notes.length, 0, 'unmuting does not replay the alert already passed');

  const s = await h.svc.setAlerts({ on: false, thresholds: [90, 50, 7], reset: true });
  assert.deepStrictEqual(s.alerts, { on: false, thresholds: [50, 90], reset: true });
  h.usageReply.value = sessionAt(95);
  await h.svc.limits({ force: true });
  assert.strictEqual(h.notes.length, 0, 'alerts off');
  assert.deepStrictEqual((await h.svc.setAlerts({ on: true })).alerts, { on: true, thresholds: [50, 90], reset: true }, 'other choices kept');

  await h.svc.testAlert();
  assert.strictEqual(h.notes.at(-1).title, 'Multi-Claude: test alert');
  await h.svc._alertSaved();
  fs.rmSync(h.svc._alertStateFileForTest(), { force: true });
  cleanup(h);
});

test('the background check skips only when limits were just fetched', async () => {
  const h = alertHarness();
  await h.svc.init();
  await connectedAccount(h);
  assert.deepStrictEqual(await h.svc.backgroundTick(), { ran: true });
  assert.deepStrictEqual(await h.svc.backgroundTick(), { ran: false }, 'limits were fetched moments ago');
  await h.svc.setAlerts({ on: false });
  h.svc._expireAlertTickForTest();
  assert.deepStrictEqual(await h.svc.backgroundTick(), { ran: true }, 'still runs with alerts off: it feeds the usage history');
  await h.svc._alertSaved();
  fs.rmSync(h.svc._alertStateFileForTest(), { force: true });
  cleanup(h);
});

test('alerts: without a notifier the settings say so and testAlert refuses', async () => {
  const h = harness();
  await h.svc.init();
  assert.strictEqual(h.svc.settings().alertsSupported, false);
  assert.throws(() => h.svc.testAlert(), /not available/);
  cleanup(h);
});

// ---- usage history ------------------------------------------------------------

test("usage history: live figures are kept once per fetch and merged with Claude's samples", async () => {
  const historyFile = path.join(os.tmpdir(), `mc-hist-svc-${process.pid}-${Math.random().toString(36).slice(2)}.jsonl`);
  const t0 = Date.now() - 60 * 60 * 1000;
  const h = harness({ historyFile, desktopSamples: (dir) => (dir.endsWith('work') ? [{ t: t0, session: 40, weekly: 30 }] : []) });
  await h.svc.init();
  const a = await connectedAccount(h);
  h.usageReply.value = { ok: true, reachedModel: false, extraUsage: null, meters: [
    { kind: 'session', percent: 55, resetsAt: null }, { kind: 'weekly_all', percent: 35, resetsAt: null }
  ] };
  await h.svc.limits({ force: true });
  await h.svc.limits(); // the cached report: same fetch time, not kept again
  await h.svc.limits({ cachedOnly: true });

  const hist = await h.svc.usageHistory({ id: a.id, days: 7 });
  assert.deepStrictEqual(hist.readings, { claude: 1, own: 1 });
  assert.deepStrictEqual(hist.weekly.map((p) => p.v), [30, 35]);
  assert.strictEqual(hist.days.length, 7);
  assert.strictEqual(hist.days.at(-1).sessionPeak, 55);

  await h.svc.remove({ id: a.id, confirmLabel: 'Work' });
  await h.svc.shutdown();
  assert.ok(!fs.readFileSync(historyFile, 'utf8').includes(a.id), "a deleted account's readings go with it");
  fs.rmSync(historyFile, { force: true });
  cleanup(h);
});

test("usage history without a log still shows Claude's own samples", async () => {
  const h = harness({ desktopSamples: () => [{ t: Date.now() - 1000, session: 12, weekly: 7 }] });
  await h.svc.init();
  const a = await h.svc.add({ label: 'Work' });
  const hist = await h.svc.usageHistory({ id: a.id, days: 30 });
  assert.strictEqual(hist.days.length, 30);
  assert.deepStrictEqual(hist.readings, { claude: 1, own: 0 });
  cleanup(h);
});

// ---- tray ---------------------------------------------------------------------

test('tray: close-to-tray setting, the one-time notice, and the menu snapshot', async () => {
  const h = harness({ traySupported: true });
  await h.svc.init();
  assert.strictEqual(h.svc.settings().closeToTray, true, 'on by default');
  assert.strictEqual(h.svc.settings().traySupported, true);
  assert.strictEqual((await h.svc.setCloseToTray({ on: false })).closeToTray, false);
  assert.strictEqual(await h.svc.trayNoticeOnce(), true);
  assert.strictEqual(await h.svc.trayNoticeOnce(), false, 'only once');

  const a = await h.svc.add({ label: 'Work' });
  let snap = await h.svc.trayData();
  assert.strictEqual(snap.running, null, 'unknown until a scan works');
  assert.ok(snap.accounts.some((x) => x.id === a.id && x.label === 'Work' && x.exists === true));
  assert.ok(snap.rows.has(a.id));

  h.svc._setScannerForTest({ scan: async () => ({ dirs: [a.dir], ok: true }) });
  await h.svc.backgroundTick();
  snap = await h.svc.trayData();
  assert.deepStrictEqual([...snap.running], [a.id], 'the background check scans, so the tray knows what runs');
  cleanup(h);
});

// ---- same-account check ---------------------------------------------------------

test('account check: first account is remembered, then a change or a shared account is flagged', async () => {
  const keys = new Map();
  const h = harness({ desktopAccountKey: (dir) => keys.get(path.basename(dir)) || null });
  await h.svc.init();
  const work = await h.svc.add({ label: 'Work' });
  const home = await h.svc.add({ label: 'Home' });
  const state = async (id) => (await h.svc.list()).find((a) => a.id === id).accountCheck;

  assert.deepStrictEqual(await state(work.id), { kind: 'none', sharedWith: [] }, 'not signed in yet');
  keys.set('work', 'k-work');
  keys.set('home', 'k-home');
  assert.deepStrictEqual(await state(work.id), { kind: 'ok', sharedWith: [] });
  const listed = (await h.svc.list()).find((a) => a.id === work.id);
  assert.ok(!('accountKey' in listed), 'the fingerprint never reaches the screen');

  keys.set('home', 'k-work');
  assert.deepStrictEqual(await state(home.id), { kind: 'mismatch', sharedWith: [{ id: work.id, label: 'Work' }] });
  assert.deepStrictEqual(await state(work.id), { kind: 'ok', sharedWith: [{ id: home.id, label: 'Home' }] });

  keys.set('home', 'k-new');
  assert.strictEqual((await state(home.id)).kind, 'mismatch');
  await h.svc.acceptAccount({ id: home.id });
  assert.deepStrictEqual(await state(home.id), { kind: 'ok', sharedWith: [] }, 'kept the new account');

  const saved = JSON.parse(fs.readFileSync(path.join(h.base, 'cfg', 'accounts.json'), 'utf8'));
  assert.strictEqual(saved.accounts.find((a) => a.id === home.id).accountKey, 'k-new', 'only the fingerprint is saved');
  cleanup(h);
});

test('account check: a new profile signed in to an account already in use is not bound to it', async () => {
  const keys = new Map([['work', 'same'], ['dup', 'same']]);
  const h = harness({ desktopAccountKey: (dir) => keys.get(path.basename(dir)) || null });
  await h.svc.init();
  const work = await h.svc.add({ label: 'Work' });
  await h.svc.list(); // Work binds first
  const dup = await h.svc.add({ label: 'Dup' });
  const st = (await h.svc.list()).find((a) => a.id === dup.id).accountCheck;
  assert.deepStrictEqual(st, { kind: 'ok', sharedWith: [{ id: work.id, label: 'Work' }] });
  keys.set('dup', 'own');
  assert.deepStrictEqual((await h.svc.list()).find((a) => a.id === dup.id).accountCheck, { kind: 'ok', sharedWith: [] },
    'once it signs in to its own account, that one becomes its own');
  await assert.rejects(() => { keys.delete('dup'); return h.svc.acceptAccount({ id: dup.id }); }, /isn't signed in/);
  cleanup(h);
});
