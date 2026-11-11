'use strict';
const test = require('node:test');
const assert = require('node:assert');

// The renderer's helpers are ES modules; Node loads them by detecting the syntax.
const load = () => import('../src/renderer/lib/format.js');

const NOW = Date.UTC(2026, 10, 11, 10, 0, 0);
const H = 3600e3;

test('timeLeft shows days and hours for a weekly reset', async () => {
  const { timeLeft } = await load();
  assert.strictEqual(timeLeft(NOW + 27 * H + 20 * 60e3, NOW), '1d 3h remaining');
});

test('timeLeft drops to hours and minutes inside the last day', async () => {
  const { timeLeft } = await load();
  assert.strictEqual(timeLeft(NOW + 5 * H + 12 * 60e3, NOW), '5h 12m remaining');
});

test('timeLeft says the window is resetting once the time has passed', async () => {
  const { timeLeft } = await load();
  assert.strictEqual(timeLeft(NOW - 1000, NOW), 'Resetting now');
});

test('timeLeft is empty when there is no reset time', async () => {
  const { timeLeft } = await load();
  assert.strictEqual(timeLeft(null, NOW), '');
});

test('releaseDate formats a GitHub date and hides a malformed one', async () => {
  const { releaseDate } = await load();
  assert.ok(/2026/.test(releaseDate('2026-11-11T10:00:00Z')));
  assert.strictEqual(releaseDate('not a date'), '');
  assert.strictEqual(releaseDate(null), '');
});
