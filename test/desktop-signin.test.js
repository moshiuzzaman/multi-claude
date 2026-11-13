'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readDesktopSignIn } = require('../src/main/desktop-signin.js');

function profile(config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-dsi-'));
  if (config !== undefined) {
    fs.writeFileSync(path.join(dir, 'config.json'), typeof config === 'string' ? config : JSON.stringify(config));
  }
  return dir;
}

test('a signed-in Claude window has a token cache and an account id', () => {
  const dir = profile({ 'oauth:tokenCacheV2': 'opaque', lastKnownAccountUuid: 'u', windowSizeWasSignedIn: true });
  assert.strictEqual(readDesktopSignIn(dir), true);
});

test('a window that was never signed in reads as signed out', () => {
  const dir = profile({ locale: 'en-US', windowSizeWasSignedIn: false, lastGoodMainViewLoad: 1 });
  assert.strictEqual(readDesktopSignIn(dir), false);
});

test('a brand-new profile with no settings yet reads as signed out', () => {
  assert.strictEqual(readDesktopSignIn(profile()), false);
});

test("settings that can't be read, or no folder, can't be told", () => {
  assert.strictEqual(readDesktopSignIn(profile('{ not json')), null);
  assert.strictEqual(readDesktopSignIn(path.join(os.tmpdir(), 'mc-dsi-nope-' + Date.now())), null);
  assert.strictEqual(readDesktopSignIn(''), null);
});

test('only setting names are used: token values are never needed', () => {
  // A getter on the token value would throw if anything tried to read it.
  const dir = profile({ 'oauth:tokenCache': 'x', lastKnownAccountUuid: 'u' });
  const real = fs.readFileSync;
  const fsImpl = { ...fs, readFileSync: (...a) => real(...a) };
  assert.strictEqual(readDesktopSignIn(dir, fsImpl), true);
});
