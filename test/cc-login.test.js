'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const L = require('../src/main/cc-login.js');

const URL_OK = 'https://claude.com/cai/oauth/authorize?code=true&client_id=x&state=y';

/** A fake child process: emits output on demand, records what it was sent. */
function fakeChild() {
  const c = new EventEmitter();
  c.stdout = new EventEmitter();
  c.stderr = new EventEmitter();
  c.written = [];
  c.stdin = { write: (s) => { c.written.push(s); } };
  c.killed = false;
  c.kill = () => { c.killed = true; };
  return c;
}

function manager(opts = {}) {
  const spawned = [];
  const opened = [];
  const m = L.createLoginManager({
    spawnImpl: (cmd, args, o) => { const c = fakeChild(); spawned.push({ cmd, args, o, c }); return c; },
    openExternal: (u) => opened.push(u),
    ...opts
  });
  return { m, spawned, opened };
}

test('start runs the official login hidden, against the account config dir', () => {
  const { m, spawned } = manager();
  const st = m.start('a1', { cliPath: 'C:\\cc\\claude.exe', configDir: 'C:\\cc\\a1' });
  assert.strictEqual(st.state, 'waiting');
  assert.deepStrictEqual(spawned[0].args, ['auth', 'login']);
  assert.strictEqual(spawned[0].o.env.CLAUDE_CONFIG_DIR, 'C:\\cc\\a1');
  assert.strictEqual(spawned[0].o.windowsHide, true, 'no terminal window');
});

test('start passes --email when given', () => {
  const { m, spawned } = manager();
  m.start('a1', { cliPath: 'x', configDir: 'd', email: 'me@x.com' });
  assert.deepStrictEqual(spawned[0].args, ['auth', 'login', '--email', 'me@x.com']);
});

test('a successful exit marks the sign-in done', () => {
  const { m, spawned } = manager();
  m.start('a1', { cliPath: 'x', configDir: 'd' });
  spawned[0].c.emit('exit', 0);
  assert.strictEqual(m.status('a1').state, 'done');
});

test('a failed exit surfaces the CLI message with URLs stripped', () => {
  const { m, spawned } = manager();
  m.start('a1', { cliPath: 'x', configDir: 'd' });
  spawned[0].c.stdout.emit('data', `Opening browser…\nIf the browser didn't open, visit: ${URL_OK}\n`);
  spawned[0].c.stdout.emit('data', "Login failed: That code wasn't accepted.\n");
  spawned[0].c.emit('exit', 1);
  const st = m.status('a1');
  assert.strictEqual(st.state, 'failed');
  assert.match(st.message, /That code wasn't accepted/);
  assert.ok(!st.message.includes('https://'));
});

test('failureMessage drops the prompt the CLI prints on the same line', () => {
  // Exactly what Claude Code 2.1.319 printed when given a bad code.
  const out = "Paste code here if prompted > Login failed: That code wasn't accepted. Sign in again.";
  assert.strictEqual(L.failureMessage(out), "Login failed: That code wasn't accepted. Sign in again.");
});

test('submit writes the code to stdin and does not keep it', () => {
  const { m, spawned } = manager();
  m.start('a1', { cliPath: 'x', configDir: 'd' });
  const st = m.submit('a1', '  ABC123#xyz  ');
  assert.strictEqual(st.state, 'checking');
  assert.deepStrictEqual(spawned[0].c.written, ['ABC123#xyz\n']);
  assert.ok(!JSON.stringify(m.status('a1')).includes('ABC123'), 'status never echoes the code');
});

test('submit rejects multi-line input so nothing extra reaches the CLI', () => {
  const { m, spawned } = manager();
  m.start('a1', { cliPath: 'x', configDir: 'd' });
  assert.throws(() => m.submit('a1', 'abc\nsecond line'), (e) => e.code === 'bad_code');
  assert.throws(() => m.submit('a1', '   '), (e) => e.code === 'bad_code');
  assert.deepStrictEqual(spawned[0].c.written, []);
});

test('submit without a running sign-in is refused', () => {
  const { m } = manager();
  assert.throws(() => m.submit('nobody', 'abc'), (e) => e.code === 'no_login');
});

test('cancel kills the hidden process and ignores its later exit', () => {
  const { m, spawned } = manager();
  m.start('a1', { cliPath: 'x', configDir: 'd' });
  m.cancel('a1');
  assert.strictEqual(spawned[0].c.killed, true);
  spawned[0].c.emit('exit', 1);
  assert.strictEqual(m.status('a1').state, 'cancelled', 'a cancel is not reported as a failure');
});

test('starting again replaces the previous attempt', () => {
  const { m, spawned } = manager();
  m.start('a1', { cliPath: 'x', configDir: 'd' });
  m.start('a1', { cliPath: 'x', configDir: 'd' });
  assert.strictEqual(spawned[0].c.killed, true);
  assert.strictEqual(spawned.length, 2);
});

test('openPage opens only the URL the CLI printed, only on Anthropic hosts', () => {
  const { m, spawned, opened } = manager();
  m.start('a1', { cliPath: 'x', configDir: 'd' });
  assert.throws(() => m.openPage('a1'), (e) => e.code === 'no_page', 'nothing printed yet');
  spawned[0].c.stdout.emit('data', `visit: ${URL_OK}\n`);
  m.openPage('a1');
  assert.deepStrictEqual(opened, [URL_OK]);
});

test('a printed URL on a foreign host is never opened', () => {
  const { m, spawned, opened } = manager();
  m.start('a1', { cliPath: 'x', configDir: 'd' });
  spawned[0].c.stdout.emit('data', 'visit: https://evil.example/oauth/authorize?x=1\n');
  assert.throws(() => m.openPage('a1'), (e) => e.code === 'no_page');
  assert.deepStrictEqual(opened, []);
});

test('hostAllowed accepts Anthropic hosts over https only', () => {
  assert.ok(L.hostAllowed('https://claude.com/x'));
  assert.ok(L.hostAllowed('https://platform.claude.com/x'));
  assert.ok(L.hostAllowed('https://claude.ai/x'));
  assert.ok(!L.hostAllowed('http://claude.com/x'));
  assert.ok(!L.hostAllowed('https://claude.com.evil.example/x'));
  assert.ok(!L.hostAllowed('not a url'));
});

test('a stuck sign-in times out and is killed', async () => {
  const { m, spawned } = manager({ timeoutMs: 20 });
  m.start('a1', { cliPath: 'x', configDir: 'd' });
  await new Promise((r) => setTimeout(r, 60));
  assert.strictEqual(m.status('a1').state, 'failed');
  assert.match(m.status('a1').message, /timed out/);
  assert.strictEqual(spawned[0].c.killed, true);
});
