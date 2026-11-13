'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { createCcInstaller, parseManifest, BASE_URL } = require('../src/main/cc-install.js');

const SUM = 'a'.repeat(64);
const manifest = (over = {}) => ({
  version: '2.1.323',
  platforms: {
    'win32-x64': { binary: 'claude.exe', checksum: SUM, size: 1234 },
    'win32-arm64': { binary: 'claude.exe', checksum: 'b'.repeat(64), size: 999 },
    ...over
  }
});

const ROOT = path.join('C:', 'appdata', 'multi-claude', 'claude-code');

function harness(over = {}) {
  const calls = { text: [], json: [], downloads: [], renames: [], removed: [] };
  const deps = {
    fetchText: async (url) => { calls.text.push(url); return '2.1.323\n'; },
    fetchJson: async (url) => { calls.json.push(url); return manifest(); },
    download: async (url, dest, opts) => { calls.downloads.push({ url, dest, opts }); },
    rename: async (from, to) => { calls.renames.push({ from, to }); },
    remove: async (p) => { calls.removed.push(p); },
    rootDir: ROOT,
    arch: 'x64',
    ...over
  };
  return { i: createCcInstaller(deps), calls };
}

test('parseManifest reads the checksum and size for one platform', () => {
  assert.deepStrictEqual(parseManifest(manifest(), 'win32-x64'), { sha256: SUM, size: 1234 });
});

test('parseManifest rejects a missing platform, a bad checksum and a bad size', () => {
  assert.strictEqual(parseManifest(manifest(), 'linux-x64'), null);
  assert.strictEqual(parseManifest(manifest({ 'win32-x64': { checksum: 'xyz', size: 5 } }), 'win32-x64'), null);
  assert.strictEqual(parseManifest(manifest({ 'win32-x64': { checksum: SUM, size: 0 } }), 'win32-x64'), null);
  assert.strictEqual(parseManifest(null, 'win32-x64'), null);
  assert.strictEqual(parseManifest('<html>', 'win32-x64'), null);
});

test('starts idle', () => {
  assert.deepStrictEqual(harness().i.status(), { state: 'idle' });
});

test('start downloads the latest build from Anthropic, verified, into its version folder', async () => {
  const { i, calls } = harness();
  const st = await i.start();

  assert.deepStrictEqual(calls.text, [`${BASE_URL}/latest`]);
  assert.deepStrictEqual(calls.json, [`${BASE_URL}/2.1.323/manifest.json`]);
  assert.strictEqual(calls.downloads.length, 1);
  const d = calls.downloads[0];
  assert.strictEqual(d.url, `${BASE_URL}/2.1.323/win32-x64/claude.exe`);
  assert.strictEqual(d.dest, path.join(ROOT, '2.1.323', 'claude.exe.download'));
  assert.strictEqual(d.opts.sha256, SUM);
  assert.strictEqual(d.opts.size, 1234);

  // Only a finished, verified file ever gets the name the finder looks for.
  assert.deepStrictEqual(calls.renames, [{ from: d.dest, to: path.join(ROOT, '2.1.323', 'claude.exe') }]);
  assert.deepStrictEqual(st, { state: 'done', version: '2.1.323' });
  assert.ok(BASE_URL.startsWith('https://downloads.claude.ai/'));
});

test('an ARM PC gets the ARM build', async () => {
  const { i, calls } = harness({ arch: 'arm64' });
  await i.start();
  assert.strictEqual(calls.downloads[0].url, `${BASE_URL}/2.1.323/win32-arm64/claude.exe`);
  assert.strictEqual(calls.downloads[0].opts.size, 999);
});

test('anything that is not a plain version never reaches a URL', async () => {
  for (const bad of ['<html>blocked</html>', '2.1.323/../../evil', '', 'latest']) {
    const { i, calls } = harness({ fetchText: async () => bad });
    const st = await i.start();
    assert.strictEqual(st.state, 'failed', bad);
    assert.strictEqual(calls.json.length, 0);
    assert.strictEqual(calls.downloads.length, 0);
  }
});

test('a manifest without a usable entry fails before downloading', async () => {
  const { i, calls } = harness({ fetchJson: async () => ({ platforms: {} }) });
  const st = await i.start();
  assert.strictEqual(st.state, 'failed');
  assert.strictEqual(calls.downloads.length, 0);
});

test('reports progress while downloading and ignores a second start', async () => {
  let release;
  let seen = null;
  const holder = {};
  const { i, calls } = harness({
    download: (url, dest, opts) => new Promise((resolve) => {
      calls.downloads.push(url);
      opts.onProgress(0.42);
      seen = holder.i.status();
      release = resolve;
    })
  });
  holder.i = i;
  const first = i.start();
  assert.strictEqual(i.status().state, 'checking', 'set before the first await');
  await new Promise((r) => setImmediate(r));
  assert.deepStrictEqual(seen, { state: 'downloading', version: '2.1.323', size: 1234, progress: 0.42 });
  await i.start();
  assert.strictEqual(calls.downloads.length, 1);
  release();
  assert.strictEqual((await first).state, 'done');
});

test('a failed download says why, keeps nothing, and can be retried', async () => {
  let fail = true;
  const { i, calls } = harness({
    download: async () => { if (fail) throw Object.assign(new Error('The download was damaged; nothing was installed.'), { code: 'damaged' }); }
  });
  const st = await i.start();
  assert.strictEqual(st.state, 'failed');
  assert.match(st.reason, /damaged/);
  assert.strictEqual(calls.renames.length, 0);

  fail = false;
  assert.strictEqual((await i.start()).state, 'done');
});

test('a failed check says why', async () => {
  const { i } = harness({ fetchText: async () => { throw new Error('offline'); } });
  assert.deepStrictEqual(await i.start(), { state: 'failed', reason: 'offline' });
});
