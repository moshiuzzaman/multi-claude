'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createUpdater, INSTALL_ARGS } = require('../src/main/updater.js');

const yml = (v) => [
  `version: ${v}`,
  'files:',
  `  - url: Multi-Claude-Setup-${v}.exe`,
  '    sha512: SHA==',
  '    size: 1234',
  `path: Multi-Claude-Setup-${v}.exe`,
  'sha512: SHA==',
  ''
].join('\n');

const TMP = path.join('C:', 'tmp', 'mc-update');

function child(event = 'spawn', err) {
  const c = new EventEmitter();
  c.unref = () => { c.unrefed = true; };
  process.nextTick(() => c.emit(event, err));
  return c;
}

function harness(over = {}) {
  const calls = { fetched: [], downloads: [], spawned: [], quit: 0, opened: [] };
  const deps = {
    fetchText: async (url) => { calls.fetched.push(url); return yml('1.3.0'); },
    fetchJson: async () => [],
    download: async (url, dest, opts) => { calls.downloads.push({ url, dest, opts }); },
    spawn: (exe, args, opts) => { const c = child(); calls.spawned.push({ exe, args, opts, c }); return c; },
    quit: () => { calls.quit += 1; },
    openExternal: (u) => { calls.opened.push(u); },
    currentVersion: '1.2.0',
    mode: 'installed',
    repo: { owner: 'o', repo: 'r' },
    tmpDir: TMP,
    ...over
  };
  return { u: createUpdater(deps), calls };
}

const notFound = () => Object.assign(new Error('The server answered 404.'), { code: 'not_found' });

test('starts idle and reports the running version', () => {
  const { u } = harness();
  assert.deepStrictEqual(u.status(), { state: 'idle', current: '1.2.0', mode: 'installed' });
});

test('check finds a newer version from latest.yml', async () => {
  const { u, calls } = harness();
  const st = await u.check();
  assert.strictEqual(st.state, 'available');
  assert.strictEqual(st.latest, '1.3.0');
  assert.deepStrictEqual(calls.fetched, ['https://github.com/o/r/releases/latest/download/latest.yml']);
});

test('check reports up to date when the latest is not newer', async () => {
  const { u } = harness({ fetchText: async () => yml('1.2.0') });
  assert.strictEqual((await u.check()).state, 'current');
});

test('no release published yet counts as up to date, with a note', async () => {
  const { u } = harness({ fetchText: async () => { throw notFound(); } });
  const st = await u.check();
  assert.strictEqual(st.state, 'current');
  assert.match(st.note, /No release/);
});

test('a failed check says why', async () => {
  const { u } = harness({ fetchText: async () => { throw Object.assign(new Error('offline'), { code: 'network' }); } });
  const st = await u.check();
  assert.strictEqual(st.state, 'check-failed');
  assert.strictEqual(st.reason, 'offline');
});

test('an unusable latest.yml fails the check', async () => {
  const { u } = harness({ fetchText: async () => '<html>' });
  assert.strictEqual((await u.check()).state, 'check-failed');
  const traversal = harness({ fetchText: async () => yml('1.3.0').replace(/Multi-Claude-Setup-1\.3\.0\.exe/g, '..\\evil.exe') });
  assert.strictEqual((await traversal.u.check()).state, 'check-failed');
});

test('install does nothing before an update is found', async () => {
  const { u, calls } = harness();
  await u.install();
  assert.strictEqual(calls.downloads.length, 0);
});

test('install downloads, verifies, runs the installer silently and quits', async () => {
  const { u, calls } = harness();
  await u.check();
  const st = await u.install();

  assert.strictEqual(calls.downloads.length, 1);
  const d = calls.downloads[0];
  assert.strictEqual(d.url, 'https://github.com/o/r/releases/download/v1.3.0/Multi-Claude-Setup-1.3.0.exe');
  assert.strictEqual(d.dest, path.join(TMP, 'Multi-Claude-Setup-1.3.0.exe'));
  assert.strictEqual(d.opts.sha512, 'SHA==');
  assert.strictEqual(d.opts.size, 1234);

  assert.strictEqual(calls.spawned.length, 1);
  const s = calls.spawned[0];
  assert.strictEqual(s.exe, d.dest);
  assert.deepStrictEqual(s.args, ['/S', '--updated', '--force-run']);
  assert.deepStrictEqual(INSTALL_ARGS, ['/S', '--updated', '--force-run']);
  assert.strictEqual(s.opts.detached, true);
  assert.ok(!s.opts.shell, 'never through a shell');
  assert.ok(s.c.unrefed, 'the installer outlives Multi-Claude');

  assert.strictEqual(calls.quit, 1);
  assert.strictEqual(st.state, 'installing');
});

