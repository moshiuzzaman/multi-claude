'use strict';
// Folder naming and sizing for profile directories.

const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/;

/** A label turned into a safe, short folder name. Never empty, never reserved. */
function slugify(label) {
  let s = String(label == null ? '' : label)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  if (s === '') s = 'account';
  if (RESERVED.test(s)) s = s + '-profile';
  return s;
}

function uniqueSlug(base, taken) {
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

function newId() {
  return crypto.randomBytes(4).toString('hex');
}

/**
 * Total bytes under dir. A missing directory is 0 rather than an error, and
 * entries that vanish mid-walk are skipped — a live Claude profile is being
 * written to while we measure it.
 */
async function dirSize(dir) {
  let total = 0;
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    try {
      if (e.isSymbolicLink()) continue; // never follow a reparse point
      if (e.isDirectory()) total += await dirSize(full);
      else if (e.isFile()) total += (await fsp.stat(full)).size;
    } catch {
      // file disappeared or is locked; it does not change the picture materially
    }
  }
  return total;
}

module.exports = { slugify, uniqueSlug, newId, dirSize };
