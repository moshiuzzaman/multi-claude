'use strict';
const test = require('node:test');
const assert = require('node:assert');
const S = require('../src/main/vscode-settings.js');

const DIR = 'C:\\Users\\me\\AppData\\Roaming\\multi-claude\\cc\\abc123';

test('readManaged returns null when there is no block', () => {
  assert.strictEqual(S.readManaged('{ "a": 1, }'), null);
});

test('writeManaged inserts a block and readManaged reads it back', () => {
  const out = S.writeManaged('{\n  "a": 1,\n}\n', DIR);
  assert.strictEqual(S.readManaged(out), DIR);
  assert.ok(out.includes('"a": 1,'), 'the original settings survive');
});

test('writeManaged replaces the block instead of adding a second one', () => {
  const once = S.writeManaged('{\n  "a": 1,\n}\n', DIR);
  const twice = S.writeManaged(once, 'C:\\other\\cc\\zz');
  assert.strictEqual(S.readManaged(twice), 'C:\\other\\cc\\zz');
  assert.strictEqual(twice.split(S.BEGIN).length - 1, 1, 'exactly one block');
  assert.ok(!twice.includes('abc123'), 'the old value is gone');
});

test('writeManaged leaves the rest of the file byte-identical', () => {
  const before = '{\n  // mine\n  "a": 1,\n  "b": [1, 2,],\n}\n';
  const out = S.writeManaged(before, DIR);
  const at = out.indexOf(S.END) + S.END.length;
  assert.strictEqual(out.slice(0, 1) + out.slice(at), before, 'only the block was added');
  assert.strictEqual(S.writeManaged(out, DIR), out, 'a second identical write changes nothing');
});

test('writeManaged escapes backslashes so the file stays valid', () => {
  const out = S.writeManaged('{}', DIR);
  assert.ok(out.includes('\\\\Users\\\\me'), 'backslashes are doubled');
});

test('writeManaged never puts the closing brace inside the end comment', () => {
  for (const before of ['{}', '{ "a": 1 }']) {
    const out = S.writeManaged(before, DIR);
    const endLine = out.slice(out.indexOf(S.END)).split(/\r?\n/)[0];
    assert.strictEqual(endLine, S.END, `nothing follows the end marker on its line for ${before}`);
    assert.ok(out.trimEnd().endsWith('}'));
  }
});

test('writeManaged builds a whole file from an empty string', () => {
  const out = S.writeManaged('', DIR);
  assert.ok(out.trimStart().startsWith('{'));
  assert.ok(out.trimEnd().endsWith('}'));
  assert.strictEqual(S.readManaged(out), DIR);
});

test('writeManaged keeps the file CRLF when it already is', () => {
  const out = S.writeManaged('{\r\n  "a": 1,\r\n}\r\n', DIR);
  assert.ok(!/[^\r]\n/.test(out), 'no bare LF was introduced');
  assert.strictEqual(S.readManaged(out), DIR);
});

test('readManaged returns null for a block with no value', () => {
  assert.strictEqual(S.readManaged(`{\n  ${S.BEGIN}\n  ${S.END}\n}\n`), null);
});

test('hasForeignKey is false when the only key is ours', () => {
  assert.strictEqual(S.hasForeignKey(S.writeManaged('{}', DIR)), false);
});

test('hasForeignKey is true when the user set the key themselves', () => {
  const text = '{\n  "claudeCode.environmentVariables": [],\n}\n';
  assert.strictEqual(S.hasForeignKey(text), true);
  assert.strictEqual(S.hasForeignKey(S.writeManaged(text, DIR)), true);
});
