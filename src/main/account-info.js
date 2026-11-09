'use strict';
// Account identity, read from Claude Code's own config.
//
// IMPORTANT, and surfaced in the UI: this describes ONE account — whichever
// Claude Code is authenticated as — because ~/.claude.json lives in the home
// directory and is shared by every Claude Desktop profile. There is no
// per-profile equivalent: a profile's identity lives inside its Chromium
// credential storage, which this app does not read.
//
// Only the descriptive fields below are returned. Tokens, keys and anything
// from .credentials.json are never touched.

const fsp = require('node:fs/promises');

const SAFE_FIELDS = [
  'emailAddress',
  'displayName',
  'fullName',
  'organizationName',
  'organizationType',
  'organizationRole',
  'workspaceRole',
  'seatTier',
  'billingType',
  'organizationRateLimitTier',
  'userRateLimitTier',
  'hasExtraUsageEnabled',
  'accountCreatedAt',
  'subscriptionCreatedAt'
];

function pickSafe(oauthAccount) {
  const out = {};
  for (const k of SAFE_FIELDS) {
    const v = oauthAccount[k];
    if (v === undefined || v === null) continue;
    // Defensive: only ever carry primitives out of this file.
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = v;
  }
  return out;
}

/**
 * @returns {{ available: boolean, reason?: string, account?: object }}
 */
async function readAccountInfo(configFile) {
  let raw;
  try {
    raw = await fsp.readFile(configFile, 'utf8');
  } catch (e) {
    return {
      available: false,
      reason: e.code === 'ENOENT'
        ? 'Claude Code config not found on this machine.'
        : 'Could not read the Claude Code config.'
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { available: false, reason: 'Claude Code config is not readable JSON.' };
  }

  const oauth = parsed && parsed.oauthAccount;
  if (!oauth || typeof oauth !== 'object') {
    return { available: false, reason: 'No account is signed in to Claude Code here.' };
  }

  return { available: true, account: pickSafe(oauth) };
}

module.exports = { readAccountInfo, SAFE_FIELDS, pickSafe };
