'use strict';
const { execFile } = require('node:child_process');

/**
 * Runs a PowerShell command and resolves with its stdout.
 * -NonInteractive and windowsHide keep it from ever flashing a console or
 * blocking on a prompt. The timeout stops a wedged call from stalling the UI.
 */
function runPowerShell(command) {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
      { windowsHide: true, maxBuffer: 4 * 1024 * 1024, timeout: 15000 },
      (e, stdout) => (e ? reject(e) : resolve(stdout))
    );
  });
}

module.exports = { runPowerShell };
