'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { summariseSession, scanUsage } = require('../src/main/usage-reader.js');
const { buildDashboard, dayRange, projectName } = require('../src/main/usage-aggregate.js');

// A miniature session log in the real shape, including the records we must ignore.
function line(o) { return JSON.stringify(o); }

const SESSION_A = [
  line({ type: 'user', sessionId: 's1', cwd: 'C:\\Users\\Bob\\Documents\\alpha', timestamp: '2026-11-01T10:00:00.000Z' }),
  line({
    type: 'assistant', sessionId: 's1', timestamp: '2026-11-01T10:00:05.000Z',
    message: {
      model: 'claude-opus-5-5',
      usage: {
        input_tokens: 10, output_tokens: 100,
        cache_read_input_tokens: 1000, cache_creation_input_tokens: 50,
        output_tokens_details: { thinking_tokens: 30 }
      }
    }
  }),
  line({
    type: 'assistant', sessionId: 's1', timestamp: '2026-11-02T09:00:00.000Z',
    message: {
      model: 'claude-sonnet-5-5',
      usage: { input_tokens: 5, output_tokens: 20, cache_read_input_tokens: 200, cache_creation_input_tokens: 0 }
    }
  }),
  line({ type: 'attachment', sessionId: 's1', attachment: { organizationUuid: 'org-1' } }),
  line({ type: 'cost-state', sessionId: 's1', totalCostUSD: 1.25 })
].join('\n');

test('summariseSession extracts totals, models, days, org and cost', () => {
  const s = summariseSession(SESSION_A, 'C:\\x\\s1.jsonl');
  assert.strictEqual(s.sessionId, 's1');
  assert.strictEqual(s.org, 'org-1');
  assert.strictEqual(s.costUSD, 1.25);
  assert.strictEqual(s.costRecorded, true);
  assert.strictEqual(s.project, 'C:\\Users\\Bob\\Documents\\alpha');

  assert.strictEqual(s.totals.input, 15);
  assert.strictEqual(s.totals.output, 120);
  assert.strictEqual(s.totals.cacheRead, 1200);
  assert.strictEqual(s.totals.cacheWrite, 50);
  assert.strictEqual(s.totals.thinking, 30);
  assert.strictEqual(s.totals.messages, 2);

  assert.deepStrictEqual(Object.keys(s.byModel).sort(), ['claude-opus-5-5', 'claude-sonnet-5-5']);
  assert.strictEqual(s.byModel['claude-opus-5-5'].output, 100);
  assert.strictEqual(Object.keys(s.byDay).length, 2);
});

test('summariseSession ignores synthetic model entries', () => {
  const text = [
    line({ type: 'assistant', sessionId: 's', timestamp: '2026-11-01T10:00:00.000Z',
      message: { model: '<synthetic>', usage: { input_tokens: 1, output_tokens: 1 } } })
  ].join('\n');
  const s = summariseSession(text, 'f');
  assert.strictEqual(s.totals.messages, 1, 'still counted in totals');
  assert.deepStrictEqual(Object.keys(s.byModel), [], 'but not attributed to a model');
});

test('summariseSession returns null when there is nothing usable', () => {
  const text = [
    line({ type: 'user', sessionId: 's', cwd: 'C:\\x' }),
    line({ type: 'file-history-snapshot', sessionId: 's' })
  ].join('\n');
  assert.strictEqual(summariseSession(text, 'f'), null);
});

test('summariseSession survives malformed lines', () => {
  const text = ['{ not json', SESSION_A, ''].join('\n');
  const s = summariseSession(text, 'f');
  assert.ok(s);
  assert.strictEqual(s.totals.output, 120);
});

test('summariseSession never retains message text', () => {
  const text = line({
    type: 'assistant', sessionId: 's', timestamp: '2026-11-01T10:00:00.000Z',
    message: {
      model: 'claude-opus-5-5',
      content: [{ type: 'text', text: 'SECRET PROMPT CONTENT' }],
      usage: { input_tokens: 1, output_tokens: 1 }
    }
  });
  const s = summariseSession(text, 'f');
  assert.ok(!JSON.stringify(s).includes('SECRET'), 'summary must not carry message content');
});

test('session-owner supplies org and accountUuid', () => {
  const text = line({
    type: 'session-owner', sessionId: 's', accountUuid: 'acct-9', organizationUuid: 'org-9'
  }) + '\n' + line({
    type: 'assistant', sessionId: 's', timestamp: '2026-11-01T10:00:00.000Z',
    message: { model: 'm', usage: { input_tokens: 1, output_tokens: 2 } }
  });
  const s = summariseSession(text, 'f');
  assert.strictEqual(s.org, 'org-9');
  assert.strictEqual(s.accountUuid, 'acct-9');
});

