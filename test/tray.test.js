'use strict';
const test = require('node:test');
const assert = require('node:assert');
const T = require('../src/main/tray.js');

const NOW = 1_800_000_000_000;
const HOUR = 60 * 60 * 1000;
const live = (s, w) => ({ plan: { ok: true, fetchedAt: NOW, meters: [
  { kind: 'session', percent: s, resetsAt: null }, { kind: 'weekly_all', percent: w, resetsAt: null }
] } });
const accounts = [
  { id: 'd', label: 'Default', kind: 'default', exists: true },
  { id: 'w', label: 'Work', kind: 'managed', exists: true },
  { id: 'x', label: 'Gone', kind: 'managed', exists: false }
];

test('figures: live first, Claude window record when recent, "limit" at 100%', () => {
  assert.strictEqual(T.figures(live(37.4, 66), NOW), 'S 37% · W 66%');
  assert.strictEqual(T.figures(live(100, 20), NOW), 'S 100% limit · W 20%');
  assert.strictEqual(T.figures({ desktop: { recordedAt: NOW - 6 * HOUR, session: 50, weekly: 40 } }, NOW), 'W 40%',
    'a 6-hour-old Session figure has already reset');
  assert.strictEqual(T.figures(undefined, NOW), '');
});

test('the menu lists each account with its state, figures and the right actions', () => {
  const rows = new Map([['d', live(37, 66)], ['w', live(5, 100)]]);
  const m = T.buildTrayModel({ accounts, running: new Set(['d']), rows, now: NOW });
  const acct = m.filter((i) => i.submenu);
  assert.deepStrictEqual(acct.map((i) => i.label), [
    '●  Default     S 37% · W 66%',
    '○  Work     S 5% · W 100% limit',
    '○  Gone'
  ]);
  assert.deepStrictEqual(acct[0].submenu.filter((i) => i.action).map((i) => i.action), ['show', 'close', 'open-account']);
  assert.deepStrictEqual(acct[1].submenu.filter((i) => i.action).map((i) => [i.action, i.id]), [['launch', 'w'], ['open-account', 'w']]);
  assert.strictEqual(acct[2].submenu[0].enabled, false, 'a missing folder cannot be launched');
  const actions = m.filter((i) => i.action).map((i) => i.action);
  assert.deepStrictEqual(actions, ['open', 'check-updates', 'quit']);
  assert.strictEqual(m.at(-1).label, 'Quit Multi-Claude');
});

test('an available update shows in the menu; an unknown running state shows no dots', () => {
  const m = T.buildTrayModel({ accounts: accounts.slice(0, 1), running: null, update: { state: 'available', latest: '2.8.0' }, now: NOW });
  assert.ok(m.some((i) => i.label === 'Update to 2.8.0…' && i.action === 'open'));
  assert.ok(!m.some((i) => i.action === 'check-updates'));
  assert.strictEqual(m.find((i) => i.submenu).label, '·  Default');
});

test('no accounts: a disabled line, and Open / Quit still there', () => {
  const m = T.buildTrayModel({ accounts: [], now: NOW });
  assert.ok(m.some((i) => i.label === 'No accounts yet' && i.enabled === false));
  assert.ok(m.some((i) => i.action === 'quit'));
});

test('tooltip: running count and figures, never longer than Windows allows', () => {
  const rows = new Map([['d', live(37, 66)]]);
  assert.strictEqual(T.tooltip({ accounts, running: new Set(['d']), rows, now: NOW }), 'Multi-Claude · 1 running\nDefault: S 37% · W 66%');
  const many = Array.from({ length: 12 }, (_, i) => ({ id: `a${i}`, label: `Account number ${i}` }));
  const tip = T.tooltip({ accounts: many, running: new Set(), rows: new Map(many.map((a) => [a.id, live(10, 20)])), now: NOW });
  assert.ok(tip.length <= T.TOOLTIP_MAX);
  assert.ok(tip.startsWith('Multi-Claude · 0 running'));
});

test('toTemplate wires each action and keeps headers and separators', () => {
  const calls = [];
  const m = T.buildTrayModel({ accounts: accounts.slice(0, 1), running: new Set(['d']), now: NOW });
  const tpl = T.toTemplate(m, (action, id) => calls.push([action, id]));
  assert.deepStrictEqual(tpl[0], { label: 'Multi-Claude', enabled: false });
  assert.deepStrictEqual(tpl[1], { type: 'separator' });
  tpl[2].submenu[0].click();
  tpl.at(-1).click();
  assert.deepStrictEqual(calls, [['show', 'd'], ['quit', undefined]]);
});
