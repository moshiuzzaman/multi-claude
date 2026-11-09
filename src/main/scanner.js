'use strict';
// Detects which Claude profiles are currently open.
//
// The extraction happens inside PowerShell on purpose: a single Claude
// renderer process can carry a command line well past 20 KB, and we only ever
// need the one --user-data-dir value out of it. Doing the match on the
// PowerShell side keeps those blobs from crossing the process boundary.
//
// This sees every running instance, including ones started from a .bat file or
// a Start Menu shortcut, not only the ones Multi-Claude launched itself.

const { normalizeDir } = require('./paths.js');

const PS_COMMAND = [
  "Get-CimInstance Win32_Process -Filter \"Name='claude.exe'\" |",
  'ForEach-Object {',
  "  if ($_.CommandLine -match '--user-data-dir=(?:\"([^\"]+)\"|([^\\s]+))') {",
  '    if ($Matches[1]) { $Matches[1] } else { $Matches[2] }',
  '  }',
  '} | Sort-Object -Unique'
].join(' ');

function parseScanOutput(stdout) {
  const seen = new Set();
  for (const line of String(stdout).split(/\r?\n/)) {
    const n = normalizeDir(line);
    if (n !== null) seen.add(n);
  }
  return [...seen];
}

function createScanner({ runPowerShell }) {
  return {
    /**
     * ok:false means the scan itself failed. Callers must render that as
     * "unknown" rather than "not running" — treating a failed scan as
     * "not running" would let the delete guard through on a live profile.
     */
    async scan() {
      try {
        return { dirs: parseScanOutput(await runPowerShell(PS_COMMAND)), ok: true };
      } catch {
        return { dirs: [], ok: false };
      }
    }
  };
}

module.exports = { PS_COMMAND, parseScanOutput, createScanner };
