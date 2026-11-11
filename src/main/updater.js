'use strict';
// In-app updates from GitHub Releases.
//
// Checks once per launch; downloads and installs only on a click. The
// installer is electron-builder's own NSIS installer: with /S it installs
// silently, and with --force-run it starts the app again afterwards
// (app-builder-lib/templates/nsis/installSection.nsh). --updated is what
// electron-builder's own updater passes, so user data is never touched.
//
// Everything with side effects is injected, so this tests without Electron.

const path = require('node:path');
const F = require('./update-feed.js');

const INSTALL_ARGS = Object.freeze(['/S', '--updated', '--force-run']);
const BUSY = ['checking', 'downloading', 'installing'];

function createUpdater({
  fetchText, fetchJson, download, spawn, quit, openExternal,
  currentVersion, mode, repo, tmpDir
}) {
  const urls = F.feedUrls(repo);
  let state = { state: 'idle', current: currentVersion, mode };
  let latest = null; // the parsed latest.yml, once a newer version is known

  const set = (patch) => { state = { current: currentVersion, mode, ...patch }; };
  const status = () => ({ ...state });

  async function check() {
    if (BUSY.includes(state.state)) return status();
    set({ state: 'checking' });

    let text;
    try {
      text = await fetchText(urls.latestYml);
    } catch (e) {
      latest = null;
      if (e && e.code === 'not_found') set({ state: 'current', note: 'No release is published yet.' });
      else set({ state: 'check-failed', reason: (e && e.message) || 'The check failed.' });
      return status();
    }

    const info = F.parseLatestYml(text);
    if (!info || !F.safeAssetName(info.path)) {
      latest = null;
      set({ state: 'check-failed', reason: 'The latest release has no valid update file.' });
      return status();
    }
    if (!F.isNewer(info.version, currentVersion)) {
      latest = null;
      set({ state: 'current' });
      return status();
    }
    latest = info;
    set({ state: 'available', latest: info.version });
    return status();
  }

  async function install() {
    if (!latest || (state.state !== 'available' && state.state !== 'failed')) return status();
    // Installing would replace the installed copy, not the code being run.
    if (mode === 'source') return status();
    // A running portable executable cannot replace itself.
    if (mode === 'portable') {
      openExternal(urls.releasePage(latest.version));
      return status();
    }

    const target = latest;
    const file = path.join(tmpDir, target.path);
    set({ state: 'downloading', latest: target.version, progress: 0 });
    try {
      await download(urls.asset(target.version, target.path), file, {
        sha512: target.sha512,
        size: target.size,
        onProgress: (p) => {
          if (state.state === 'downloading') state = { ...state, progress: p };
        }
      });
    } catch (e) {
      set({ state: 'failed', latest: target.version, reason: (e && e.message) || 'The download failed.' });
      return status();
    }

    set({ state: 'installing', latest: target.version });
    try {
      const child = spawn(file, INSTALL_ARGS, { detached: true, stdio: 'ignore', windowsHide: false });
      await new Promise((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', reject);
      });
      child.unref();
    } catch (e) {
      set({ state: 'failed', latest: target.version, reason: `The installer would not start: ${e && e.message}` });
      return status();
    }
    quit();
    return status();
  }

  async function changelog() {
    try {
      return { ok: true, releases: F.parseReleases(await fetchJson(urls.releasesApi), currentVersion) };
    } catch (e) {
      return { ok: false, reason: (e && e.message) || 'The release notes could not be loaded.' };
    }
  }

  function openReleasesPage() {
    openExternal(urls.releasesPage);
    return { ok: true };
  }

  return { check, install, status, changelog, openReleasesPage };
}

module.exports = { createUpdater, INSTALL_ARGS };
