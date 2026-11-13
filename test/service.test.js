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
    ...extra,
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
    appExePath: 'C:\\MC\\Multi-Claude.exe'
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
