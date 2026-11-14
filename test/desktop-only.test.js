'use strict';
// A PC with only Claude Desktop: no Claude Code anywhere (no CLI, no
// ~/.claude folder, no ~/.claude.json, no editor extension). Every feature
// must still work from what Claude Desktop itself keeps in each profile.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createService } = require('../src/main/service.js');
const { candidatePaths, findClaudeCli } = require('../src/main/cc-cli.js');
const { buildTrayModel, tooltip } = require('../src/main/tray.js');

const HOUR = 60 * 60 * 1000;

function writeSamples(dir, samples) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'plan-usage-history.json'), JSON.stringify({ samples }));
}

function desktopOnlyPc() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-desk-'));
  const userProfile = path.join(base, 'user');
  const defaultProfileDir = path.join(base, 'appdata', 'Claude');
  fs.mkdirSync(userProfile, { recursive: true });
  fs.mkdirSync(defaultProfileDir, { recursive: true });
  const notes = [];
  const launched = [];
  const svc = createService({
    configFile: path.join(base, 'cfg', 'accounts.json'),
    ccRoot: path.join(base, 'cfg', 'cc'),
    recorderFile: path.join(base, 'cfg', 'limits-recorder.ps1'),
    // The real finder, run against this PC's (empty) folders.
    ccCli: {
      find: () => findClaudeCli({
        env: { USERPROFILE: userProfile, APPDATA: path.join(base, 'appdata'), LOCALAPPDATA: path.join(base, 'local'), PATH: '' },
        profileDirs: [defaultProfileDir]
      }),
      authStatus: async () => { throw new Error('no CLI, must not be asked'); },
      openTerminal: () => { throw new Error('no CLI, must not be opened'); }
    },
    ccUsage: { fetch: async () => { throw new Error('no CLI, /usage must not run'); } },
    storageCacheFile: path.join(base, 'cfg', 'storage-cache.json'),
    activityFile: path.join(base, 'cfg', 'activity.jsonl'),
    usageCacheFile: path.join(base, 'cfg', 'usage-cache.json'),
    alertStateFile: path.join(base, 'cfg', 'alert-state.json'),
    historyFile: path.join(base, 'cfg', 'usage-history.jsonl'),
    // Where Claude Code's logs and config would be: they don't exist here.
    claudeProjectsRoot: path.join(userProfile, '.claude', 'projects'),
    claudeConfigFile: path.join(userProfile, '.claude.json'),
    profilesRoot: path.join(userProfile, 'ClaudeProfiles'),
    userProfile,
    defaultProfileDir,
    locator: { resolve: async () => 'C:\\Program Files\\WindowsApps\\Claude_1.0.0_x64__pzs8sxrjxfjjc\\app\\claude.exe' },
    launcher: { launch: (exe, acct) => launched.push(acct.id) },
    scanner: { scan: async () => ({ dirs: [defaultProfileDir], ok: true }) },
    shellImpl: { writeShortcutLink: () => true, openPath: async () => '', openExternal: async () => {} },
    desktopDir: path.join(base, 'desktop'),
    appExePath: 'C:\\MC\\Multi-Claude.exe',
    notify: (n) => notes.push(n)
  });
  return { base, userProfile, defaultProfileDir, svc, notes, launched };
}

test('desktop-only PC: no Claude Code is found anywhere', async () => {
  const h = desktopOnlyPc();
  const env = { USERPROFILE: h.userProfile, APPDATA: path.join(h.base, 'appdata'), LOCALAPPDATA: path.join(h.base, 'local'), PATH: '' };
  assert.deepStrictEqual(candidatePaths(env, fs, [h.defaultProfileDir]), []);
  assert.strictEqual(await findClaudeCli({ env, profileDirs: [h.defaultProfileDir] }), null);
  fs.rmSync(h.base, { recursive: true, force: true });
});

