'use strict';
// Finds claude.exe and the default profile directory.
//
// The Store (MSIX) build lives under a versioned path that changes on every
// update, so nothing here may be cached permanently — resolve() re-runs the
// lookup whenever the remembered path stops existing.

const path = require('node:path');

function createLocator({ fsImpl, env, runPowerShell }) {
  const exists = (p) => {
    try { return fsImpl.existsSync(p); } catch { return false; }
  };

  // Classic installer: %LOCALAPPDATA%\AnthropicClaude\app-<version>\claude.exe.
  // Descending name sort matches the existing .bat's `dir /o-n`.
  function fromAppFolders() {
    const base = path.join(env.LOCALAPPDATA || '', 'AnthropicClaude');
    let names;
    try { names = fsImpl.readdirSync(base); } catch { return null; }
    const apps = names.filter((n) => String(n).toLowerCase().startsWith('app-')).sort().reverse();
    for (const n of apps) {
      const exe = path.join(base, n, 'claude.exe');
      if (exists(exe)) return exe;
    }
    return null;
  }

  async function fromAppx() {
    let out;
    try {
      out = await runPowerShell('(Get-AppxPackage *Claude*).InstallLocation');
    } catch {
      return null;
    }
    for (const line of String(out).split(/\r?\n/)) {
      const dir = line.trim();
      if (!dir) continue;
      const exe = path.join(dir, 'app', 'claude.exe');
      if (exists(exe)) return exe;
    }
    return null;
  }

  return {
    async resolve(cachedPath) {
      if (cachedPath && exists(cachedPath)) return cachedPath;
      const fromApps = fromAppFolders();
      if (fromApps) return fromApps;
      const flat = path.join(env.LOCALAPPDATA || '', 'AnthropicClaude', 'claude.exe');
      if (exists(flat)) return flat;
      return await fromAppx();
    }
  };
}

/**
 * Where Claude keeps its own profile when launched with no --user-data-dir.
 * The Store build uses %LOCALAPPDATA%\Claude-Data\<package family name, lowercased>;
 * the classic installer uses %APPDATA%\Claude.
 */
async function resolveDefaultProfileDir({ fsImpl, env, runPowerShell }) {
  try {
    const out = await runPowerShell('(Get-AppxPackage *Claude*).PackageFamilyName');
    const family = String(out).split(/\r?\n/).map((s) => s.trim()).find(Boolean);
    if (family) {
      const dir = path.join(env.LOCALAPPDATA || '', 'Claude-Data', family.toLowerCase());
      try {
        if (fsImpl.existsSync(dir)) return dir;
      } catch { /* fall through */ }
    }
  } catch { /* no packaged install; fall through */ }
  return path.join(env.APPDATA || '', 'Claude');
}

module.exports = { createLocator, resolveDefaultProfileDir };
