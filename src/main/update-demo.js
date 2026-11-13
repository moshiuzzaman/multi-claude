'use strict';
// A pretend update, for trying the update screens on a dev run.
//
// Only used when Multi-Claude runs from source with MULTI_CLAUDE_UPDATE_DEMO
// set (see main.js). Nothing is downloaded or installed: these stand in for
// the network, the installer and the restart that createUpdater would use, so
// the real updater logic and the real screens run end to end.
//
//   MULTI_CLAUDE_UPDATE_DEMO=1      a minor update that "installs" and restarts
//   MULTI_CLAUDE_UPDATE_DEMO=major  the same, as a required (major) update
//   MULTI_CLAUDE_UPDATE_DEMO=fail   a minor update whose download fails at 60%

const { EventEmitter } = require('node:events');

const DOWNLOAD_MS = 7000;
const INSTALL_MS = 4000;

function bump(version, major) {
  const [a, b, c] = String(version).split('.').map((n) => Number(n) || 0);
  return major ? `${a + 1}.0.0` : `${a}.${b}.${c + 1}`;
}

function createDemoDeps({ flavor, currentVersion, restart, downloadMs = DOWNLOAD_MS, installMs = INSTALL_MS }) {
  const latest = bump(currentVersion, flavor === 'major');
  const file = `Multi-Claude-Setup-${latest}.exe`;

  return {
    mode: 'installed',
    fetchText: async () => [
      `version: ${latest}`,
      'files:',
      `  - url: ${file}`,
      '    sha512: demo',
      '    size: 120000000',
      `path: ${file}`,
      'sha512: demo'
    ].join('\n'),
    fetchJson: async () => [{
      tag_name: `v${latest}`,
      published_at: new Date().toISOString(),
      body: '## Changes\n\n- This is a demo update. Nothing is downloaded or installed.\n- Click Update to see the download, install and restart screens.'
    }],
    download: (url, dest, { onProgress } = {}) => new Promise((resolve, reject) => {
      const started = Date.now();
      const t = setInterval(() => {
        const p = Math.min(1, (Date.now() - started) / downloadMs);
        if (flavor === 'fail' && p >= 0.6) {
          clearInterval(t);
          reject(new Error('Demo: the download was interrupted.'));
          return;
        }
        if (onProgress) onProgress(p);
        if (p >= 1) { clearInterval(t); resolve(); }
      }, Math.min(120, downloadMs / 10));
    }),
    spawn: () => {
      const child = new EventEmitter();
      child.unref = () => {};
      setImmediate(() => child.emit('spawn'));
      return child;
    },
    // The real updater quits as soon as the installer starts; here the
    // "install" takes a few seconds and then Multi-Claude restarts.
    quit: () => { setTimeout(restart, installMs); }
  };
}

module.exports = { createDemoDeps };
