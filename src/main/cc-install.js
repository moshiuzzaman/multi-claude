'use strict';
// Downloading Anthropic's official Claude Code when the PC has none.
//
// Claude Code reports the usage limits, and a PC with only Claude Desktop may
// not have it. This fetches it the way Anthropic's own install script does
// (https://claude.ai/install.ps1): read the newest version number, read that
// version's manifest for the checksum, download the binary, verify it. The
// binary is not redistributed with Multi-Claude; it comes from Anthropic's
// server, on a click, and is kept in Multi-Claude's own folder.
//
// Unlike that script, `claude install` is never run: it edits the user's PATH
// and adds a launcher to their home folder, and Multi-Claude needs neither.
//
// Everything with side effects is injected, so this tests without a network.

const path = require('node:path');

const BASE_URL = 'https://downloads.claude.ai/claude-code-releases';
// The version becomes part of a URL and a folder name, so it must be exactly this.
const VERSION = /^\d+\.\d+\.\d+$/;
const BUSY = ['checking', 'downloading'];

/** The checksum and size for one platform, or null when the manifest is unusable. */
function parseManifest(manifest, platform) {
  const p = manifest && manifest.platforms && manifest.platforms[platform];
  if (!p || typeof p !== 'object') return null;
  const sha256 = String(p.checksum || '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sha256)) return null;
  if (!Number.isInteger(p.size) || p.size <= 0) return null;
  return { sha256, size: p.size };
}

function createCcInstaller({ fetchText, fetchJson, download, rename, remove, chmod = null, rootDir, arch, os = 'win32' }) {
  // Anthropic's manifest names: win32-x64, win32-arm64, darwin-x64, darwin-arm64.
  const platform = `${os === 'darwin' ? 'darwin' : 'win32'}-${arch === 'arm64' ? 'arm64' : 'x64'}`;
  const binary = os === 'darwin' ? 'claude' : 'claude.exe';
  let state = { state: 'idle' };
  const status = () => ({ ...state });
  const failed = (e, fallback) => {
    state = { state: 'failed', reason: (e && e.message) || fallback };
    return status();
  };

  async function start() {
    if (BUSY.includes(state.state)) return status();
    state = { state: 'checking' };

    let version;
    let info;
    try {
      version = String(await fetchText(`${BASE_URL}/latest`)).trim();
      if (!VERSION.test(version)) {
        return failed(null, 'Anthropic\'s download service did not answer with a version. It may be unreachable from here.');
      }
      info = parseManifest(await fetchJson(`${BASE_URL}/${version}/manifest.json`), platform);
      if (!info) return failed(null, `Claude Code ${version} has no download for this kind of PC.`);
    } catch (e) {
      return failed(e, 'Could not reach Anthropic\'s download service.');
    }

    const dir = path.join(rootDir, version);
    const exe = path.join(dir, binary);
    // Downloaded under another name: a half-finished file must never be
    // mistaken for a working Claude Code if the app is closed midway.
    const part = `${exe}.download`;
    state = { state: 'downloading', version, size: info.size, progress: 0 };
    try {
      await download(`${BASE_URL}/${version}/${platform}/${binary}`, part, {
        sha256: info.sha256,
        size: info.size,
        onProgress: (p) => {
          if (state.state === 'downloading') state = { ...state, progress: p };
        }
      });
      await rename(part, exe);
      // A Mac binary has to be marked runnable.
      if (chmod) await chmod(exe, 0o755);
    } catch (e) {
      try { await remove(part); } catch { /* best effort */ }
      return failed(e, 'The download failed.');
    }

    state = { state: 'done', version };
    return status();
  }

  return { start, status };
}

module.exports = { createCcInstaller, parseManifest, BASE_URL };
