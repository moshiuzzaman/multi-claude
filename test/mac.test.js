'use strict';
// The macOS parts, tested on any OS: every command and file call is injected,
// and paths follow POSIX rules whatever OS runs the test.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const mac = require('../src/main/mac.js');
const { makePaths } = require('../src/main/paths.js');
const { createCcInstaller } = require('../src/main/cc-install.js');

const P = makePaths(path.posix);

// --------------------------------------------------------------- paths ----

test('Mac path rules: the delete guards see "/" as the separator', () => {
  assert.strictEqual(P.normalizeDir('/Users/Bob/ClaudeProfiles/Work/'), '/users/bob/claudeprofiles/work');
  assert.ok(P.isInside('/Users/bob/ClaudeProfiles/work', '/Users/bob/ClaudeProfiles'));
  assert.ok(!P.isInside('/Users/bob/ClaudeProfilesX/work', '/Users/bob/ClaudeProfiles'));
  assert.ok(!P.isInside('/Users/bob/ClaudeProfiles', '/Users/bob/ClaudeProfiles'));
  assert.strictEqual(P.segmentCount('/Users/bob'), 2);
  assert.strictEqual(P.segmentCount('/Users/bob/ClaudeProfiles/work'), 4);
  assert.ok(P.isDriveRoot('/'));
  assert.ok(!P.isDriveRoot('/Users'));
  assert.ok(P.samePath('/Users/Bob/x', '/users/bob/x/'));
});

// ------------------------------------------------------------- locator ----

test('Claude.app is found in Applications, then in ~/Applications, then by Spotlight', async () => {
  const have = new Set(['/Users/bob/Applications/Claude.app']);
  const fsImpl = { existsSync: (p) => have.has(p) };
  const run = async () => { throw new Error('no spotlight'); };
  const loc = mac.createMacLocator({ fsImpl, env: { HOME: '/Users/bob' }, run });
  assert.strictEqual(await loc.resolve(null), '/Users/bob/Applications/Claude.app');

  have.add('/Applications/Claude.app');
  assert.strictEqual(await loc.resolve(null), '/Applications/Claude.app');
  assert.strictEqual(await loc.resolve('/Users/bob/Applications/Claude.app'), '/Users/bob/Applications/Claude.app', 'a remembered app that still exists is kept');

  const spot = new Set(['/Volumes/Apps/Claude.app']);
  const loc2 = mac.createMacLocator({
    fsImpl: { existsSync: (p) => spot.has(p) },
    env: { HOME: '/Users/bob' },
    run: async (cmd, args) => { assert.strictEqual(cmd, 'mdfind'); assert.match(args[0], /com\.anthropic\.claudefordesktop/); return '/Volumes/Apps/Claude.app\n'; }
  });
  assert.strictEqual(await loc2.resolve(null), '/Volumes/Apps/Claude.app');
});

test('the default profile is Claude\'s own Application Support folder', () => {
  assert.strictEqual(mac.defaultProfileDir('/Users/bob'), '/Users/bob/Library/Application Support/Claude');
});

// ------------------------------------------------------------ launcher ----

test('an added account opens as a new instance with its own profile folder', () => {
  assert.deepStrictEqual(
    mac.buildOpenArgs('/Applications/Claude.app', { kind: 'managed', dir: '/Users/bob/ClaudeProfiles/work' }),
    ['-n', '-a', '/Applications/Claude.app', '--args', '--user-data-dir=/Users/bob/ClaudeProfiles/work']
  );
  assert.deepStrictEqual(mac.buildOpenArgs('/Applications/Claude.app', { kind: 'default', dir: 'x' }), ['-a', '/Applications/Claude.app']);
});

test('launch goes through `open`, detached', () => {
  const calls = [];
  const l = mac.createMacLauncher({ spawnImpl: (cmd, args, opts) => { calls.push({ cmd, args, opts }); return { unref() {} }; } });
  l.launch('/Applications/Claude.app', { kind: 'managed', dir: '/p/x' });
  assert.strictEqual(calls[0].cmd, 'open');
  assert.strictEqual(calls[0].opts.detached, true);
});

