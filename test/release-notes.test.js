'use strict';
const test = require('node:test');
const assert = require('node:assert');

// The renderer's helpers are ES modules; Node loads them by detecting the syntax.
const load = () => import('../src/renderer/lib/release-notes.js');

test('headings, bullets and paragraphs become blocks', async () => {
  const { notesToBlocks } = await load();
  assert.deepStrictEqual(notesToBlocks("## What's Changed\n- Fixed the **logo** link\n\nThanks!"), [
    { type: 'h', text: "What's Changed" },
    { type: 'li', text: 'Fixed the logo link' },
    { type: 'p', text: 'Thanks!' }
  ]);
});

test('links keep their text and lose the address; HTML is dropped', async () => {
  const { notesToBlocks } = await load();
  assert.deepStrictEqual(notesToBlocks('* See [the PR](https://github.com/o/r/pull/1) <!-- note --> `now`'), [
    { type: 'li', text: 'See the PR  now' }
  ]);
});

test('empty notes give no blocks', async () => {
  const { notesToBlocks } = await load();
  assert.deepStrictEqual(notesToBlocks(''), []);
  assert.deepStrictEqual(notesToBlocks(null), []);
});
