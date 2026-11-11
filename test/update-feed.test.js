'use strict';
const test = require('node:test');
const assert = require('node:assert');
const F = require('../src/main/update-feed.js');

// What electron-builder writes for an NSIS build: size lives only in files[].
const SAMPLE = [
  'version: 1.3.0',
  'files:',
  '  - url: Multi-Claude-Setup-1.3.0.exe',
  '    sha512: QUJD+/==',
  '    size: 86123456',
  'path: Multi-Claude-Setup-1.3.0.exe',
  'sha512: QUJD+/==',
  "releaseDate: '2026-11-11T10:00:00.000Z'",
  ''
].join('\n');

const WANT = { version: '1.3.0', path: 'Multi-Claude-Setup-1.3.0.exe', sha512: 'QUJD+/==', size: 86123456 };

test('parseLatestYml reads what electron-builder writes', () => {
  assert.deepStrictEqual(F.parseLatestYml(SAMPLE), WANT);
});

test('parseLatestYml tolerates CRLF and quoted values', () => {
  const text = SAMPLE.replace("version: 1.3.0", "version: '1.3.0'")
    .replace('path: Multi-Claude-Setup-1.3.0.exe', 'path: "Multi-Claude-Setup-1.3.0.exe"')
    .replace(/\n/g, '\r\n');
  assert.deepStrictEqual(F.parseLatestYml(text), WANT);
});

test('parseLatestYml returns null when a field is missing', () => {
  assert.strictEqual(F.parseLatestYml(SAMPLE.replace('    size: 86123456\n', '')), null);
  assert.strictEqual(F.parseLatestYml(SAMPLE.replace('path: Multi-Claude-Setup-1.3.0.exe\n', '')), null);
  assert.strictEqual(F.parseLatestYml(SAMPLE.replace('version: 1.3.0\n', '')), null);
  assert.strictEqual(F.parseLatestYml(''), null);
  assert.strictEqual(F.parseLatestYml('<html>not yaml</html>'), null);
});

test('isNewer compares numerically, ignoring a leading v', () => {
  assert.strictEqual(F.isNewer('1.10.0', '1.9.2'), true);
  assert.strictEqual(F.isNewer('v1.3.0', '1.2.9'), true);
  assert.strictEqual(F.isNewer('1.2.0', '1.2.0'), false);
  assert.strictEqual(F.isNewer('1.2.0', '1.3.0'), false);
});

test('isNewer never treats a prerelease or garbage as newer', () => {
  assert.strictEqual(F.isNewer('1.3.0-beta.1', '1.2.0'), false);
  assert.strictEqual(F.isNewer('latest', '1.0.0'), false);
});

test('safeAssetName accepts a plain installer name only', () => {
  assert.strictEqual(F.safeAssetName('Multi-Claude-Setup-1.3.0.exe'), true);
  for (const bad of ['../x.exe', 'a/b.exe', 'a\\b.exe', '', 'setup.msi', null, 'x:y.exe', 'a b.exe', 'a..b.exe']) {
    assert.strictEqual(F.safeAssetName(bad), false, String(bad));
  }
});

test('parseReleases keeps newer published releases, newest first', () => {
  const list = [
    { tag_name: 'v1.3.0', draft: false, prerelease: false, published_at: '2026-11-20T00:00:00Z', body: 'three' },
    { tag_name: 'v1.5.0', draft: true, prerelease: false, published_at: null, body: 'draft' },
    { tag_name: 'v1.4.0-beta.1', draft: false, prerelease: true, published_at: '2026-11-25T00:00:00Z', body: 'beta' },
    { tag_name: 'v1.2.0', draft: false, prerelease: false, published_at: '2026-11-11T00:00:00Z', body: 'current' },
    { tag_name: 'v1.4.0', draft: false, prerelease: false, published_at: '2026-11-30T00:00:00Z', body: null }
  ];
  assert.deepStrictEqual(F.parseReleases(list, '1.2.0'), [
    { version: '1.4.0', date: '2026-11-30T00:00:00Z', notes: '' },
    { version: '1.3.0', date: '2026-11-20T00:00:00Z', notes: 'three' }
  ]);
  assert.deepStrictEqual(F.parseReleases({ message: 'rate limited' }, '1.2.0'), []);
});

test('feedUrls builds every address from the repo alone', () => {
  const u = F.feedUrls({ owner: 'o', repo: 'r' });
  assert.strictEqual(u.latestYml, 'https://github.com/o/r/releases/latest/download/latest.yml');
  assert.strictEqual(u.releasesApi, 'https://api.github.com/repos/o/r/releases?per_page=30');
  assert.strictEqual(u.releasesPage, 'https://github.com/o/r/releases');
  assert.strictEqual(u.asset('1.3.0', 'Multi-Claude-Setup-1.3.0.exe'),
    'https://github.com/o/r/releases/download/v1.3.0/Multi-Claude-Setup-1.3.0.exe');
  assert.strictEqual(u.releasePage('1.3.0'), 'https://github.com/o/r/releases/tag/v1.3.0');
});

test('the updater checks the repo electron-builder publishes to', () => {
  const pkg = require('../package.json');
  const cfg = require('../src/main/update-config.js');
  assert.strictEqual(pkg.build.publish.provider, 'github');
  assert.deepStrictEqual(
    { owner: pkg.build.publish.owner, repo: pkg.build.publish.repo },
    { owner: cfg.owner, repo: cfg.repo }
  );
});

test('artifact names have no spaces, so GitHub keeps them matching latest.yml', () => {
  const pkg = require('../package.json');
  assert.ok(!/\s/.test(pkg.build.nsis.artifactName));
  assert.ok(!/\s/.test(pkg.build.portable.artifactName));
});

test('isMajorUpdate is true only when the first number goes up', () => {
  assert.strictEqual(F.isMajorUpdate('2.0.0', '1.9.9'), true);
  assert.strictEqual(F.isMajorUpdate('v3.1.0', '1.2.1'), true);
  assert.strictEqual(F.isMajorUpdate('1.3.0', '1.2.1'), false);
  assert.strictEqual(F.isMajorUpdate('1.2.2', '1.2.1'), false);
  assert.strictEqual(F.isMajorUpdate('2.0.0-beta.1', '1.2.1'), false);
  assert.strictEqual(F.isMajorUpdate('garbage', '1.2.1'), false);
});