// ------------------------------------------------------------- scanner ----

const PS = [
  '  101     1 /Applications/Claude.app/Contents/MacOS/Claude',
  '  102   101 /Applications/Claude.app/Contents/Frameworks/Claude Helper (Renderer).app/Contents/MacOS/Claude Helper (Renderer) --type=renderer --user-data-dir=/Users/bob/Library/Application Support/Claude --lang=en',
  '  201     1 /Applications/Claude.app/Contents/MacOS/Claude --user-data-dir=/Users/bob/ClaudeProfiles/work',
  '  202   201 /Applications/Claude.app/Contents/Frameworks/Claude Helper.app/Contents/MacOS/Claude Helper --type=utility --user-data-dir=/Users/bob/ClaudeProfiles/work',
  '  300     1 /Applications/Safari.app/Contents/MacOS/Safari --user-data-dir=/nope',
  '  garbage line'
].join('\n');

test('ps output: only Claude processes, profile paths with spaces kept whole', () => {
  const list = mac.parsePs(PS);
  assert.deepStrictEqual(list.map((p) => p.pid), [101, 102, 201, 202]);
  assert.strictEqual(list[0].dir, null, 'the default instance has no flag on its main process');
  assert.strictEqual(list[1].dir, '/users/bob/library/application support/claude');
  assert.strictEqual(list[2].dir, '/users/bob/claudeprofiles/work');
});

test('scan lists each open profile once', async () => {
  const s = mac.createMacScanner({ run: async () => PS });
  const r = await s.scan();
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.dirs.sort(), ['/users/bob/claudeprofiles/work', '/users/bob/library/application support/claude']);
});

test('a failed scan is "unknown", never "not running"', async () => {
  const s = mac.createMacScanner({ run: async () => { throw new Error('ps failed'); } });
  assert.deepStrictEqual(await s.scan(), { dirs: [], ok: false });
});

// -------------------------------------------------------------- closer ----

test('close asks the profile\'s own instance to quit, and touches nothing else', async () => {
  const alive = new Set([101, 102, 201, 202]);
  const sent = [];
  const closer = mac.createMacCloser({
    run: async () => PS,
    kill: (pid, sig) => { sent.push([pid, sig]); if (sig === 'SIGTERM' && pid === 201) { alive.delete(201); alive.delete(202); } },
    isAlive: (pid) => alive.has(pid),
    sleep: async () => {}
  });
  const r = await closer.close('/Users/bob/ClaudeProfiles/work');
  assert.deepStrictEqual(r, { closed: 1, pids: [201] });
  assert.deepStrictEqual(sent, [[201, 'SIGTERM']], 'a clean quit needs no SIGKILL');
  assert.ok(alive.has(101) && alive.has(102), 'the default instance is untouched');
});

test('close ends what is left of that tree after the grace period', async () => {
  const alive = new Set([201, 202]);
  const sent = [];
  const closer = mac.createMacCloser({
    run: async () => PS,
    kill: (pid, sig) => { sent.push([pid, sig]); if (sig === 'SIGKILL') alive.delete(pid); },
    isAlive: (pid) => alive.has(pid),
    sleep: async () => {},
    graceMs: 500
  });
  await closer.close('/Users/bob/ClaudeProfiles/work');
  assert.deepStrictEqual(sent, [[201, 'SIGTERM'], [201, 'SIGKILL'], [202, 'SIGKILL']]);
});

test('close of a profile that is not open does nothing', async () => {
  const closer = mac.createMacCloser({ run: async () => PS, kill: () => assert.fail('nothing to kill'), isAlive: () => false });
  assert.deepStrictEqual(await closer.close('/Users/bob/ClaudeProfiles/other'), { closed: 0, pids: [] });
});

// ------------------------------------------------------------- VS Code ----

test('VS Code is found in Applications and detected from ps', async () => {
  const v = mac.createMacVsCode({
    env: { HOME: '/Users/bob' },
    fsImpl: { existsSync: (p) => p === '/Applications/Visual Studio Code.app' },
    run: async () => '/Applications/Visual Studio Code.app/Contents/MacOS/Electron\n',
    spawnImpl: () => ({ unref() {} })
  });
  assert.strictEqual(v.find(), '/Applications/Visual Studio Code.app');
  assert.strictEqual(await v.isRunning(), true);
});

