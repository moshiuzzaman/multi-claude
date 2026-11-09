'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const pr = require('../src/main/profiles.js');

test('slugify produces safe folder names', () => {
  assert.strictEqual(pr.slugify('Work'), 'work');
  assert.strictEqual(pr.slugify('My Personal Account'), 'my-personal-account');
  assert.strictEqual(pr.slugify('  Ünïcödé  '), 'unicode');
  assert.strictEqual(pr.slugify('a/b\\c:d*e?f'), 'a-b-c-d-e-f');
  assert.strictEqual(pr.slugify('---'), 'account');
  assert.strictEqual(pr.slugify(''), 'account');
  assert.ok(pr.slugify('x'.repeat(100)).length <= 40);
});

test('slugify avoids Windows reserved device names', () => {
  for (const n of ['CON', 'prn', 'AUX', 'nul', 'COM1', 'lpt9']) {
    const s = pr.slugify(n);
    assert.ok(!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(s), `${n} -> ${s}`);
  }
});

test('uniqueSlug resolves collisions', () => {
  assert.strictEqual(pr.uniqueSlug('work', new Set()), 'work');
  assert.strictEqual(pr.uniqueSlug('work', new Set(['work'])), 'work-2');
  assert.strictEqual(pr.uniqueSlug('work', new Set(['work', 'work-2'])), 'work-3');
});

test('newId is 8 hex chars and not repeated', () => {
  const a = pr.newId(), b = pr.newId();
  assert.match(a, /^[0-9a-f]{8}$/);
  assert.notStrictEqual(a, b);
});

test('dirSize sums nested files and tolerates a missing dir', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-size-'));
  fs.mkdirSync(path.join(base, 'sub'));
  fs.writeFileSync(path.join(base, 'a.bin'), Buffer.alloc(1000));
  fs.writeFileSync(path.join(base, 'sub', 'b.bin'), Buffer.alloc(2000));
  assert.strictEqual(await pr.dirSize(base), 3000);
  assert.strictEqual(await pr.dirSize(path.join(base, 'nope')), 0);
  fs.rmSync(base, { recursive: true, force: true });
});
