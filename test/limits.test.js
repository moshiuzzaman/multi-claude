'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const L = require('../src/main/limits.js');
const CC = require('../src/main/cc-cli.js');

const NOW = Date.parse('2026-11-09T12:00:00Z');
const inSec = (ms) => Math.floor((NOW + ms) / 1000);

function recorded(rl, at = NOW - 60000) {
  return JSON.stringify({ recordedAt: at, rate_limits: rl });
}

// --- parseLimits ---------------------------------------------------------

test('parseLimits reads both windows', () => {
  const r = L.parseLimits(recorded({
    five_hour: { used_percentage: 23.5, resets_at: inSec(3600e3) },
    seven_day: { used_percentage: 41.2, resets_at: inSec(86400e3) }
  }), NOW);
  assert.strictEqual(r.fiveHour.usedPct, 23.5);
  assert.strictEqual(r.sevenDay.usedPct, 41.2);
  assert.strictEqual(r.fiveHour.expired, false);
  assert.strictEqual(r.recordedAt, NOW - 60000);
});

test('parseLimits marks a window past its reset as expired', () => {
  const r = L.parseLimits(recorded({
    five_hour: { used_percentage: 90, resets_at: inSec(-60e3) }
  }), NOW);
  assert.strictEqual(r.fiveHour.expired, true, 'a stale 90% must not be shown as current');
  assert.strictEqual(r.sevenDay, null);
});

test('parseLimits tolerates a UTF-8 BOM', () => {
  // Windows PowerShell 5 writes one with some encodings.
  const r = L.parseLimits('\uFEFF' + recorded({ five_hour: { used_percentage: 5, resets_at: inSec(1e6) } }), NOW);
  assert.strictEqual(r.fiveHour.usedPct, 5);
});

test('parseLimits clamps and rejects junk', () => {
  assert.strictEqual(L.parseLimits('{ nope', NOW), null);
  assert.strictEqual(L.parseLimits(JSON.stringify({}), NOW), null);
  assert.strictEqual(L.parseLimits(recorded({ five_hour: { used_percentage: 'x' } }), NOW), null);
  const r = L.parseLimits(recorded({ five_hour: { used_percentage: 140, resets_at: inSec(1e6) } }), NOW);
  assert.strictEqual(r.fiveHour.usedPct, 100);
});

// --- status line wiring --------------------------------------------------

test('statusLineCommand uses forward slashes and quotes both paths', () => {
  const c = L.statusLineCommand('C:\\Users\\A B\\rec.ps1', 'C:\\Users\\A B\\limits.json');
  assert.ok(c.startsWith('powershell.exe -NoProfile'));
  assert.ok(c.includes('"C:/Users/A B/rec.ps1"'));
  assert.ok(c.includes('"C:/Users/A B/limits.json"'));
  assert.ok(!c.includes('\\'), 'no backslashes for a bash-run command to eat');
});

test('ensureStatusLine sets the command and preserves other settings', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-sl-'));
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ theme: 'dark', model: 'opus' }));

  assert.strictEqual(await L.ensureStatusLine(dir, 'CMD'), true);
  const s = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
  assert.deepStrictEqual(s.statusLine, { type: 'command', command: 'CMD', padding: 0 });
  assert.strictEqual(s.theme, 'dark');
  assert.strictEqual(s.model, 'opus');

  assert.strictEqual(await L.ensureStatusLine(dir, 'CMD'), false, 'idempotent');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('ensureStatusLine creates settings in a fresh config dir', async () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mc-sl2-')), 'cc', 'abc');
  await L.ensureStatusLine(dir, 'CMD');
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')).statusLine.command, 'CMD');
});

test('the recorder keeps only rate_limits', () => {
  // Static check on the script: it must never write anything but rate_limits.
  assert.ok(L.RECORDER_PS1.includes('rate_limits = $rl'));
  assert.ok(!/transcript|cwd|workspace|session_id/i.test(
    L.RECORDER_PS1.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n')
  ), 'no other session field is touched');
});

// --- CLI helpers ---------------------------------------------------------

test('pickAuth keeps descriptive fields only', () => {
  const a = CC.pickAuth({
    loggedIn: true, email: 'a@b.com', orgName: 'Org', subscriptionType: 'pro',
    authMethod: 'claude.ai', accessToken: 'SECRET', orgId: 'x'
  });
  assert.strictEqual(a.email, 'a@b.com');
  assert.ok(!JSON.stringify(a).includes('SECRET'));
  assert.ok(!('orgId' in a));
});

