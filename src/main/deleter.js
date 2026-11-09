'use strict';
// Permanent deletion of a profile folder, behind an ordered set of guards.
//
// This is the highest-risk module in the application: it is the only code that
// removes anything from disk. Every guard failure throws DeleteBlocked with a
// stable .code, and nothing is removed unless every guard passes.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const P = require('./paths.js');

class DeleteBlocked extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DeleteBlocked';
    this.code = code;
  }
}

// "C:\Users\Bob\Claude_Work" is 3 segments and must stay deletable;
// "C:\Users\Bob" is 2 and must not.
const MIN_SEGMENTS = 3;

/**
 * Resolves if the account may be deleted, otherwise throws DeleteBlocked.
 *
 * skipExistence exists solely so the guard tests can use fictional paths.
 * Production callers never pass it.
 */
async function checkDeletable({
  account, runningDirs, confirmLabel, unlockOutsideRoot,
  profilesRoot, userProfile, skipExistence = false
}) {
  if (account.kind === 'default') {
    throw new DeleteBlocked('default_account',
      'The default account cannot be deleted from here.');
  }

  const dir = P.normalizeDir(account.dir);
  if (dir === null) {
    throw new DeleteBlocked('missing', 'This account has no valid folder.');
  }

  const running = new Set((runningDirs || []).map(P.normalizeDir).filter(Boolean));
  if (running.has(dir)) {
    throw new DeleteBlocked('running',
      'This account is open. Close its Claude window first.');
  }

  if (!skipExistence) {
    if (!fs.existsSync(account.dir)) {
      throw new DeleteBlocked('missing', 'That folder no longer exists.');
    }
    if (await P.isReparsePoint(account.dir)) {
      throw new DeleteBlocked('reparse_point',
        'That folder is a junction or symbolic link and will not be deleted.');
    }
  }

  if (P.isDriveRoot(dir)) {
    throw new DeleteBlocked('drive_root', 'Refusing to delete a drive root.');
  }
  if (P.samePath(dir, userProfile)) {
    throw new DeleteBlocked('user_profile_root', 'Refusing to delete your user folder.');
  }
  if (P.segmentCount(dir) < MIN_SEGMENTS) {
    throw new DeleteBlocked('too_shallow', 'That path is too close to the drive root.');
  }

  if (!P.isInside(dir, profilesRoot)) {
    const allowed = account.kind === 'imported' && unlockOutsideRoot === true;
    if (!allowed) {
      throw new DeleteBlocked('outside_root',
        'That folder is outside the Multi-Claude profiles folder. ' +
        'Tick the unlock box to delete it anyway.');
    }
  }

  if (confirmLabel !== account.label) {
    throw new DeleteBlocked('label_mismatch', 'The name you typed does not match.');
  }
}

async function removeProfile(opts) {
  await checkDeletable(opts);

  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await fsp.rm(opts.account.dir, { recursive: true, force: true });
      return;
    } catch (e) {
      lastErr = e;
      if (e.code !== 'EBUSY' && e.code !== 'EPERM' && e.code !== 'ENOTEMPTY') break;
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  const e = new DeleteBlocked('partial',
    'The folder could not be fully deleted. Close Claude and try again.');
  e.cause = lastErr;
  throw e;
}

module.exports = { DeleteBlocked, checkDeletable, removeProfile, MIN_SEGMENTS };
