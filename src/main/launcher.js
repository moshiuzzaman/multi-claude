'use strict';
// Starts Claude Desktop against a given profile directory.
//
// This is the whole mechanism: Chromium's stock --user-data-dir flag. Nothing
// about Claude Desktop is modified, patched or inspected.

function buildArgs(account) {
  // The default account is whatever Claude uses on its own, so it gets no flag.
  return account.kind === 'default' ? [] : [`--user-data-dir=${account.dir}`];
}

function createLauncher({ spawnImpl }) {
  return {
    launch(exePath, account) {
      const child = spawnImpl(exePath, buildArgs(account), {
        detached: true,
        stdio: 'ignore',
        windowsHide: false
      });
      // Detach fully so Multi-Claude can quit while Claude keeps running.
      child.unref();
    }
  };
}

module.exports = { buildArgs, createLauncher };