// --- scanUsage caching ------------------------------------------------------

function fakeFs(files) {
  return {
    readdirSync: (dir) => {
      const names = new Set();
      for (const p of Object.keys(files)) {
        if (p.startsWith(dir + '\\')) {
          const rest = p.slice(dir.length + 1).split('\\');
          names.add(rest[0] + (rest.length > 1 ? '/dir' : ''));
        }
      }
      return [...names].map((n) => {
        const isDir = n.endsWith('/dir');
        const name = isDir ? n.slice(0, -4) : n;
        return { name, isDirectory: () => isDir };
      });
    },
    statSync: (p) => ({ mtimeMs: files[p].mtimeMs, size: files[p].text.length }),
    readFileSync: (p) => files[p].text
  };
}

test('scanUsage reuses cached summaries for unchanged files', async () => {
  const files = { 'R\\a.jsonl': { mtimeMs: 100, text: SESSION_A } };
  const fsImpl = fakeFs(files);

  const first = await scanUsage({ projectsRoot: 'R', cache: {}, fsImpl });
  assert.strictEqual(first.parsed, 1);
  assert.strictEqual(first.reused, 0);
  assert.strictEqual(first.sessions.length, 1);

  const second = await scanUsage({ projectsRoot: 'R', cache: first.cache, fsImpl });
  assert.strictEqual(second.parsed, 0);
  assert.strictEqual(second.reused, 1);
  assert.strictEqual(second.sessions.length, 1);
});

test('scanUsage re-parses a file whose mtime changed', async () => {
  const files = { 'R\\a.jsonl': { mtimeMs: 100, text: SESSION_A } };
  const fsImpl = fakeFs(files);
  const first = await scanUsage({ projectsRoot: 'R', cache: {}, fsImpl });

  files['R\\a.jsonl'].mtimeMs = 200;
  const second = await scanUsage({ projectsRoot: 'R', cache: first.cache, fsImpl });
  assert.strictEqual(second.parsed, 1);
  assert.strictEqual(second.reused, 0);
});

test('scanUsage caches the null result for files with no usage', async () => {
  const files = { 'R\\empty.jsonl': { mtimeMs: 1, text: line({ type: 'user', sessionId: 'x' }) } };
  const fsImpl = fakeFs(files);
  const first = await scanUsage({ projectsRoot: 'R', cache: {}, fsImpl });
  assert.strictEqual(first.sessions.length, 0);
  const second = await scanUsage({ projectsRoot: 'R', cache: first.cache, fsImpl });
  assert.strictEqual(second.parsed, 0, 'a file with no usage must not be re-parsed every time');
});

// --- aggregation ------------------------------------------------------------

const NOW = Date.parse('2026-11-03T12:00:00.000Z');

test('dayRange produces a continuous ascending window', () => {
  const r = dayRange(3, NOW);
  assert.strictEqual(r.length, 3);
  assert.ok(r[0] < r[1] && r[1] < r[2]);
});

test('buildDashboard totals, splits by model and project, and flags partial cost', () => {
  const s = summariseSession(SESSION_A, 'f');
  const d = buildDashboard([s], { days: 7, now: NOW });

  assert.strictEqual(d.totals.output, 120);
  assert.strictEqual(d.byModel.length, 2);
  assert.strictEqual(d.byProject[0].key, 'alpha');
  assert.strictEqual(d.cost.total, 1.25);
  assert.strictEqual(d.cost.sessions, 1);
  assert.strictEqual(d.cost.partial, false, 'one session, one cost record -> complete');
  assert.strictEqual(d.daily.length, 7);
  assert.ok(d.daily.every((x) => typeof x.date === 'string'));
});

test('buildDashboard separates attributed orgs from the unattributed bucket', () => {
  const withOrg = summariseSession(SESSION_A, 'a');
  const noOrg = summariseSession([
    line({ type: 'assistant', sessionId: 's2', timestamp: '2026-11-01T10:00:00.000Z',
      message: { model: 'm', usage: { input_tokens: 7, output_tokens: 7 } } })
  ].join('\n'), 'b');

  const d = buildDashboard([withOrg, noOrg], { days: 7, now: NOW });
  const orgs = Object.fromEntries(d.byOrg.map((o) => [o.key, o]));
  assert.ok(orgs['org-1'].attributed);
  assert.strictEqual(orgs['(unattributed)'].attributed, false);
  assert.strictEqual(d.coverage.sessions, 2);
  assert.strictEqual(d.coverage.attributedSessions, 1);
  assert.strictEqual(d.cost.partial, true, 'only one of two sessions recorded cost');
});

