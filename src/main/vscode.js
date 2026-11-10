'use strict';
// Opening VS Code against one account's Claude Code config dir.
//
// VS Code is single-instance per user-data-dir: launching it while an instance
// is already running hands the request to that process, and the new window
// inherits the *original* environment. Measured on 2026-11-10, a second launch
// created no new process at all. So an account cannot be selected with
// CLAUDE_CONFIG_DIR alone — every account needs its own --user-data-dir, which
// makes any handoff land on that account's own instance.
//
// Extensions are unaffected: --extensions-dir is a separate flag defaulting to
// ~/.vscode/extensions, so the Claude Code extension stays shared.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

// The setting that overrides inherited environment. If the user's own
// settings.json sets it, copying that file would silently repoint the account.
const OVERRIDE_KEY = 'claudeCode.environmentVariables';

/** Every place a stock VS Code is commonly installed, per-user install first. */
function candidateEditors(env, fsImpl = fs) {
  const out = [];
  if (env.LOCALAPPDATA) {
    out.push(path.join(env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe'));
  }
  if (env.ProgramFiles) {
    out.push(path.join(env.ProgramFiles, 'Microsoft VS Code', 'Code.exe'));
  }
  return out.filter((p) => { try { return fsImpl.existsSync(p); } catch { return false; } });
}

function findVsCode(env = process.env, fsImpl = fs) {
  return candidateEditors(env, fsImpl)[0] || null;
}

// settings.json first: if it carries OVERRIDE_KEY the whole seed is abandoned,
// so nothing half-copied is left behind.
const SEEDED_FILES = ['settings.json', 'keybindings.json'];

/**
 * Copy the user's own VS Code settings into an account's profile.
 *
 * A source file that is not there is not an error — a stock VS Code has no
 * keybindings.json until you make one.
 */
async function seedProfile(profileDir, sourceUserDir, fspImpl = fsp) {
  const targetUser = path.join(profileDir, 'User');
  await fspImpl.mkdir(targetUser, { recursive: true });

  const copied = [];
  for (const name of SEEDED_FILES) {
    let text;
    try {
      text = await fspImpl.readFile(path.join(sourceUserDir, name), 'utf8');
    } catch (e) {
      // Not being there is not an error: a stock VS Code has no
      // keybindings.json until you make one. Anything else means the file
      // exists and could not be read (EACCES, EBUSY, EISDIR), so abandon the
      // whole seed rather than leave a half-copied profile behind.
      if (e && e.code === 'ENOENT') continue;
      return { copied: [], skipped: 'unreadable' };
    }
    // Reading the file is enough; it is JSONC and must not be parsed.
    if (name === 'settings.json' && text.includes(OVERRIDE_KEY)) {
      return { copied: [], skipped: 'override' };
    }
    await fspImpl.writeFile(path.join(targetUser, name), text);
    copied.push(name);
  }
  return { copied, skipped: null };
}

module.exports = { OVERRIDE_KEY, SEEDED_FILES, candidateEditors, findVsCode, seedProfile };
