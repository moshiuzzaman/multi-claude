'use strict';
// Persistence for accounts.json. Writes are atomic; a file we cannot parse or
// validate is renamed aside rather than overwritten, so a bad config never
// silently loses the user's account list.

const fsp = require('node:fs/promises');
const path = require('node:path');

const SCHEMA_VERSION = 1;
const KINDS = new Set(['default', 'imported', 'managed']);

function fail(msg) {
  const e = new Error(msg);
  e.code = 'INVALID_SCHEMA';
  throw e;
}

function emptyStore() {
  return { version: SCHEMA_VERSION, exePath: null, accounts: [] };
}

function validate(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) fail('not an object');
  if (raw.version !== SCHEMA_VERSION) fail('bad version');
  if (!(raw.exePath === null || typeof raw.exePath === 'string')) fail('bad exePath');
  if (!Array.isArray(raw.accounts)) fail('accounts is not an array');

  const seen = new Set();
  for (const a of raw.accounts) {
    if (a === null || typeof a !== 'object' || Array.isArray(a)) fail('bad account');
    for (const k of ['id', 'label', 'kind', 'dir', 'createdAt']) {
      if (typeof a[k] !== 'string' || a[k] === '') fail(`bad account.${k}`);
    }
    if (!KINDS.has(a.kind)) fail('bad account.kind');
    // account.color is optional and not checked here: the schema version stays
    // at 1 so an older Multi-Claude can still read the file, and a bad colour
    // must never set the whole account list aside. The service replaces any
    // colour that isn't in the palette (see colors.js).
    if (seen.has(a.id)) fail('duplicate account id');
    seen.add(a.id);
  }
  return raw;
}

async function load(file) {
  let text;
  try {
    text = await fsp.readFile(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return { data: emptyStore(), recoveredFrom: null };
    throw e;
  }

  try {
    return { data: validate(JSON.parse(text)), recoveredFrom: null };
  } catch {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const quarantine = file.replace(/\.json$/, '') + `.corrupt-${stamp}.json`;
    await fsp.rename(file, quarantine);
    return { data: emptyStore(), recoveredFrom: quarantine };
  }
}

async function save(file, data) {
  validate(data);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fsp.rename(tmp, file);
}

module.exports = { SCHEMA_VERSION, KINDS, emptyStore, validate, load, save };