// ----------------------------------------------------------- shortcuts ----

test('a Mac shortcut is a small app that runs Multi-Claude with --launch', () => {
  const desk = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-mac-desk-'));
  const app = mac.createMacShortcut({
    fsImpl: fs, desktopDir: desk, exePath: "/Applications/Multi-Claude.app/Contents/MacOS/Multi-Claude",
    account: { id: 'ab12cd34', label: "Bob's & Work" }
  });
  assert.ok(app.endsWith("Claude - Bob's & Work.app"));
  const script = fs.readFileSync(path.join(app, 'Contents', 'MacOS', 'launch'), 'utf8');
  assert.match(script, /^#!\/bin\/sh/);
  assert.match(script, /exec '\/Applications\/Multi-Claude\.app\/Contents\/MacOS\/Multi-Claude' --launch 'ab12cd34'/);
  const plist = fs.readFileSync(path.join(app, 'Contents', 'Info.plist'), 'utf8');
  assert.match(plist, /<string>launch<\/string>/);
  assert.match(plist, /Bob's &amp; Work/, 'the name is escaped in the plist');
  fs.rmSync(desk, { recursive: true, force: true });
});

test('shell and AppleScript quoting can\'t be broken out of', () => {
  assert.strictEqual(mac.shQuote("it's"), "'it'\\''s'");
  assert.strictEqual(mac.asQuote('say "hi" \\ bye'), '"say \\"hi\\" \\\\ bye"');
});

// --------------------------------------------------------- Claude Code ----

test('Claude Code is looked for in the usual Mac places and in Claude\'s own copies', () => {
  const have = new Set([
    '/opt/homebrew/bin/claude',
    '/Users/bob/Library/Application Support/Claude/claude-code/2.1.322/claude'
  ]);
  const fsImpl = {
    existsSync: (p) => have.has(p),
    readdirSync: (d) => {
      if (d === '/Users/bob/Library/Application Support/Claude/claude-code') return ['2.1.322'];
      throw new Error('ENOENT');
    }
  };
  const found = mac.ccCandidatePaths({ HOME: '/Users/bob', PATH: '/usr/bin:/opt/homebrew/bin' }, fsImpl, []);
  assert.deepStrictEqual(found, ['/opt/homebrew/bin/claude', '/Users/bob/Library/Application Support/Claude/claude-code/2.1.322/claude']);
});

test('the Claude Code download picks the Mac binary and marks it runnable', async () => {
  const urls = [];
  const modes = [];
  const sha = 'a'.repeat(64);
  const inst = createCcInstaller({
    os: 'darwin', arch: 'arm64', rootDir: '/x/claude-code',
    fetchText: async () => '2.1.323',
    fetchJson: async () => ({ platforms: { 'darwin-arm64': { binary: 'claude', checksum: sha, size: 10 } } }),
    download: async (url) => { urls.push(url); },
    rename: async () => {},
    remove: async () => {},
    chmod: async (p, m) => { modes.push([p, m]); }
  });
  const done = await inst.start();
  assert.strictEqual(done.state, 'done');
  assert.strictEqual(urls[0], 'https://downloads.claude.ai/claude-code-releases/2.1.323/darwin-arm64/claude');
  assert.strictEqual(modes[0][1], 0o755);
  assert.match(modes[0][0], /claude$/);
});

// ------------------------------------------------------------ platform ----

test('the Mac parts never use PowerShell', () => {
  const { platformParts } = require('../src/main/platform.js');
  const parts = platformParts({ platform: 'darwin', env: { HOME: '/Users/bob' } });
  assert.strictEqual(parts.os, 'darwin');
  assert.strictEqual(parts.runPowerShell, null);
  assert.strictEqual(parts.recordStatusLine, false);
  assert.strictEqual(parts.exeLabel, 'Claude.app');
  for (const k of ['locator', 'launcher', 'scanner', 'closer', 'vscode', 'ccCandidates', 'makeShortcut']) assert.ok(parts[k], k);
});
