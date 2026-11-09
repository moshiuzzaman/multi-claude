'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const U = require('../src/main/cc-usage.js');

const line = (o) => JSON.stringify(o);

// Shaped exactly like what Claude Code 2.1.319 printed for `-p /usage`.
const REAL = [
  'Warning: no stdin data received in 3s, proceeding without it.',
  line({ type: 'system', subtype: 'init', session_id: 's' }),
  line({
    type: 'assistant',
    message: { content: [{ type: 'text', text: 'Current session: 52% used' }] },
    usage_report: {
      session: { total_cost_usd: 0 },
      rate_limits: {
        limits: [
          { kind: 'session', group: 'session', percent: 52, resets_at: '2026-11-09T17:39:59.581261+00:00', severity: 'normal', is_active: true },
          { kind: 'weekly_all', group: 'weekly', percent: 8, resets_at: '2026-11-16T11:59:59.581280+00:00', severity: 'normal', is_active: false }
        ],
        extra_usage: { is_enabled: false, monthly_limit: 1400, used_credits: 0, utilization: 0, currency: 'USD' }
      }
    }
  }),
  line({ type: 'result', subtype: 'success', num_turns: 0, total_cost_usd: 0, modelUsage: {} })
].join('\n');

test('parses the real /usage report into meters', () => {
  const r = U.parseUsageOutput(REAL);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.reachedModel, false);
  assert.strictEqual(r.meters.length, 2);
  assert.deepStrictEqual(
    r.meters.map((m) => [m.kind, m.percent, m.title, m.isActive]),
    [['session', 52, 'Session (5hr)', true], ['weekly_all', 8, 'Weekly (all models)', false]]
  );
  assert.strictEqual(r.meters[0].resetsAt, Date.parse('2026-11-09T17:39:59.581261+00:00'));
  assert.deepStrictEqual(r.extraUsage, { enabled: false, monthlyLimit: 1400, usedCredits: 0, currency: 'USD' });
});

test('a scoped weekly meter is titled by its scope', () => {
  const text = REAL.replace(
    "\"limits\":[",
    "\"limits\":[{\"kind\":\"weekly_scoped\",\"group\":\"weekly\",\"percent\":30,\"resets_at\":null,\"scope\":{\"model\":{\"display_name\":\"Opus\"}},\"severity\":\"warning\",\"is_active\":false},"
  );
  const r = U.parseUsageOutput(text);
  const scoped = r.meters.find((m) => m.kind === 'weekly_scoped');
  assert.strictEqual(scoped.title, 'Weekly · Opus');
  assert.strictEqual(scoped.severity, 'warning');
  assert.strictEqual(scoped.resetsAt, null);
});

test('a fetch that reached a model is flagged, never shown as data', () => {
  // What happened when a shell mangled "/usage" into a path: one real turn.
  const text = [
    line({ type: 'assistant', message: { content: [{ type: 'text', text: "I can't access C:/Program Files/Git/usage" }] } }),
    line({ type: 'result', num_turns: 1, total_cost_usd: 0.138, modelUsage: { 'claude-haiku-5-5': {} } })
  ].join('\n');
  const r = U.parseUsageOutput(text);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reachedModel, true);
});

test('a plan without limits is reported as such', () => {
  const text = [
    line({ type: 'assistant', usage_report: { session: {}, rate_limits: null } }),
    line({ type: 'result', num_turns: 0, modelUsage: {} })
  ].join('\n');
  const r = U.parseUsageOutput(text);
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /does not report usage limits/);
});

test('an expired sign-in asks for a new one', () => {
  const text = [
    line({ type: 'assistant', error: 'authentication_failed', message: { content: [] } }),
    line({ type: 'result', num_turns: 0, modelUsage: {} })
  ].join('\n');
  const r = U.parseUsageOutput(text);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.needsSignIn, true);
});

test('percent is clamped and unknown severity falls back to normal', () => {
  const text = [
    line({ type: 'assistant', usage_report: { rate_limits: { limits: [
      { kind: 'session', group: 'session', percent: 140, resets_at: null, severity: 'purple', is_active: true }
    ] } } }),
    line({ type: 'result', num_turns: 0, modelUsage: {} })
  ].join('\n');
  const m = U.parseUsageOutput(text).meters[0];
  assert.strictEqual(m.percent, 100);
  assert.strictEqual(m.severity, 'normal');
});

test('the fetch never goes through a shell and passes /usage untouched', async () => {
  let seen = null;
  const fake = (cmd, args, opts) => {
    seen = { cmd, args, opts };
    const c = new EventEmitter();
    c.stdout = new EventEmitter();
    c.stderr = new EventEmitter();
    c.kill = () => {};
    setImmediate(() => { c.stdout.emit('data', REAL); c.emit('exit', 0); });
    return c;
  };
  const r = await U.fetchUsage('C:\\cc\\claude.exe', 'C:\\cc\\a1', { spawnImpl: fake });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(seen.args[0], '-p');
  assert.strictEqual(seen.args[1], '/usage', 'must reach the CLI exactly as /usage');
  assert.strictEqual(seen.opts.shell, false);
  assert.strictEqual(seen.opts.env.CLAUDE_CONFIG_DIR, 'C:\\cc\\a1');
  assert.deepStrictEqual(seen.opts.stdio, ['ignore', 'pipe', 'pipe']);
  assert.ok(seen.args.includes('--no-session-persistence'));
  assert.ok(seen.args.includes('haiku'), 'cheapest model as a safety net');
});

test('the fetch times out instead of hanging', async () => {
  const fake = () => {
    const c = new EventEmitter();
    c.stdout = new EventEmitter();
    c.stderr = new EventEmitter();
    c.kill = () => {};
    return c; // never exits
  };
  const r = await U.fetchUsage('x', 'y', { spawnImpl: fake, timeoutMs: 20 });
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /too long/);
});
