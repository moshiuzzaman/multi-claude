'use strict';
const test = require('node:test');
const assert = require('node:assert');
const C = require('../src/main/closer.js');

const WORK = 'C:\\Users\\Bob\\ClaudeProfiles\\work';
const DEFAULT = 'C:\\Users\\Bob\\AppData\\Local\\Claude-Data\\claude_abc';

test('parseProcessList reads pid, ppid and the normalised dir', () => {
  const out = C.parseProcessList([
    `100|4|${WORK}`,
    `101|100|"${WORK}"`,
    '102|100|',
    '',
    'garbage',
    'x|y|z'
  ].join('\r\n'));

  assert.strictEqual(out.length, 3);
  assert.deepStrictEqual(out[0], { pid: 100, ppid: 4, dir: 'c:\\users\\bob\\claudeprofiles\\work' });
  assert.strictEqual(out[1].dir, 'c:\\users\\bob\\claudeprofiles\\work', 'quotes stripped');
  assert.strictEqual(out[2].dir, null, 'no flag on this process');
});

test('findRootPids returns the main process when it carries the flag itself', () => {
  // A profile we launched: the flag is on the main process and on its children.
  const procs = C.parseProcessList([
    `100|4|${WORK}`,
    `101|100|${WORK}`,
    `102|100|${WORK}`
  ].join('\n'));
  assert.deepStrictEqual(C.findRootPids(procs, WORK), [100]);
});

test('findRootPids climbs to a main process that has no flag', () => {
  // The default instance: main started with no --user-data-dir, children have it.
  const procs = C.parseProcessList([
    '200|4|',
    `201|200|${DEFAULT}`,
    `202|200|${DEFAULT}`
  ].join('\n'));
  assert.deepStrictEqual(C.findRootPids(procs, DEFAULT), [200]);
});

test('findRootPids keeps separate instances apart', () => {
  const procs = C.parseProcessList([
    '200|4|',
    `201|200|${DEFAULT}`,
    `300|4|${WORK}`,
    `301|300|${WORK}`
  ].join('\n'));
  assert.deepStrictEqual(C.findRootPids(procs, WORK), [300]);
  assert.deepStrictEqual(C.findRootPids(procs, DEFAULT), [200]);
});

test('findRootPids never climbs past a non-claude parent', () => {
  // ppid 4 is not in the list, so the walk must stop at 300 and not return 4.
  const procs = C.parseProcessList([`300|4|${WORK}`].join('\n'));
  assert.deepStrictEqual(C.findRootPids(procs, WORK), [300]);
});

test('findRootPids returns nothing when the profile is not running', () => {
  const procs = C.parseProcessList([`300|4|${WORK}`].join('\n'));
  assert.deepStrictEqual(C.findRootPids(procs, DEFAULT), []);
  assert.deepStrictEqual(C.findRootPids(procs, null), []);
});

test('findRootPids survives a parent cycle without hanging', () => {
  const procs = C.parseProcessList([
    `400|401|${WORK}`,
    `401|400|${WORK}`
  ].join('\n'));
  const roots = C.findRootPids(procs, WORK);
  assert.ok(roots.length >= 1 && roots.length <= 2);
});

test('close reports nothing closed when the profile is idle', async () => {
  const closer = C.createCloser({ runPowerShell: async () => `300|4|${WORK}` });
  assert.deepStrictEqual(await closer.close(DEFAULT), { closed: 0, pids: [] });
});

test('close issues a graceful taskkill for the root pid only', async () => {
  const calls = [];
  const closer = C.createCloser({
    runPowerShell: async (cmd) => {
      calls.push(cmd);
      if (cmd.includes('Win32_Process')) {
        return [`100|4|${WORK}`, `101|100|${WORK}`].join('\n');
      }
      return '';
    }
  });

  const r = await closer.close(WORK);
  assert.deepStrictEqual(r, { closed: 1, pids: [100] });
  const kill = calls.find((c) => c.includes('taskkill'));
  assert.ok(kill.includes('taskkill /PID 100'), 'kills the root');
  assert.ok(!kill.includes('101'), 'does not kill children directly');
  assert.ok(!/\/F\b/.test(kill), 'must not force-kill: that would lose unsaved work');
});

test('close tolerates taskkill failing on an already-gone process', async () => {
  const closer = C.createCloser({
    runPowerShell: async (cmd) => {
      if (cmd.includes('Win32_Process')) return `100|4|${WORK}`;
      throw new Error('process not found');
    }
  });
  const r = await closer.close(WORK);
  assert.strictEqual(r.closed, 1, 'a kill race is not an error');
});
