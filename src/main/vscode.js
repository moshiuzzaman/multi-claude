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

module.exports = { OVERRIDE_KEY, candidateEditors, findVsCode };
