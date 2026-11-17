'use strict';
const test = require('node:test');
const assert = require('node:assert');

// The renderer's helpers are ES modules; Node loads them by detecting the syntax.
const load = () => import('../src/renderer/lib/chatSearch.js');

const CHATS = [
  { id: 'a', title: 'Fix the delete dialog', cwd: 'C:\\Users\\Bob\\Music\\multi-Claude' },
  { id: 'b', title: 'Plan Bangla-English learning app', cwd: 'C:\\projects\\baby-learning' },
  { id: 'c', title: null, cwd: 'E:\\AR-VR\\omnizia' },
  { id: 'd', title: 'Tour setup', cwd: null }
];

test('an empty search matches every chat', async () => {
  const { filterChats } = await load();
  assert.strictEqual(filterChats(CHATS, '').length, 4);
  assert.strictEqual(filterChats(CHATS, '   ').length, 4);
});

test('search matches the title or the project folder, ignoring case', async () => {
  const { filterChats } = await load();
  assert.deepStrictEqual(filterChats(CHATS, 'DELETE').map((c) => c.id), ['a']);
  assert.deepStrictEqual(filterChats(CHATS, 'omnizia').map((c) => c.id), ['c']);
  assert.deepStrictEqual(filterChats(CHATS, 'multi-claude').map((c) => c.id), ['a']);
});

test('every word must match, in any order and either field', async () => {
  const { filterChats } = await load();
  assert.deepStrictEqual(filterChats(CHATS, 'learning bangla').map((c) => c.id), ['b']);
  assert.deepStrictEqual(filterChats(CHATS, 'dialog multi').map((c) => c.id), ['a']);
  assert.deepStrictEqual(filterChats(CHATS, 'dialog omnizia'), []);
});

test('an untitled chat is found as "Untitled chat"', async () => {
  const { filterChats } = await load();
  assert.deepStrictEqual(filterChats(CHATS, 'untitled').map((c) => c.id), ['c']);
});
