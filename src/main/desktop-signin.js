'use strict';
// Is a profile's Claude Desktop window signed in?
//
// Claude Desktop keeps its settings in <profile>/config.json. When it is signed
// in, that file holds its token cache ("oauth:tokenCache…") and the account's
// id; a profile that was never signed in has neither, and Claude records
// "windowSizeWasSignedIn: false" for a signed-out window.
//
// Only the names of the settings are looked at, plus that one true/false flag.
// No value of any other setting is read out, kept or passed on, and the token
// cache itself is never touched.

const fs = require('node:fs');
const path = require('node:path');

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

module.exports = { readDesktopSignIn };
