'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const H = require('../src/main/usage-history.js');
const { readDesktopSamples } = require('../src/main/desktop-usage.js');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
// Noon, local time, on a fixed day: day buckets don't depend on the time zone.
const NOW = new Date(2026, 10, 14, 12, 0, 0).getTime();
const at = (daysAgo, hour) => {
  const d = new Date(NOW);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
};

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-hist-'));
  return { dir, file: path.join(dir, 'usage-history.jsonl') };
}

test('readDesktopSamples returns every usable sample, oldest first', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-desk-'));
  fs.writeFileSync(path.join(dir, 'plan-usage-history.json'), JSON.stringify({ version: 1, samples: [
    { t: 30, org: 'x', u: { fh: 40, sd: 60 } },
    { t: 10, u: { fh: 5 } },
    { t: 20, u: {} },
    { t: 'bad', u: { fh: 1 } },
    { t: 40, u: { fh: 150, sd: -3 } }
  ] }));
  assert.deepStrictEqual(readDesktopSamples(dir), [
    { t: 10, session: 5, weekly: null },
    { t: 30, session: 40, weekly: 60 },
    { t: 40, session: 100, weekly: null }
  ]);
  assert.deepStrictEqual(readDesktopSamples(path.join(dir, 'nope')), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('buildHistory: one bucket per day, Session as the daily peak, empty days stay null', () => {
  const h = H.buildHistory({
    claude: [
      { t: at(2, 9), session: 20, weekly: 30 },
      { t: at(2, 15), session: 70, weekly: 34 }
    ],
    own: [{ t: at(0, 10), session: 12, weekly: 40 }]
  }, { days: 7, now: NOW });
  assert.strictEqual(h.days.length, 7);
  assert.strictEqual(h.from, at(6, 0));
  assert.strictEqual(h.to, at(-1, 0));
  const byAgo = (n) => h.days[6 - n];
  assert.strictEqual(byAgo(2).sessionPeak, 70);
  assert.strictEqual(byAgo(2).weeklyPeak, 34);
  assert.strictEqual(byAgo(2).readings, 2);
  assert.strictEqual(byAgo(1).sessionPeak, null, 'no readings: no bar, not 0%');
  assert.strictEqual(byAgo(0).sessionPeak, 12);
  assert.deepStrictEqual(h.weekly.map((p) => p.v), [30, 34, 40]);
  assert.deepStrictEqual(h.readings, { claude: 2, own: 1 });
  assert.deepStrictEqual(h.busiest, { key: byAgo(2).key, start: byAgo(2).start, sessionPeak: 70 });
  assert.deepStrictEqual(h.latest, { t: at(0, 10), session: 12, weekly: 40 });
});

test('buildHistory leaves out readings before the range', () => {
  const h = H.buildHistory({ claude: [{ t: at(10, 9), session: 90, weekly: 90 }] }, { days: 7, now: NOW });
  assert.deepStrictEqual(h.weekly, []);
  assert.strictEqual(h.busiest, null);
  assert.deepStrictEqual(h.readings, { claude: 0, own: 0 });
  assert.strictEqual(h.latest.weekly, 90, 'latest still says where Weekly last stood');
});

test('limit hits: counted once per climb, again after a drop or a full window', () => {
  const pts = [
    { t: at(5, 9), session: 100, weekly: 50 },
    { t: at(5, 10), session: 100, weekly: 60 },
    { t: at(5, 12), session: 3, weekly: 61 },
    { t: at(5, 14), session: 100, weekly: 62 },
    { t: at(4, 9), session: 100, weekly: 100 },
    { t: at(3, 9), session: 0, weekly: 100 }
  ];
  assert.deepStrictEqual(H.limitHits(pts, 'session').map((h) => h.t), [at(5, 9), at(5, 14), at(4, 9)],
    'the 4th day reading is 19 hours later: a new session that hit the limit');
  assert.deepStrictEqual(H.limitHits(pts, 'weekly').map((h) => h.t), [at(4, 9)], 'Weekly stayed at the limit: once');
  const h = H.buildHistory({ claude: pts }, { days: 7, now: NOW });
  assert.strictEqual(h.hits.length, 4);
  assert.deepStrictEqual(h.hits.map((x) => x.window), ['session', 'session', 'session', 'weekly']);
});

test('a hit that started before the range is not counted inside it', () => {
  const pts = [{ t: at(8, 9), session: 10, weekly: 100 }, { t: at(6, 9), session: 10, weekly: 100 }];
  assert.deepStrictEqual(H.buildHistory({ claude: pts }, { days: 7, now: NOW }).hits, []);
});

test('liveReading takes Session and Weekly (all models) from a live row', () => {
  const row = { plan: { ok: true, fetchedAt: 5, meters: [
    { kind: 'session', percent: 22 }, { kind: 'weekly_all', percent: 64 }, { kind: 'weekly_opus', percent: 99 }
  ] } };
  assert.deepStrictEqual(H.liveReading(row), { t: 5, session: 22, weekly: 64 });
  assert.strictEqual(H.liveReading({ plan: { ok: false } }), null);
  assert.strictEqual(H.liveReading({ plan: { ok: true, meters: [] } }), null);
  assert.strictEqual(H.liveReading(null), null);
});

test('the log keeps readings, skips repeats within 30 minutes, and survives a restart', async () => {
  const { dir, file } = tmpFile();
  const log = H.createHistoryLog({ file, now: () => NOW });
  assert.strictEqual(await log.record('a', { t: NOW - 3 * HOUR, session: 10, weekly: 20 }), true);
  assert.strictEqual(await log.record('a', { t: NOW - 3 * HOUR + 5 * 60000, session: 10, weekly: 20 }), false, 'same figures, 5 min later');
  assert.strictEqual(await log.record('a', { t: NOW - 2 * HOUR, session: 10, weekly: 20 }), true, 'same figures, an hour later');
  assert.strictEqual(await log.record('a', { t: NOW - 2 * HOUR, session: 30, weekly: 20 }), false, 'not newer than the last');
  assert.strictEqual(await log.record('b', { t: NOW - HOUR, session: null, weekly: 5 }), true);
  assert.strictEqual(await log.record('b', { t: NOW, session: null, weekly: null }), false, 'nothing to keep');
  await log.flush();

  const again = H.createHistoryLog({ file, now: () => NOW });
  assert.deepStrictEqual(await again.read('a'), [
    { t: NOW - 3 * HOUR, session: 10, weekly: 20 },
    { t: NOW - 2 * HOUR, session: 10, weekly: 20 }
  ]);
  assert.deepStrictEqual(await again.read('b'), [{ t: NOW - HOUR, session: null, weekly: 5 }]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the log drops readings older than 90 days and broken lines, and forgets deleted accounts', async () => {
  const { dir, file } = tmpFile();
  fs.writeFileSync(file, [
    JSON.stringify({ id: 'a', t: NOW - 100 * DAY, s: 1, w: 1 }),
    'not json',
    JSON.stringify({ id: 'a', t: NOW - DAY, s: 2, w: 2 }),
    JSON.stringify({ id: 'b', t: NOW - DAY, s: 3, w: 3 })
  ].join('\n') + '\n');
  const log = H.createHistoryLog({ file, now: () => NOW });
  assert.deepStrictEqual(await log.read('a'), [{ t: NOW - DAY, session: 2, weekly: 2 }]);
  await log.flush();
  assert.strictEqual(fs.readFileSync(file, 'utf8').trim().split('\n').length, 2, 'the file was tidied');
  await log.forget('b');
  await log.flush();
  assert.deepStrictEqual(await H.createHistoryLog({ file, now: () => NOW }).read('b'), []);
  fs.rmSync(dir, { recursive: true, force: true });
});
