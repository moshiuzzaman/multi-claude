'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readAccountInfo, pickSafe } = require('../src/main/account-info.js');

function tmpJson(obj) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-acct-'));
  const f = path.join(d, '.claude.json');
  fs.writeFileSync(f, typeof obj === 'string' ? obj : JSON.stringify(obj));
  return f;
}

test('pickSafe keeps descriptive fields', () => {
  const out = pickSafe({
    emailAddress: 'a@b.com',
    organizationName: 'Acme',
    seatTier: 'team',
    billingType: 'seat',
    userRateLimitTier: 'tier_3',
    hasExtraUsageEnabled: true,
    accountCreatedAt: '2025-01-01'
  });
  assert.strictEqual(out.emailAddress, 'a@b.com');
  assert.strictEqual(out.organizationName, 'Acme');
  assert.strictEqual(out.seatTier, 'team');
  assert.strictEqual(out.hasExtraUsageEnabled, true);
});

test('pickSafe drops anything not on the allowlist', () => {
  const out = pickSafe({
    emailAddress: 'a@b.com',
    accessToken: 'SECRET-TOKEN',
    refreshToken: 'SECRET-REFRESH',
    apiKey: 'sk-ant-SECRET',
    sessionKey: 'SECRET'
  });
  const json = JSON.stringify(out);
  assert.ok(!json.includes('SECRET'), 'no credential-shaped value may survive');
  assert.deepStrictEqual(Object.keys(out), ['emailAddress']);
});

test('pickSafe drops nested objects even on allowlisted keys', () => {
  const out = pickSafe({ emailAddress: { nested: 'SECRET' }, organizationName: 'Acme' });
  assert.ok(!('emailAddress' in out), 'a non-primitive is not carried out');
  assert.strictEqual(out.organizationName, 'Acme');
});

test('readAccountInfo returns the account when present', async () => {
  const f = tmpJson({ oauthAccount: { emailAddress: 'x@y.com', organizationName: 'Org' }, other: 1 });
  const r = await readAccountInfo(f);
  assert.strictEqual(r.available, true);
  assert.strictEqual(r.account.emailAddress, 'x@y.com');
});

test('readAccountInfo reports a missing file rather than throwing', async () => {
  const r = await readAccountInfo(path.join(os.tmpdir(), 'definitely-absent-' + Date.now() + '.json'));
  assert.strictEqual(r.available, false);
  assert.match(r.reason, /not found/i);
});

test('readAccountInfo reports malformed json', async () => {
  const r = await readAccountInfo(tmpJson('{ not json'));
  assert.strictEqual(r.available, false);
  assert.match(r.reason, /readable JSON/i);
});

test('readAccountInfo reports a config with no signed-in account', async () => {
  const r = await readAccountInfo(tmpJson({ numStartups: 3 }));
  assert.strictEqual(r.available, false);
  assert.match(r.reason, /No account/i);
});