test('install reports downloading straight away, then progress', async () => {
  let release;
  let seen = null;
  const holder = {};
  const { u } = harness({
    download: (url, dest, opts) => new Promise((resolve) => {
      opts.onProgress(0.42);
      seen = holder.u.status();
      release = resolve;
    })
  });
  holder.u = u;
  await u.check();
  const running = u.install();
  assert.strictEqual(u.status().state, 'downloading', 'set before the first await');
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(seen.progress, 0.42);
  release();
  await running;
});

test('a second install while one runs is ignored', async () => {
  let release;
  const { u, calls } = harness({
    download: (url) => new Promise((resolve) => { calls.downloads.push(url); release = resolve; })
  });
  await u.check();
  const first = u.install();
  await u.install();
  assert.strictEqual(calls.downloads.length, 1);
  release();
  await first;
});

test('a failed download leaves Multi-Claude open, with a reason, and can retry', async () => {
  let fail = true;
  const { u, calls } = harness({
    download: async () => {
      if (fail) throw Object.assign(new Error('The download was damaged; nothing was installed.'), { code: 'damaged' });
    }
  });
  await u.check();
  const st = await u.install();
  assert.strictEqual(st.state, 'failed');
  assert.match(st.reason, /damaged/);
  assert.strictEqual(calls.spawned.length, 0);
  assert.strictEqual(calls.quit, 0);

  fail = false;
  assert.strictEqual((await u.install()).state, 'installing', 'Retry runs the install again');
});

test('an installer that will not start leaves Multi-Claude open', async () => {
  const { u, calls } = harness({ spawn: () => child('error', new Error('EACCES')) });
  await u.check();
  const st = await u.install();
  assert.strictEqual(st.state, 'failed');
  assert.match(st.reason, /would not start/);
  assert.strictEqual(calls.quit, 0);
});

test('an installer whose spawn throws synchronously (EBUSY) leaves Multi-Claude open', async () => {
  const { u, calls } = harness({ spawn: () => { throw Object.assign(new Error('spawn EBUSY'), { code: 'EBUSY' }); } });
  await u.check();
  const st = await u.install();
  assert.strictEqual(st.state, 'failed');
  assert.match(st.reason, /would not start/);
  assert.strictEqual(calls.quit, 0);
});

test('running from source never installs', async () => {
  const { u, calls } = harness({ mode: 'source' });
  await u.check();
  const st = await u.install();
  assert.strictEqual(st.state, 'available');
  assert.strictEqual(calls.downloads.length, 0);
  assert.strictEqual(calls.spawned.length, 0);
});

test('the portable build opens the release page instead', async () => {
  const { u, calls } = harness({ mode: 'portable' });
  await u.check();
  await u.install();
  assert.deepStrictEqual(calls.opened, ['https://github.com/o/r/releases/tag/v1.3.0']);
  assert.strictEqual(calls.downloads.length, 0);
});

test('changelog lists newer releases', async () => {
  const { u } = harness({
    fetchJson: async () => [{ tag_name: 'v1.3.0', draft: false, prerelease: false, published_at: 'd', body: 'notes' }]
  });
  assert.deepStrictEqual(await u.changelog(), { ok: true, releases: [{ version: '1.3.0', date: 'd', notes: 'notes' }] });
});

test('a changelog that cannot load says why', async () => {
  const { u } = harness({ fetchJson: async () => { throw new Error('rate limited'); } });
  assert.deepStrictEqual(await u.changelog(), { ok: false, reason: 'rate limited' });
});

test('the changelog is fetched once per launch once it has loaded', async () => {
  let n = 0;
  const { u } = harness({ fetchJson: async () => { n += 1; return []; } });
  const a = await u.changelog();
  const b = await u.changelog();
  assert.strictEqual(n, 1);
  assert.deepStrictEqual(b, a);
});

test('a failed changelog fetch is not cached', async () => {
  let n = 0;
  const { u } = harness({ fetchJson: async () => { n += 1; if (n === 1) throw new Error('rate limited'); return []; } });
  assert.strictEqual((await u.changelog()).ok, false);
  assert.strictEqual((await u.changelog()).ok, true);
  assert.strictEqual(n, 2);
});

test('openReleasesPage opens the releases list', () => {
  const { u, calls } = harness();
  u.openReleasesPage();
  assert.deepStrictEqual(calls.opened, ['https://github.com/o/r/releases']);
});
