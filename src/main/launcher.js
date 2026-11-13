'use strict';
// Starts Claude Desktop against a given profile directory.
//
// This is the whole mechanism: Chromium's stock --user-data-dir flag. Nothing
// about Claude Desktop is modified, patched or inspected.
//
// Showing a running account uses the same mechanism. Claude holds a
// single-instance lock per data folder, so starting it again for a folder that
// is already open hands the request to the running copy, which brings its own
// window forward (from the tray or minimised) and the new process exits. Show
// itself doesn't touch the window; the only thing Multi-Claude ever sets on
// Claude's windows is their taskbar properties (see taskbar.js).

function buildArgs(account) {
  // The default account is whatever Claude uses on its own, so it gets no flag.
  return account.kind === 'default' ? [] : [`--user-data-dir=${account.dir}`];
}

/**
 * The Store build's app id ("<family>!Claude"), read from the versioned
 * install path ...\WindowsApps\Claude_<version>_<arch>__<publisher id>\app\claude.exe,
 * or null for any other install. The family is the name plus the publisher id.
 */
function storeAppId(exePath) {
  const m = /[\\/]WindowsApps[\\/]([^\\/_]+)_[^\\/]*_([a-z0-9]{13})[\\/]/i.exec(String(exePath || ''));
  return m ? `${m[1]}_${m[2]}!Claude` : null;
}

function createLauncher({ spawnImpl }) {
  function launch(exePath, account) {
    const child = spawnImpl(exePath, buildArgs(account), {
      detached: true,
      stdio: 'ignore',
      windowsHide: false
    });
    // Detach fully so Multi-Claude can quit while Claude keeps running.
    child.unref();
  }

  return {
    launch,

    /**
     * Bring a running account's window to the front. The Store build's
     * default Claude runs inside its package, so it is reached the way the
     * Start menu reaches it; every other account is simply started again.
     */
    show(exePath, account) {
      const appId = account.kind === 'default' ? storeAppId(exePath) : null;
      if (!appId) return launch(exePath, account);
      const child = spawnImpl('explorer.exe', [`shell:AppsFolder\\${appId}`], {
        detached: true,
        stdio: 'ignore'
      });
      child.unref();
    }
  };
}

module.exports = { buildArgs, storeAppId, createLauncher };
