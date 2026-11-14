'use strict';
// Is a profile's Claude Desktop window signed in?
//
// Claude Desktop keeps its settings in <profile>/config.json. When it is signed
// in, that file holds its token cache ("oauth:tokenCache…") and the account's
// id; a profile that was never signed in has neither, and Claude records
// "windowSizeWasSignedIn: false" for a signed-out window.
//
// Only the names of the settings are looked at, plus that one true/false flag
// and, for the same-account check, the account id (readDesktopAccountKey).
// No value of any other setting is read out, kept or passed on, and the token
// cache itself is never touched.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * true when the profile is signed in, false when it plainly is not, and null
 * when it can't be told (no folder, or a settings file Claude hasn't written
 * yet or that can't be read).
 */
function readDesktopSignIn(dir, fsImpl = fs) {
  if (!dir) return null;
  let text;
  try {
    text = fsImpl.readFileSync(path.join(dir, 'config.json'), 'utf8');
  } catch (e) {
    // A brand-new profile has no settings until Claude first opens it.
    return e && e.code === 'ENOENT' && fsImpl.existsSync(dir) ? false : null;
  }
  let cfg;
  try { cfg = JSON.parse(text); } catch { return null; }
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return null;

  const keys = Object.keys(cfg);
  const hasTokens = keys.some((k) => k.startsWith('oauth:tokenCache'));
  const hasAccount = keys.includes('lastKnownAccountUuid');
  if (cfg.windowSizeWasSignedIn === false && !hasTokens) return false;
  return hasTokens && hasAccount;
}

/**
 * A fingerprint of the Claude account this profile is signed in to, or null.
 *
 * Claude records the account's id in config.json as lastKnownAccountUuid (an
 * id, not a token). Only a one-way hash of it leaves this function: enough to
 * tell whether two profiles, or one profile over time, use the same account,
 * and nothing that names the account. The id itself is never kept or shown.
 */
function readDesktopAccountKey(dir, fsImpl = fs) {
  if (!dir) return null;
  let cfg;
  try { cfg = JSON.parse(fsImpl.readFileSync(path.join(dir, 'config.json'), 'utf8')); } catch { return null; }
  const id = cfg && typeof cfg === 'object' ? cfg.lastKnownAccountUuid : null;
  if (typeof id !== 'string' || !UUID_RE.test(id)) return null;
  return crypto.createHash('sha256').update(`multi-claude:${id.toLowerCase()}`).digest('hex').slice(0, 24);
}

module.exports = { readDesktopSignIn, readDesktopAccountKey };
