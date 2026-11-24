'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fixedName, addFixedNameCopies } = require('../build/latest-links.js');

test('fixedName: drops the version from the installer names', () => {
  assert.strictEqual(fixedName('Multi-Claude-Setup-2.8.3.exe'), 'Multi-Claude-Setup.exe');
  assert.strictEqual(fixedName('Multi-Claude-2.8.3-portable.exe'), 'Multi-Claude-portable.exe');
  assert.strictEqual(fixedName('Multi-Claude-2.8.3-arm64.dmg'), 'Multi-Claude-arm64.dmg');
  assert.strictEqual(fixedName('Multi-Claude-2.8.3-x64.dmg'), 'Multi-Claude-x64.dmg');
  assert.strictEqual(fixedName('Multi-Claude-10.0.0-beta.1-x64.dmg'), 'Multi-Claude-x64.dmg');
});

test('fixedName: leaves everything else alone', () => {
  for (const n of ['latest.yml', 'latest-mac.yml', 'Multi-Claude-Setup-2.8.3.exe.blockmap',
    'Multi-Claude-2.8.3-mac-arm64.zip', 'Multi-Claude-Setup.exe', 'other.exe', 'Multi-Claude-2.8.3-x64.dmg.blockmap']) {
    assert.strictEqual(fixedName(n), null, n);
  }
});

test('addFixedNameCopies: copies next to the originals and returns them for publishing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-links-'));
  const files = ['Multi-Claude-Setup-2.8.3.exe', 'Multi-Claude-2.8.3-portable.exe', 'Multi-Claude-Setup-2.8.3.exe.blockmap', 'latest.yml']
    .map((n) => { const p = path.join(dir, n); fs.writeFileSync(p, `data:${n}`); return p; });
  const extra = await addFixedNameCopies({ artifactPaths: files });
  assert.deepStrictEqual(extra.map((p) => path.basename(p)).sort(), ['Multi-Claude-Setup.exe', 'Multi-Claude-portable.exe']);
  assert.strictEqual(fs.readFileSync(path.join(dir, 'Multi-Claude-Setup.exe'), 'utf8'), 'data:Multi-Claude-Setup-2.8.3.exe');
  // the originals are kept
  assert.ok(fs.existsSync(files[0]));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('addFixedNameCopies: nothing to add returns an empty list', async () => {
  assert.deepStrictEqual(await addFixedNameCopies({ artifactPaths: ['/x/latest.yml'] }), []);
  assert.deepStrictEqual(await addFixedNameCopies({}), []);
});