test('desktop-only PC: accounts, launch, scan and limits work from Claude Desktop alone', async () => {
  const h = desktopOnlyPc();
  await h.svc.init();
  const work = await h.svc.add({ label: 'Work' });
  const list = await h.svc.list();
  const def = list.find((a) => a.kind === 'default');
  const workDir = list.find((a) => a.id === work.id).dir;

  // Launching and seeing what runs need nothing from Claude Code.
  await h.svc.launch({ id: work.id });
  assert.deepStrictEqual(h.launched, [work.id]);
  const scan = await h.svc.scan();
  assert.ok(scan.running.includes(def.id));

  // Claude Desktop's own record gives the figures.
  const now = Date.now();
  writeSamples(h.defaultProfileDir, [{ t: now - 3 * HOUR, u: { fh: 20, sd: 40 } }, { t: now - HOUR, u: { fh: 37, sd: 66 } }]);
  writeSamples(workDir, [{ t: now - 2 * HOUR, u: { fh: 85, sd: 50 } }]);

  const res = await h.svc.limits({});
  assert.strictEqual(res.cli, null, 'no Claude Code');
  const row = res.accounts.find((r) => r.id === def.id);
  assert.strictEqual(row.plan, null);
  assert.strictEqual(row.connected, false);
  assert.strictEqual(row.desktop.session, 37);
  assert.strictEqual(row.desktop.weekly, 66);

  // The instant first paint gives the same desktop figures.
  const cached = await h.svc.limits({ cachedOnly: true });
  assert.strictEqual(cached.accounts.find((r) => r.id === work.id).desktop.session, 85);

  // Signing in to Claude Code and opening it say clearly that it is missing.
  await assert.rejects(() => h.svc.connectAccount({ id: work.id }), (e) => e.code === 'no_claude_code');
  await assert.rejects(() => h.svc.openClaudeCode({ id: work.id }), (e) => e.code === 'no_claude_code');
  fs.rmSync(h.base, { recursive: true, force: true });
});

test('desktop-only PC: limit alerts fire from Claude Desktop\'s figures', async () => {
  const h = desktopOnlyPc();
  await h.svc.init();
  const work = await h.svc.add({ label: 'Work' });
  const workDir = (await h.svc.list()).find((a) => a.id === work.id).dir;
  const now = Date.now();
  writeSamples(workDir, [{ t: now - 4 * HOUR, u: { fh: 10, sd: 50 } }]);
  await h.svc.limits({}); // first reading: below every level
  assert.strictEqual(h.notes.length, 0);

  writeSamples(workDir, [{ t: now - 4 * HOUR, u: { fh: 10, sd: 50 } }, { t: now - 60000, u: { fh: 96, sd: 50 } }]);
  await h.svc.limits({});
  assert.strictEqual(h.notes.length, 1);
  assert.match(h.notes[0].title + ' ' + h.notes[0].body, /Work/);
  assert.match(h.notes[0].title + ' ' + h.notes[0].body, /96%|95%/);
  fs.rmSync(h.base, { recursive: true, force: true });
});

test('desktop-only PC: tray menu shows the figures and the running account', async () => {
  const h = desktopOnlyPc();
  await h.svc.init();
  const now = Date.now();
  writeSamples(h.defaultProfileDir, [{ t: now - HOUR, u: { fh: 37, sd: 66 } }]);
  await h.svc.scan();
  const snap = await h.svc.trayData();
  const model = buildTrayModel({ ...snap, now });
  const row = model.find((i) => i.type === 'item' && /Default/.test(i.label));
  assert.ok(row, 'the Default account is in the menu');
  assert.match(row.label, /●/);
  assert.match(row.label, /S 37% · W 66%/);
  assert.ok(tooltip({ ...snap, now }).length <= 127);
  fs.rmSync(h.base, { recursive: true, force: true });
});

test('desktop-only PC: usage history comes from Claude Desktop\'s own record', async () => {
  const h = desktopOnlyPc();
  await h.svc.init();
  const def = (await h.svc.list()).find((a) => a.kind === 'default');
  const now = Date.now();
  writeSamples(h.defaultProfileDir, [
    { t: now - 30 * HOUR, u: { fh: 50, sd: 30 } },
    { t: now - 5 * HOUR, u: { fh: 80, sd: 45 } },
    { t: now - HOUR, u: { fh: 20, sd: 47 } }
  ]);
  const hist = await h.svc.usageHistory({ id: def.id, days: 7 });
  assert.strictEqual(hist.readings.claude, 3);
  assert.strictEqual(hist.readings.own, 0);
  assert.ok(hist.weekly.length >= 3);
  assert.ok(hist.days.some((d) => d.sessionPeak === 80 || d.sessionPeak === 50));
  fs.rmSync(h.base, { recursive: true, force: true });
});

test('desktop-only PC: the Claude Code panels report "nothing there" instead of failing', async () => {
  const h = desktopOnlyPc();
  await h.svc.init();
  // No ~/.claude/projects: an empty dashboard, not an error.
  const usage = await h.svc.usage({ days: 30 });
  assert.strictEqual(usage.scan.files, 0);
  // No ~/.claude.json: "not available", not an error.
  const info = await h.svc.accountInfo();
  assert.strictEqual(info.available, false);
  // The account check needs only Claude Desktop's own files.
  const list = await h.svc.list();
  assert.ok(list.every((a) => a.accountCheck && typeof a.accountCheck.kind === 'string'));
  fs.rmSync(h.base, { recursive: true, force: true });
});
