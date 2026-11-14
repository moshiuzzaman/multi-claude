'use strict';
const test = require('node:test');
const assert = require('node:assert');
const A = require('../src/main/alerts.js');

const S = A.normaliseSettings({});
const HOUR = 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

const at = (percent, observedAt = NOW, resetsAt = null) => ({ window: 'session', percent, resetsAt, observedAt, live: true });

/** Run a series of figures through step() and collect the alerts. */
function run(figures, settings = S) {
  let st;
  const alerts = [];
  figures.forEach((p, i) => {
    const r = step(st, at(p, NOW + i), settings);
    st = r.state;
    if (r.alert) alerts.push(r.alert);
  });
  return { state: st, alerts };
}
const step = A.step;

test('normaliseSettings: defaults are on, 80 and 95, no reset alert', () => {
  assert.deepStrictEqual(A.normaliseSettings(undefined), { on: true, thresholds: [80, 95], reset: false });
  assert.deepStrictEqual(A.normaliseSettings({ on: false, thresholds: [95, 80, 80, 33, '70'], reset: true }),
    { on: false, thresholds: [70, 80, 95], reset: true });
  assert.deepStrictEqual(A.normaliseSettings({ thresholds: [] }).thresholds, [], 'none chosen: only "limit reached"');
});

test('a threshold alerts once, on the way up', () => {
  const { alerts } = run([40, 70, 81, 83, 85, 90]);
  assert.strictEqual(alerts.length, 1);
  assert.deepStrictEqual(alerts[0], { type: 'threshold', threshold: 80, percent: 81, resetsAt: null });
});

test('each threshold alerts in turn, then the limit', () => {
  const { alerts } = run([50, 82, 96, 100, 100]);
  assert.deepStrictEqual(alerts.map((a) => a.threshold), [80, 95, 100]);
});

test('jumping past several thresholds shows one alert, for the highest', () => {
  const { alerts, state } = run([10, 97, 98]);
  assert.deepStrictEqual(alerts.map((a) => a.threshold), [95]);
  assert.deepStrictEqual(state.fired, [80, 95]);
});

test('dropping below re-arms it, so the next window alerts again', () => {
  const { alerts } = run([85, 86, 3, 20, 84]);
  assert.deepStrictEqual(alerts.map((a) => a.threshold), [80, 80]);
});

test('the first figure ever seen alerts for the highest level already passed', () => {
  assert.deepStrictEqual(run([88]).alerts.map((a) => a.threshold), [80]);
  assert.deepStrictEqual(run([30]).alerts, []);
});

test('an older figure than the last one is ignored', () => {
  const first = step(undefined, at(85, NOW), S);
  const stale = step(first.state, at(10, NOW - HOUR), S);
  assert.strictEqual(stale.state, first.state, 'state untouched');
  const again = step(stale.state, at(86, NOW + 1), S);
  assert.strictEqual(again.alert, null, 'the stale figure did not re-arm 80');
});

test('reset alert: only after the limit was reached, and only when chosen', () => {
  assert.deepStrictEqual(run([100, 4]).alerts.map((a) => a.type), ['threshold']);
  const on = A.normaliseSettings({ reset: true });
  assert.deepStrictEqual(run([100, 4], on).alerts.map((a) => a.type), ['threshold', 'reset']);
  assert.deepStrictEqual(run([96, 4], on).alerts.map((a) => a.type), ['threshold'], 'no reset without the limit');
});

test('a threshold that was un-chosen is forgotten', () => {
  const r1 = step(undefined, at(85), S);
  assert.deepStrictEqual(r1.state.fired, [80]);
  const r2 = step(r1.state, at(86, NOW + 1), A.normaliseSettings({ thresholds: [95] }));
  assert.deepStrictEqual(r2.state.fired, []);
  assert.strictEqual(r2.alert, null);
});

