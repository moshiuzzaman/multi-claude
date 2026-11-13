'use strict';
// The parts of Multi-Claude that talk to the operating system, picked once at
// start-up. Windows uses the original modules unchanged; a Mac uses mac.js.
// Everything else (accounts, deletion guards, usage, the UI) is shared.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');

/** Run a command and resolve with its stdout. No shell, no window, a timeout. */
function runCmd(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { maxBuffer: 4 * 1024 * 1024, timeout: 15000 }, (e, out) => (e ? reject(e) : resolve(out)));
  });
}

function windowsParts({ env, shell }) {
  const { createLocator, resolveDefaultProfileDir } = require('./claude-locator.js');
  const { createLauncher } = require('./launcher.js');
  const { createScanner } = require('./scanner.js');
  const { createCloser } = require('./closer.js');
  const { runPowerShell } = require('./run-powershell.js');
  return {
    os: 'win32',
    runPowerShell,
    resolveDefaultProfileDir: () => resolveDefaultProfileDir({ fsImpl: fs, env, runPowerShell }),
    locator: createLocator({ fsImpl: fs, env, runPowerShell }),
    launcher: createLauncher({ spawnImpl: spawn }),
    scanner: createScanner({ runPowerShell }),
    closer: createCloser({ runPowerShell }),
    // service.js falls back to its own Windows defaults for these.
    vscode: null,
    ccCandidates: null,
    ccOpenTerminal: null,
    makeShortcut: null,
    iconFormat: 'ico',
    shortcutFileName: null,
    recordStatusLine: true,
    exeLabel: 'claude.exe',
    exeFilter: { name: 'Claude', extensions: ['exe'] },
    shell
  };
}

function macParts({ env, shell }) {
  const mac = require('./mac.js');
  const home = env.HOME || '';
  return {
    os: 'darwin',
    runPowerShell: null,
    resolveDefaultProfileDir: async () => mac.defaultProfileDir(home),
    locator: mac.createMacLocator({ fsImpl: fs, env, run: runCmd }),
    launcher: mac.createMacLauncher({ spawnImpl: spawn }),
    scanner: mac.createMacScanner({ run: runCmd }),
    closer: mac.createMacCloser({
      run: runCmd,
      kill: (pid, sig) => process.kill(pid, sig),
      isAlive: (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } }
    }),
    vscode: mac.createMacVsCode({ env, fsImpl: fs, run: runCmd, spawnImpl: spawn }),
    // Where Claude Code can be on a Mac, and how to open it in Terminal.
    ccCandidates: (e, f, dirs) => mac.ccCandidatePaths(e, f, dirs),
    ccOpenTerminal: (cli, dir, args, opts) => mac.openCcTerminal(cli, dir, args, { ...opts, spawnImpl: spawn }),
    makeShortcut: (opts) => mac.createMacShortcut({
      fsImpl: fs,
      desktopDir: opts.desktopDir,
      exePath: opts.exePath,
      account: opts.account,
      argsPrefix: opts.argsPrefix,
      // The account's own icon, or else the packaged app's icon if it is there.
      iconFile: opts.iconFile || path.join(path.dirname(path.dirname(opts.exePath)), 'Resources', 'icon.icns')
    }),
    iconFormat: 'icns',
    shortcutFileName: (label) => mac.shortcutName(label),
    // The status-line recorder is a PowerShell script.
    recordStatusLine: false,
    exeLabel: 'Claude.app',
    exeFilter: { name: 'Claude', extensions: ['app'] },
    shell,
    chmod: (p, mode) => fsp.chmod(p, mode)
  };
}

/** The OS parts for this machine. */
function platformParts({ platform = process.platform, env = process.env, shell } = {}) {
  if (platform === 'darwin') return macParts({ env, shell });
  return windowsParts({ env, shell });
}

module.exports = { platformParts, runCmd };
