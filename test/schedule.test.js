'use strict';
const test = require('node:test');
const assert = require('node:assert');
const s = require('../src/main/schedule.js');
const send = require('../src/main/scheduled-send.js');
const { EventEmitter } = require('node:events');

// Local times, so the tests hold in any time zone. 18 Nov 2026 is a Wednesday.
const at = (d, h, m = 0) => new Date(2026, 10, d, h, m).getTime();
const on = (extra = {}) => ({ on: true, times: ['09:00', '14:00', '19:00'], ...extra });

test('normaliseSchedule: defaults, cleans times and days, keeps a good message', () => {
  assert.deepStrictEqual(s.normaliseSchedule(undefined), {
    on: false, times: ['09:00'], days: [0, 1, 2, 3, 4, 5, 6], message: 'hi'
  });
  const n = s.normaliseSchedule({ on: true, times: ['14:00', '9:0', 'nope', '25:00', '09:00'], days: [5, 1, 9, 1], message: '  hello  ' });
  assert.deepStrictEqual(n.times, ['09:00', '14:00']);
  assert.deepStrictEqual(n.days, [1, 5]);
  assert.strictEqual(n.message, 'hello');
  assert.deepStrictEqual(s.normaliseSchedule({ days: [] }).days, [0, 1, 2, 3, 4, 5, 6]);
  assert.strictEqual(s.normaliseSchedule({ message: '--help' }).message, 'hi');
  assert.strictEqual(s.normaliseSchedule({ message: 'x'.repeat(501) }).message, 'hi');
});

test('dueSlot: nothing before the first time, the time once it passes', () => {
  const last = at(18, 8);
  assert.strictEqual(s.dueSlot(on(), at(18, 8, 59), last), null);
  assert.strictEqual(s.dueSlot(on(), at(18, 9, 0), last), at(18, 9));
  assert.strictEqual(s.dueSlot(on(), at(18, 9, 1), last), at(18, 9));
  // Already handled: not again.
  assert.strictEqual(s.dueSlot(on(), at(18, 9, 30), at(18, 9)), null);
});

test('dueSlot: after missing several times, only the latest is due', () => {
  assert.strictEqual(s.dueSlot(on(), at(18, 15), at(17, 20)), at(18, 14));
  // Asleep for two days: still only one, the newest.
  assert.strictEqual(s.dueSlot(on(), at(20, 10), at(18, 9)), at(20, 9));
});

test('dueSlot: off, or a day not chosen, sends nothing', () => {
  assert.strictEqual(s.dueSlot({ ...on(), on: false }, at(18, 10), at(18, 8)), null);
  // Wednesday is 3; only Thursday chosen.
  assert.strictEqual(s.dueSlot(on({ days: [4] }), at(18, 20), at(18, 8)), null);
  assert.strictEqual(s.dueSlot(on({ days: [4] }), at(19, 9, 5), at(18, 8)), at(19, 9));
});

test('dueSlot: no record yet means nothing is due', () => {
  assert.strictEqual(s.dueSlot(on(), at(18, 23), undefined), null);
});

test('nextSlot: the next time, on the next chosen day', () => {
  assert.strictEqual(s.nextSlot(on(), at(18, 10)), at(18, 14));
  assert.strictEqual(s.nextSlot(on(), at(18, 19)), at(19, 9));
  assert.strictEqual(s.nextSlot(on({ days: [1] }), at(18, 10)), at(23, 9));
  assert.strictEqual(s.nextSlot({ ...on(), on: false }, at(18, 10)), null);
});

test('buildArgs: message first, resume only with a chat, cheapest model, no tools', () => {
  assert.deepStrictEqual(send.buildArgs('hi', null).slice(0, 2), ['-p', 'hi']);
  assert.ok(!send.buildArgs('hi', null).includes('--resume'));
  const a = send.buildArgs('hi', 'abc');
  assert.deepStrictEqual(a.slice(2, 4), ['--resume', 'abc']);
  assert.ok(a.includes('haiku'));
  assert.deepStrictEqual(a.slice(a.indexOf('--tools'), a.indexOf('--tools') + 2), ['--tools', '']);
});

test('parseSendOutput: success, limit reached, signed out, missing chat', () => {
  const ok = send.parseSendOutput('warning\n' + JSON.stringify({ type: 'result', is_error: false, session_id: 's1', result: 'Hello!' }));
  assert.deepStrictEqual(ok, { ok: true, sessionId: 's1', reply: 'Hello!' });

  const limit = send.parseSendOutput(JSON.stringify({
    type: 'result', is_error: true, session_id: 's2', api_error_status: 429,
    api_error: 'usage_limit_reached', result: "You've hit your weekly limit · resets Nov 21, 6pm"
  }));
  assert.strictEqual(limit.ok, false);
  assert.strictEqual(limit.limitReached, true);
  assert.match(limit.reason, /weekly limit/);

  const out = send.parseSendOutput(JSON.stringify({ type: 'result', is_error: true, result: 'Not logged in · Please run /login' }));
  assert.strictEqual(out.needsSignIn, true);

  const gone = send.parseSendOutput(JSON.stringify({ type: 'result', is_error: true, result: 'No conversation found with session ID: x' }));
  assert.strictEqual(gone.noChat, true);

  assert.strictEqual(send.parseSendOutput('').ok, false);
});

test('sendMessage: no shell, hidden, the account folder, and the reply', async () => {
  let seen;
  const spawnImpl = (file, args, opts) => {
    seen = { file, args, opts };
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    setImmediate(() => {
      child.stdout.emit('data', JSON.stringify({ type: 'result', is_error: false, session_id: 's9', result: 'Hi' }));
      child.emit('exit', 0);
    });
    return child;
  };
  const r = await send.sendMessage('C:\\cc\\claude.exe', 'C:\\cfg\\cc\\a1', { message: 'hi', cwd: 'C:\\cfg\\cc\\a1\\scheduled', spawnImpl });
  assert.deepStrictEqual(r, { ok: true, sessionId: 's9', reply: 'Hi' });
  assert.strictEqual(seen.opts.shell, false);
  assert.strictEqual(seen.opts.windowsHide, true);
  assert.strictEqual(seen.opts.env.CLAUDE_CONFIG_DIR, 'C:\\cfg\\cc\\a1');
  assert.strictEqual(seen.opts.cwd, 'C:\\cfg\\cc\\a1\\scheduled');
});
