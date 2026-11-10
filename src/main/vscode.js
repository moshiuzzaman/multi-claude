'use strict';
// Finding and starting VS Code.
//
// v1 of this feature gave every account its own --user-data-dir, because VS
// Code is single-instance per user-data-dir and a plain launch hands off to a
// running instance that keeps its own environment. That worked and was wrong:
// it produced a second window and a second profile, so every extension was
// signed out per account.
//
// The account now comes from the `claudeCode.environmentVariables` setting
// instead (see vscode-settings.js), which the extension watches and applies in
// place. So this module only has to find VS Code, say whether it is running,
// and start it when it is not.

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

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

/**
 * Start VS Code.
 *
 * No arguments: the account comes from the settings block, so any start picks
 * up the right one, and passing no folder lets VS Code restore its own session.
 */
function launch(exePath, spawnImpl = spawn) {
  const child = spawnImpl(exePath, [], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false
  });
  // Detach fully so Multi-Claude can quit while VS Code keeps running.
  child.unref();
}

const PS_RUNNING = "if (Get-Process Code -ErrorAction SilentlyContinue) { 'yes' } else { 'no' }";

function parseRunning(stdout) {
  return String(stdout).trim().split(/\r?\n/).includes('yes');
}

/**
 * Is a VS Code already open?
 *
 * Asked so an open editor is never given a second window — the whole point of
 * switching in place. A probe that cannot run answers "no": starting one extra
 * window is a far smaller failure than refusing to open VS Code at all.
 */
function createVsCodeProbe({ runPowerShell }) {
  return {
    async isRunning() {
      try {
        return parseRunning(await runPowerShell(PS_RUNNING));
      } catch {
        return false;
      }
    }
  };
}

module.exports = { candidateEditors, findVsCode, launch, PS_RUNNING, parseRunning, createVsCodeProbe };