test('buildDashboard excludes days outside the window from the daily series', () => {
  const s = summariseSession(SESSION_A, 'f');
  const d = buildDashboard([s], { days: 1, now: NOW });
  assert.strictEqual(d.daily.length, 1);
  assert.strictEqual(d.windowTotals.output, 0, 'Nov 1-2 usage is outside a 1-day window ending Nov 3');
  assert.strictEqual(d.totals.output, 120, 'but all-time totals still include it');
});

test('byModel and byProject are ranked by the metric the UI displays', () => {
  // A model with huge cache reads but little output must NOT outrank one with
  // more output, because output is the number printed next to the bar.
  const heavyCache = summariseSession([
    line({ type: 'assistant', sessionId: 'c', cwd: 'C:\\p\\cacheheavy', timestamp: '2026-11-01T10:00:00Z',
      message: { model: 'cache-heavy', usage: { input_tokens: 1, output_tokens: 10, cache_read_input_tokens: 9_000_000 } } })
  ].join('\n'), 'a');

  const heavyOutput = summariseSession([
    line({ type: 'assistant', sessionId: 'o', cwd: 'C:\\p\\outputheavy', timestamp: '2026-11-01T10:00:00Z',
      message: { model: 'output-heavy', usage: { input_tokens: 1, output_tokens: 5000, cache_read_input_tokens: 10 } } })
  ].join('\n'), 'b');

  const d = buildDashboard([heavyCache, heavyOutput], { days: 7, now: NOW });
  assert.strictEqual(d.byModel[0].key, 'output-heavy', 'ranked by output, not by cache reads');
  assert.strictEqual(d.byProject[0].key, 'outputheavy');
  assert.ok(d.byModel[0].output > d.byModel[1].output, 'list order matches the printed numbers');
});

test('summariseSession attributes tokens to skills and plugins, and counts MCP calls', () => {
  const text = [
    line({
      type: 'assistant', sessionId: 's', timestamp: '2026-11-03T10:00:00Z',
      attributionSkill: 'superpowers:brainstorming',
      attributionPlugin: 'superpowers',
      message: {
        model: 'claude-opus-5-5',
        content: [
          { type: 'tool_use', name: 'mcp__Claude_Browser__navigate', input: { url: 'SECRET' } },
          { type: 'tool_use', name: 'mcp__ccd_turn__update_plan', input: { x: 'SECRET' } },
          { type: 'tool_use', name: 'Read', input: { path: 'SECRET' } }
        ],
        usage: { input_tokens: 10, output_tokens: 90 }
      }
    })
  ].join('\n');

  const s = summariseSession(text, 'f');
  assert.strictEqual(s.bySkill['superpowers:brainstorming'].output, 90);
  assert.strictEqual(s.byPlugin['superpowers'].output, 90);
  assert.strictEqual(s.byMcpCalls['Claude_Browser'], 1);
  assert.strictEqual(s.byMcpCalls['ccd_turn'], 1);
  assert.ok(!('Read' in s.byMcpCalls), 'non-MCP tools are not counted as servers');
  assert.ok(!JSON.stringify(s).includes('SECRET'), 'tool arguments must never be retained');
});

test('rolling windows sum only the hours inside them', () => {
  const now = Date.parse('2026-11-03T12:30:00');
  const mk = (iso, out) => line({
    type: 'assistant', sessionId: 's', timestamp: iso,
    message: { model: 'm', usage: { input_tokens: 0, output_tokens: out } }
  });

  const s = summariseSession([
    mk('2026-11-03T11:00:00', 100),   // ~1.5h ago  -> in both windows
    mk('2026-11-03T04:00:00', 500),   // ~8.5h ago  -> week only
    mk('2026-10-20T10:00:00', 900)    // 14 days ago -> neither
  ].join('\n'), 'f');

  const d = buildDashboard([s], { days: 30, now });
  assert.strictEqual(d.rolling.fiveHour.output, 100);
  assert.strictEqual(d.rolling.sevenDay.output, 600);
  assert.strictEqual(d.totals.output, 1500, 'all-time is unaffected by the windows');
});

