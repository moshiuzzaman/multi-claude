'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const del = require('../src/main/deleter.js');

const USER = 'C:\\Users\\Bob';
const ROOT = 'C:\\Users\\Bob\\ClaudeProfiles';

function acct(over = {}) {
  return {
    id: 'i1', label: 'Personal', kind: 'managed',
    dir: path.join(ROOT, 'personal'), createdAt: 'x', ...over
  };
}

function opts(over = {}) {
  return {
    account: acct(), runningDirs: [], confirmLabel: 'Personal',
    unlockOutsideRoot: false, profilesRoot: ROOT, userProfile: USER,
    skipExistence: true, ...over
  };
}

async function blocked(o, code) {
  await assert.rejects(() => del.checkDeletable(o), (e) => {
    assert.strictEqual(e.code, code, `expected ${code}, got ${e.code}`);
    return true;
  });
}

test('refuses the default account', async () => {
  await blocked(opts({ account: acct({ kind: 'default' }) }), 'default_account');
});

test('refuses an account that is running', async () => {
  await blocked(opts({ runningDirs: ['c:\\users\\bob\\claudeprofiles\\personal'] }), 'running');
});

test('running check ignores case and trailing separators', async () => {
  await blocked(opts({ runningDirs: ['C:\\Users\\Bob\\ClaudeProfiles\\Personal\\'] }), 'running');
});

test('refuses a drive root', async () => {
  await blocked(opts({ account: acct({ dir: 'C:\\' }) }), 'drive_root');
});

test('refuses the user profile root', async () => {
  await blocked(
    opts({ account: acct({ dir: USER, kind: 'imported' }), unlockOutsideRoot: true }),
    'user_profile_root'
  );
});

test('refuses a path that is too shallow', async () => {
  await blocked(
    opts({ account: acct({ dir: 'C:\\Users', kind: 'imported' }), unlockOutsideRoot: true }),
    'too_shallow'
  );
});

test('refuses a managed-kind path outside the managed root', async () => {
  await blocked(opts({ account: acct({ dir: 'C:\\Somewhere\\Else\\x' }) }), 'outside_root');
});

test('refuses an imported path outside the root without the unlock', async () => {
  await blocked(
    opts({ account: acct({ kind: 'imported', dir: 'C:\\Users\\Bob\\Claude_Work' }) }),
    'outside_root'
  );
});

test('allows an imported path outside the root WITH the unlock', async () => {
  await del.checkDeletable(opts({
    account: acct({ kind: 'imported', dir: 'C:\\Users\\Bob\\Claude_Work' }),
    unlockOutsideRoot: true
  }));
});

test('refuses a wrong confirmation label, including case and whitespace', async () => {
  await blocked(opts({ confirmLabel: 'personal' }), 'label_mismatch');
  await blocked(opts({ confirmLabel: ' Personal' }), 'label_mismatch');
  await blocked(opts({ confirmLabel: '' }), 'label_mismatch');
});

test('allows the happy path', async () => {
  await del.checkDeletable(opts());
});

test('refuses a junction and does not follow it', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-del-'));
  const root = path.join(base, 'ClaudeProfiles');
  const real = path.join(base, 'precious');
  const link = path.join(root, 'linked');
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(real);
  fs.writeFileSync(path.join(real, 'keep.txt'), 'do not delete');
  fs.symlinkSync(real, link, 'junction');

  await assert.rejects(
    () => del.checkDeletable({
      account: { id: 'j', label: 'Linked', kind: 'managed', dir: link, createdAt: 'x' },
      runningDirs: [], confirmLabel: 'Linked', unlockOutsideRoot: false,
      profilesRoot: root, userProfile: base, skipExistence: false
    }),
    (e) => e.code === 'reparse_point'
  );

  assert.ok(fs.existsSync(path.join(real, 'keep.txt')), 'target must be untouched');
  fs.rmSync(base, { recursive: true, force: true });
});

test('removeProfile deletes a real directory tree', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-rm-'));
  const root = path.join(base, 'ClaudeProfiles');
  const dir = path.join(root, 'victim');
  fs.mkdirSync(path.join(dir, 'nested'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'nested', 'f.txt'), 'x');

  await del.removeProfile({
    account: { id: 'v', label: 'Victim', kind: 'managed', dir, createdAt: 'x' },
    runningDirs: [], confirmLabel: 'Victim', unlockOutsideRoot: false,
    profilesRoot: root, userProfile: base, skipExistence: false
  });

  assert.ok(!fs.existsSync(dir));
  assert.ok(fs.existsSync(root), 'the managed root itself must survive');
  fs.rmSync(base, { recursive: true, force: true });
});

test('removeProfile refuses to run when a guard fails', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-rm2-'));
  const root = path.join(base, 'ClaudeProfiles');
  const dir = path.join(root, 'safe');
  fs.mkdirSync(dir, { recursive: true });

  await assert.rejects(() => del.removeProfile({
    account: { id: 's', label: 'Safe', kind: 'managed', dir, createdAt: 'x' },
    runningDirs: [], confirmLabel: 'WRONG', unlockOutsideRoot: false,
    profilesRoot: root, userProfile: base, skipExistence: false
  }), (e) => e.code === 'label_mismatch');

  assert.ok(fs.existsSync(dir), 'nothing may be deleted when a guard fails');
  fs.rmSync(base, { recursive: true, force: true });
});
