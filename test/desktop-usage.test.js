'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readDesktopUsage } = require('../src/main/desktop-usage.js');

function profile(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-du-'));
  if (content !== undefined) {
    fs.writeFileSync(path.join(dir, 'plan-usage-history.json'),
      typeof content === 'string' ? content : JSON.stringify(content));
  }
  return dir;
}

test('the newest sample wins, whatever order the file is in', () => {
  const dir = profile({ version: 2, samples: [
    { t: 3000, org: 'o', u: { fh: 7, sd: 39, xu: 0 } },
    { t: 1000, org: 'o', u: { fh: 90, sd: 90 } },
    { t: 2000, org: 'o', u: { fh: 50, sd: 50 } }
  ] });
  assert.deepStrictEqual(readDesktopUsage(dir), { recordedAt: 3000, session: 7, weekly: 39, extra: 0 });
});

test('a missing extra-usage figure is null, not zero', () => {
  const dir = profile({ version: 2, samples: [{ t: 5, u: { fh: 1, sd: 2 } }] });
  assert.strictEqual(readDesktopUsage(dir).extra, null);
});

test('odd values are clamped or dropped, never shown as nonsense', () => {
  const dir = profile({ version: 2, samples: [{ t: 9, u: { fh: 140, sd: -3 } }] });
  const u = readDesktopUsage(dir);
  assert.strictEqual(u.session, 100);
  assert.strictEqual(u.weekly, null);
});

test('no file, a broken file or no usable sample gives null', () => {
  assert.strictEqual(readDesktopUsage(profile()), null);
  assert.strictEqual(readDesktopUsage(profile('{ nope')), null);
  assert.strictEqual(readDesktopUsage(profile({ version: 2, samples: [{ t: 0, u: { fh: 5 } }, { t: 4 }] })), null);
  assert.strictEqual(readDesktopUsage(profile({ version: 2, samples: [{ t: 4, u: {} }] })), null);
  assert.strictEqual(readDesktopUsage(''), null);
});
