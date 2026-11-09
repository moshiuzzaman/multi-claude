'use strict';
// Per-profile disk usage, split into categories the user can act on.
//
// The interesting finding this exists to surface: each profile carries its own
// copy of the bundled Claude Code runtime, which on this machine is 323 MB in
// one profile and 608 MB in another — far more than the actual profile data.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { dirSize } = require('./profiles.js');
const P = require('./paths.js');

// Chromium regenerates every one of these on next launch.
const CACHE_DIRS = [
  'Cache',
  'Code Cache',
  'GPUCache',
  'GPUPersistentCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'GrShaderCache',
  'ShaderCache',
  'Shared Dictionary',
  'component_crx_cache',
  'extensions_crx_cache'
];

const RUNTIME_DIRS = ['claude-code', 'claude-code-spare', 'claude-code-vm'];
const SESSION_DIRS = ['claude-code-sessions', 'local-agent-mode-sessions'];

// Sandbox VM images. These get their own category because they dominate: on
// this machine vm_bundles alone is 8.8 GB of a 10 GB profile. Folding them into
// "profile data" would tell the user their login data weighs 8.8 GB.
const VM_DIRS = ['vm_bundles'];

function categoryOf(name) {
  if (CACHE_DIRS.includes(name)) return 'cache';
  if (VM_DIRS.includes(name)) return 'vm';
  if (RUNTIME_DIRS.includes(name)) return 'runtime';
  if (SESSION_DIRS.includes(name)) return 'sessions';
  return 'data';
}

/** Byte totals per category for one profile directory. */
async function breakdown(dir) {
  const result = { total: 0, cache: 0, vm: 0, runtime: 0, sessions: 0, data: 0, exists: false };

  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
    result.exists = true;
  } catch {
    return result;
  }

  for (const e of entries) {
    const full = path.join(dir, e.name);
    let bytes = 0;
    try {
      if (e.isSymbolicLink()) continue;
      bytes = e.isDirectory() ? await dirSize(full) : (await fsp.stat(full)).size;
    } catch {
      continue;
    }
    result[categoryOf(e.name)] += bytes;
    result.total += bytes;
  }

  return result;
}

/**
 * Delete only the regenerable cache directories inside a profile.
 *
 * Guarded like deletion is: refuses a running profile, never touches anything
 * outside the named cache folders, and never removes the profile itself.
 * Returns the number of bytes freed.
 */
async function purgeCaches({ account, runningDirs }) {
  const dir = P.normalizeDir(account.dir);
  if (dir === null) {
    const e = new Error('This account has no valid folder.');
    e.code = 'missing';
    throw e;
  }

  const running = new Set((runningDirs || []).map(P.normalizeDir).filter(Boolean));
  if (running.has(dir)) {
    const e = new Error('This account is open. Close its Claude window first.');
    e.code = 'running';
    throw e;
  }

  if (!fs.existsSync(account.dir)) {
    const e = new Error('That folder no longer exists.');
    e.code = 'missing';
    throw e;
  }

  let freed = 0;
  for (const name of CACHE_DIRS) {
    const target = path.join(account.dir, name);

    // Belt and braces: the path must still sit directly inside the profile.
    if (!P.isInside(target, account.dir)) continue;
    if (!fs.existsSync(target)) continue;
    try {
      if (await P.isReparsePoint(target)) continue;
    } catch {
      continue;
    }

    const before = await dirSize(target);
    try {
      await fsp.rm(target, { recursive: true, force: true });
      freed += before;
    } catch {
      // a locked cache file is not worth failing the whole purge over
    }
  }

  return { freed };
}

module.exports = { breakdown, purgeCaches, categoryOf, CACHE_DIRS, RUNTIME_DIRS, SESSION_DIRS, VM_DIRS };