test('peakWindow finds the busiest run of consecutive hours', () => {
  const { peakWindow } = require('../src/main/usage-aggregate.js');
  assert.strictEqual(peakWindow([1, 1, 1, 1, 1, 1], 5), 5);
  assert.strictEqual(peakWindow([0, 0, 9, 9, 0, 0], 2), 18);
  assert.strictEqual(peakWindow([5], 5), 0, 'not enough hours to fill a window');
  assert.strictEqual(peakWindow([], 5), 0);
});

test('rolling windows carry a peak to compare against', () => {
  const now = Date.parse('2026-11-03T12:30:00');
  const mk = (iso, out) => line({
    type: 'assistant', sessionId: 's', timestamp: iso,
    message: { model: 'm', usage: { input_tokens: 0, output_tokens: out } }
  });
  // A busy stretch two weeks back should set the peak, not the recent hour.
  const s = summariseSession([
    mk('2026-11-03T11:00:00', 100),
    mk('2026-10-25T10:00:00', 4000),
    mk('2026-10-25T11:00:00', 4000)
  ].join('\n'), 'f');

  const d = buildDashboard([s], { days: 30, now });
  assert.strictEqual(d.rolling.fiveHour.output, 100);
  assert.strictEqual(d.rolling.fiveHour.peak, 8000, 'peak comes from the busiest 5h, anywhere in 30d');
  assert.strictEqual(d.rolling.peakWindowDays, 30);
});

test('contributions only include sessions active inside the window', () => {
  const now = Date.parse('2026-11-03T12:00:00');
  const recent = summariseSession(line({
    type: 'assistant', sessionId: 'r', timestamp: '2026-11-03T09:00:00',
    attributionSkill: 'recent-skill', attributionPlugin: 'p1',
    message: { model: 'm', usage: { input_tokens: 1, output_tokens: 50 } }
  }), 'a');
  const old = summariseSession(line({
    type: 'assistant', sessionId: 'o', timestamp: '2026-10-01T09:00:00',
    attributionSkill: 'old-skill', attributionPlugin: 'p2',
    message: { model: 'm', usage: { input_tokens: 1, output_tokens: 999 } }
  }), 'b');

  const d = buildDashboard([recent, old], { days: 30, now });
  assert.deepStrictEqual(d.contrib.day.skills.map((x) => x.key), ['recent-skill']);
  assert.deepStrictEqual(d.contrib.week.skills.map((x) => x.key), ['recent-skill']);
  assert.deepStrictEqual(d.contrib.day.plugins.map((x) => x.key), ['p1']);
});

test('contributions rank MCP servers by call count', () => {
  const now = Date.parse('2026-11-03T12:00:00');
  const s = summariseSession([
    line({
      type: 'assistant', sessionId: 's', timestamp: '2026-11-03T10:00:00',
      message: {
        model: 'm',
        content: [
          { type: 'tool_use', name: 'mcp__alpha__a' },
          { type: 'tool_use', name: 'mcp__alpha__b' },
          { type: 'tool_use', name: 'mcp__beta__c' }
        ],
        usage: { input_tokens: 1, output_tokens: 1 }
      }
    })
  ].join('\n'), 'f');

  const d = buildDashboard([s], { days: 30, now });
  assert.deepStrictEqual(d.contrib.day.mcp.map((x) => [x.key, x.value]), [['alpha', 2], ['beta', 1]]);
});

test('projectName falls back sensibly', () => {
  assert.strictEqual(projectName('C:\\a\\b\\myproj'), 'myproj');
  assert.strictEqual(projectName(null), '(unknown)');
});

test('a cache written by an older reader is discarded, not served', async () => {
  // Simulates the real failure: a summary cached before the reader learned to
  // extract skills. The file is unchanged, so the mtime key alone would reuse it.
  const key = 'R\\a.jsonl';
  const files = { [key]: { mtimeMs: 100, text: SESSION_A } };
  const fsImpl = fakeFs(files);
  const first = await scanUsage({ projectsRoot: 'R', cache: {}, fsImpl });
  assert.ok(first.sessions[0].bySkill, 'current reader produces the field');

  const stale = JSON.parse(JSON.stringify(first.cache));
  delete stale[key].session.bySkill;
  const reused = await scanUsage({ projectsRoot: 'R', cache: stale, fsImpl });
  assert.strictEqual(reused.parsed, 0, 'the cache key alone cannot tell it is stale');
  assert.strictEqual(reused.sessions[0].bySkill, undefined,
    'which is exactly why the service must version the cache file');
});
