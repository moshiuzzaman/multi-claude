'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { planPrune, prune } = require('../.github/scripts/prune-release-assets.js');

const asset = (id, name) => ({ id, name });
const rel = (id, tag, assets, extra = {}) => ({ id, tag_name: tag, draft: false, prerelease: false, assets, ...extra });
const full = (base) => [asset(base + 1, 'latest.yml'), asset(base + 2, 'Multi-Claude-Setup-x.exe'), asset(base + 3, 'Multi-Claude-Setup.exe')];

test('planPrune: removes the files of every older published release, keeps the latest', () => {
  const latest = rel(3, 'v2.9.0', full(300));
  const releases = [latest, rel(2, 'v2.8.3', full(200)), rel(1, 'v2.8.2', full(100))];
  const plan = planPrune(releases, latest);
  assert.strictEqual(plan.ok, true);
  assert.deepStrictEqual(plan.deletions.map((d) => d.assetId).sort(), [101, 102, 103, 201, 202, 203]);
  assert.ok(plan.deletions.every((d) => d.tag !== 'v2.9.0'));
});

test('planPrune: never touches drafts, pre-releases or releases already empty', () => {
  const latest = rel(3, 'v2.9.0', full(300));
  const releases = [
    latest,
    rel(4, 'v3.0.0', full(400), { draft: true }),
    rel(5, 'v3.0.0-beta.1', full(500), { prerelease: true }),
    rel(2, 'v2.8.3', [])
  ];
  const plan = planPrune(releases, latest);
  assert.strictEqual(plan.ok, true);
  assert.deepStrictEqual(plan.deletions, []);
});

test('planPrune: refuses when the latest release has no installer or update file', () => {
  const older = rel(2, 'v2.8.3', full(200));
  for (const assets of [[], [asset(1, 'latest.yml')], [asset(1, 'Multi-Claude-Setup-2.9.0.exe')]]) {
    const latest = rel(3, 'v2.9.0', assets);
    const plan = planPrune([latest, older], latest);
    assert.strictEqual(plan.ok, false);
    assert.deepStrictEqual(plan.deletions, []);
  }
  assert.strictEqual(planPrune([older], null).ok, false);
  assert.strictEqual(planPrune([older], rel(9, 'v9', full(900), { draft: true })).ok, false);
});

test('prune: dry run deletes nothing; a real run deletes each planned file', async () => {
  const latest = rel(3, 'v2.9.0', full(300));
  const releases = [latest, rel(2, 'v2.8.3', full(200))];
  const calls = [];
  const api = {
    latest: async () => latest,
    list: async () => releases,
    deleteAsset: async (id) => calls.push(id)
  };
  const dry = await prune(api, { dryRun: true, log: () => {} });
  assert.strictEqual(dry.deleted, 0);
  assert.strictEqual(dry.planned, 3);
  assert.deepStrictEqual(calls, []);
  const real = await prune(api, { dryRun: false, log: () => {} });
  assert.strictEqual(real.deleted, 3);
  assert.deepStrictEqual(calls.sort(), [201, 202, 203]);
});

test('prune: a refused plan throws so the workflow fails visibly', async () => {
  const latest = rel(3, 'v2.9.0', []);
  const api = { latest: async () => latest, list: async () => [latest], deleteAsset: async () => { throw new Error('should not delete'); } };
  await assert.rejects(prune(api, { dryRun: false, log: () => {} }), /latest release/i);
});