test('readingsFor prefers live figures and maps Session and Weekly', () => {
  const row = {
    plan: { ok: true, fetchedAt: NOW, meters: [
      { kind: 'session', percent: 40, resetsAt: NOW + HOUR },
      { kind: 'weekly_all', percent: 70, resetsAt: NOW + 50 * HOUR },
      { kind: 'weekly_opus', percent: 99, resetsAt: null }
    ] },
    desktop: { recordedAt: NOW, session: 1, weekly: 2 }
  };
  assert.deepStrictEqual(A.readingsFor(row, NOW), [
    { window: 'session', percent: 40, resetsAt: NOW + HOUR, observedAt: NOW, live: true },
    { window: 'weekly', percent: 70, resetsAt: NOW + 50 * HOUR, observedAt: NOW, live: true }
  ]);
});

test('readingsFor falls back to the Claude window record, skipping stale figures', () => {
  const row = { plan: { ok: false }, desktop: { recordedAt: NOW - 6 * HOUR, session: 90, weekly: 60 } };
  assert.deepStrictEqual(A.readingsFor(row, NOW), [
    { window: 'weekly', percent: 60, resetsAt: null, observedAt: NOW - 6 * HOUR, live: false }
  ], 'a 6-hour-old Session figure has already reset');
  assert.deepStrictEqual(A.readingsFor({ desktop: { recordedAt: NOW - 30 * HOUR, session: 9, weekly: 9 } }, NOW), []);
  assert.deepStrictEqual(A.readingsFor({ plan: null, desktop: null }, NOW), []);
  assert.deepStrictEqual(A.readingsFor(null, NOW), []);
});

test('evaluate: per account, labelled, muted accounts tracked but silent, off shows nothing', () => {
  const accounts = [{ id: 'a', label: 'Work' }, { id: 'b', label: 'Home', muteAlerts: true }];
  const live = (p) => ({ plan: { ok: true, fetchedAt: NOW, meters: [{ kind: 'session', percent: p, resetsAt: null }] } });
  const rows = [{ id: 'a', ...live(85) }, { id: 'b', ...live(90) }];
  const r = A.evaluate({}, rows, accounts, {}, NOW);
  assert.deepStrictEqual(r.alerts, [{ id: 'a', label: 'Work', window: 'session', type: 'threshold', threshold: 80, percent: 85, resetsAt: null }]);
  assert.deepStrictEqual(r.state.b.session.fired, [80], 'muted, but its state moved on');
  assert.strictEqual(r.changed, true);

  const again = A.evaluate(r.state, rows, accounts, {}, NOW);
  assert.deepStrictEqual(again.alerts, []);
  assert.strictEqual(again.changed, false);

  const off = A.evaluate({}, rows, accounts, { on: false }, NOW);
  assert.deepStrictEqual(off.alerts, []);
  assert.deepStrictEqual(off.state.a.session.fired, [80]);
});

test('evaluate keeps state for accounts missing from this result, drops deleted ones', () => {
  const st = { a: { session: { last: 85, observedAt: NOW, fired: [80] } }, gone: { session: { last: 1, observedAt: 1, fired: [] } } };
  const r = A.evaluate(st, [], [{ id: 'a', label: 'Work' }], {}, NOW);
  assert.deepStrictEqual(Object.keys(r.state), ['a']);
  assert.strictEqual(r.changed, true);
});

test('alertText words each kind of alert', () => {
  const base = { label: 'Work', window: 'weekly', type: 'threshold', percent: 82.4, threshold: 80 };
  assert.deepStrictEqual(A.alertText({ ...base, resetsAt: NOW + 2 * HOUR + 10 * 60000 }, NOW),
    { title: 'Work: Weekly at 82%', body: 'Resets in 2h 10m' });
  assert.deepStrictEqual(A.alertText({ ...base, resetsAt: null }, NOW),
    { title: 'Work: Weekly at 82%', body: 'Passed your 80% alert.' });
  assert.strictEqual(A.alertText({ ...base, window: 'session', threshold: 100, percent: 100 }, NOW).title, 'Work: Session limit reached');
  assert.deepStrictEqual(A.alertText({ label: 'Work', window: 'session', type: 'reset' }, NOW),
    { title: 'Work: Session limit reset', body: 'Ready to use again.' });
  assert.match(A.alertText({ ...base, resetsAt: NOW + 50 * HOUR }, NOW).body, /^Resets \w{3} \d\d:\d\d$/);
});
