'use strict';
// Quitting a running profile.
//
// Finding the right process is half the problem. A Claude instance is a tree of
// claude.exe processes, and --user-data-dir is not on all of them: an instance
// started normally (the default profile) has no flag on its main process, only
// on its children. So we match on any process carrying the profile's directory,
// then walk up through claude.exe parents to the root of that instance's tree.
//
// The other half: Claude Desktop lives in the system tray. Closing its window
// only hides it, and a graceful `taskkill` (no /F) cannot make it quit — we
// measured both on a throwaway profile; the process survived each time and
// only `/T /F` ended it. So quitting is a force-kill of that one instance's
// tree. That stops anything running inside it, which is why the UI asks for
// confirmation first and why this must never be called implicitly.

const { normalizeDir } = require('./paths.js');

const PS_PROCESS_LIST = [
  "Get-CimInstance Win32_Process -Filter \"Name='claude.exe'\" |",
  'ForEach-Object {',
  '  $d = \'\';',
  "  if ($_.CommandLine -match '--user-data-dir=(?:\"([^\"]+)\"|([^\\s]+))') {",
  '    $d = if ($Matches[1]) { $Matches[1] } else { $Matches[2] }',
  '  }',
  '  "$($_.ProcessId)|$($_.ParentProcessId)|$d"',
  '}'
].join(' ');

/** "1234|567|C:\\dir" lines -> [{ pid, ppid, dir }] with dir normalised. */
function parseProcessList(stdout) {
  const out = [];
  for (const line of String(stdout).split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const parts = t.split('|');
    if (parts.length < 2) continue;
    const pid = Number(parts[0]);
    const ppid = Number(parts[1]);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    out.push({
      pid,
      ppid: Number.isInteger(ppid) ? ppid : 0,
      dir: normalizeDir(parts.slice(2).join('|')) // a path may contain '|'? be safe
    });
  }
  return out;
}

/**
 * Root pids of every claude.exe instance tree using `targetDir`.
 *
 * Walking stops as soon as the parent is not itself a claude.exe we know
 * about, so this can never climb out of the instance and into, say, explorer.
 */
function findRootPids(processes, targetDir, normalize = normalizeDir) {
  const target = normalize(targetDir);
  if (target === null) return [];

  const byPid = new Map(processes.map((p) => [p.pid, p]));
  const roots = new Set();

  for (const p of processes) {
    if (p.dir !== target) continue;

    let cur = p;
    const seen = new Set([cur.pid]); // a malformed cycle must not hang us
    while (byPid.has(cur.ppid) && !seen.has(cur.ppid)) {
      seen.add(cur.ppid);
      cur = byPid.get(cur.ppid);
    }
    roots.add(cur.pid);
  }

  return [...roots];
}

function createCloser({ runPowerShell }) {
  return {
    /**
     * Force-quit every claude.exe tree using `dir`.
     * @returns {{ closed: number, pids: number[] }}
     * closed:0 means nothing was running for that profile.
     */
    async close(dir) {
      const processes = parseProcessList(await runPowerShell(PS_PROCESS_LIST));
      const roots = findRootPids(processes, dir);
      if (roots.length === 0) return { closed: 0, pids: [] };

      // /T takes the whole tree with its root; /F because a graceful request
      // cannot make a tray-resident Claude quit. Only roots are named, so
      // nothing outside this profile's instance is ever targeted.
      const cmd = roots.map((pid) => `taskkill /PID ${pid} /T /F`).join('; ');
      try {
        await runPowerShell(cmd);
      } catch {
        // taskkill exits non-zero when a process has already gone away between
        // the scan and the kill, which is a normal race, not a failure.
      }
      return { closed: roots.length, pids: roots };
    }
  };
}

module.exports = { PS_PROCESS_LIST, parseProcessList, findRootPids, createCloser };