test('pickAuth treats anything odd as not signed in', () => {
  assert.strictEqual(CC.pickAuth(null).loggedIn, false);
  assert.strictEqual(CC.pickAuth({ loggedIn: 'yes' }).loggedIn, false);
});

test('parseVersion and compareVersions pick the newest', () => {
  assert.deepStrictEqual(CC.parseVersion('2.1.319 (Claude Code)'), [2, 1, 319]);
  assert.strictEqual(CC.parseVersion('nope'), null);
  assert.ok(CC.compareVersions([2, 1, 319], [2, 1, 112]) > 0);
  assert.ok(CC.compareVersions([2, 1, 99], [2, 1, 100]) < 0, 'numeric, not string, comparison');
});

test('findClaudeCli chooses the highest version installed', async () => {
  const files = {
    'H\\.local\\bin\\claude.exe': '2.1.112 (Claude Code)',
    'A\\npm\\claude.cmd': '2.1.224 (Claude Code)',
    'H\\.vscode\\extensions\\anthropic.claude-code-2.1.319-win32-x64\\resources\\native-binary\\claude.exe': '2.1.319 (Claude Code)'
  };
  const fsImpl = {
    existsSync: (p) => p in files,
    readdirSync: () => ['anthropic.claude-code-2.1.319-win32-x64', 'other.ext']
  };
  const best = await CC.findClaudeCli({
    env: { USERPROFILE: 'H', APPDATA: 'A' },
    fsImpl,
    run: async (p) => files[p]
  });
  assert.deepStrictEqual(best.version, [2, 1, 319]);
  assert.ok(best.path.includes('anthropic.claude-code-2.1.319'));
});

test('findClaudeCli returns null when none is installed', async () => {
  const best = await CC.findClaudeCli({
    env: { USERPROFILE: 'H', APPDATA: 'A' },
    fsImpl: { existsSync: () => false, readdirSync: () => [] },
    run: async () => ''
  });
  assert.strictEqual(best, null);
});

// A fake disk: `files` maps a full path to the version that binary reports.
function fakeDisk(files) {
  const all = Object.keys(files);
  return {
    existsSync: (p) => p in files,
    readdirSync: (dir) => {
      const names = new Set();
      for (const f of all) {
        if (f.startsWith(dir + '\\')) names.add(f.slice(dir.length + 1).split('\\')[0]);
      }
      if (names.size === 0) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return [...names];
    }
  };
}

test('findClaudeCli finds the copy Claude Desktop keeps in a profile folder', async () => {
  const files = {
    'L\\Claude-Data\\claude_abc\\claude-code\\2.1.321\\d0e23af87588\\claude.exe': '2.1.321 (Claude Code)',
    'H\\ClaudeProfiles\\work\\claude-code\\2.1.317\\a33aa5518497\\claude.exe': '2.1.317 (Claude Code)'
  };
  const best = await CC.findClaudeCli({
    env: { USERPROFILE: 'H', APPDATA: 'A', LOCALAPPDATA: 'L' },
    fsImpl: fakeDisk(files),
    run: async (p) => files[p],
    profileDirs: ['H\\ClaudeProfiles\\work']
  });
  assert.deepStrictEqual(best.version, [2, 1, 321]);
  assert.ok(best.path.startsWith('L\\Claude-Data\\claude_abc\\claude-code'));
});

test('findClaudeCli finds a classic Claude Desktop install and a copy on PATH', async () => {
  const classic = { 'A\\Claude\\claude-code\\2.1.300\\claude.exe': '2.1.300 (Claude Code)' };
  const a = await CC.findClaudeCli({
    env: { USERPROFILE: 'H', APPDATA: 'A', LOCALAPPDATA: 'L' },
    fsImpl: fakeDisk(classic), run: async (p) => classic[p]
  });
  assert.deepStrictEqual(a.version, [2, 1, 300]);

  const onPath = { 'D\\tools\\claude.exe': '2.1.310 (Claude Code)' };
  const b = await CC.findClaudeCli({
    env: { USERPROFILE: 'H', APPDATA: 'A', LOCALAPPDATA: 'L', Path: 'C\\Windows;D\\tools;' },
    fsImpl: fakeDisk(onPath), run: async (p) => onPath[p]
  });
  assert.strictEqual(b.path, 'D\\tools\\claude.exe');
});

test('candidatePaths lists each binary once', () => {
  const files = { 'H\\.local\\bin\\claude.exe': 'x' };
  const got = CC.candidatePaths({ USERPROFILE: 'H', APPDATA: 'A', LOCALAPPDATA: 'L', PATH: 'H\\.local\\bin' }, fakeDisk(files));
  assert.deepStrictEqual(got, ['H\\.local\\bin\\claude.exe']);
});
