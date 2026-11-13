'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const { createUpdater } = require('../src/main/updater.js');
const { createDemoDeps } = require('../src/main/update-demo.js');

function demoUpdater(flavor, onRestart) {
  return createUpdater({
    ...createDemoDeps({ flavor, currentVersion: '2.3.3', restart: onRestart, downloadMs: 60, installMs: 10 }),
    openExternal: () => {},
    currentVersion: '2.3.3',
    repo: { owner: 'o', repo: 'r' },
    tmpDir: os.tmpdir()
  });
}

test('demo update runs the real updater through download, install and restart', async () => {
  let restarted = false;
  const u = demoUpdater('1', () => { restarted = true; });
  const checked = await u.check();
  assert.strictEqual(checked.state, 'available');
  assert.strictEqual(checked.latest, '2.3.4');
  assert.strictEqual(checked.kind, 'minor');
  const notes = await u.changelog();
  assert.ok(notes.ok && notes.releases[0].version === '2.3.4');

  const done = await u.install();
  assert.strictEqual(done.state, 'installing');
  await new Promise((r) => setTimeout(r, 40));
  assert.ok(restarted, 'restarts after the pretend install');
});

test('demo major update is a required one', async () => {
  const u = demoUpdater('major', () => {});
  const s = await u.check();
  assert.strictEqual(s.latest, '3.0.0');
  assert.strictEqual(s.kind, 'major');
});

test('demo fail flavor ends in a failed update', async () => {
  const u = demoUpdater('fail', () => {});
  await u.check();
  const s = await u.install();
  assert.strictEqual(s.state, 'failed');
  assert.match(s.reason, /interrupted/);
});
