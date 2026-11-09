'use strict';
const test = require('node:test');
const assert = require('node:assert');
const loc = require('../src/main/claude-locator.js');

function fakeFs(existing) {
  const set = new Set(existing.map((s) => s.toLowerCase()));
  return {
    existsSync: (p) => set.has(String(p).toLowerCase()),
    readdirSync: (dir) => {
      const prefix = String(dir).toLowerCase() + '\\';
      const names = new Set();
      for (const p of set) {
        if (p.startsWith(prefix)) names.add(p.slice(prefix.length).split('\\')[0]);
      }
      if (names.size === 0) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return [...names];
    }
  };
}

const ENV = { LOCALAPPDATA: 'C:\\LA' };
const never = async () => { throw new Error('PowerShell should not have been called'); };

test('uses the cached path when it still exists', async () => {
  const l = loc.createLocator({
    fsImpl: fakeFs(['C:\\cached\\claude.exe']), env: ENV, runPowerShell: never
  });
  assert.strictEqual(await l.resolve('C:\\cached\\claude.exe'), 'C:\\cached\\claude.exe');
});

test('ignores a stale cached path and falls through', async () => {
  const fsImpl = fakeFs(['C:\\LA\\AnthropicClaude\\app-1.2.3\\claude.exe']);
  const l = loc.createLocator({ fsImpl, env: ENV, runPowerShell: never });
  assert.strictEqual(
    await l.resolve('C:\\gone\\claude.exe'),
    'C:\\LA\\AnthropicClaude\\app-1.2.3\\claude.exe'
  );
});

test('picks the newest app-* folder by descending name', async () => {
  const fsImpl = fakeFs([
    'C:\\LA\\AnthropicClaude\\app-1.2.3\\claude.exe',
    'C:\\LA\\AnthropicClaude\\app-1.10.0\\claude.exe'
  ]);
  const l = loc.createLocator({ fsImpl, env: ENV, runPowerShell: never });
  assert.strictEqual(await l.resolve(null), 'C:\\LA\\AnthropicClaude\\app-1.2.3\\claude.exe');
});

test('falls back to the flat installer path', async () => {
  const fsImpl = fakeFs(['C:\\LA\\AnthropicClaude\\claude.exe']);
  const l = loc.createLocator({ fsImpl, env: ENV, runPowerShell: never });
  assert.strictEqual(await l.resolve(null), 'C:\\LA\\AnthropicClaude\\claude.exe');
});

test('falls back to the Store package via PowerShell', async () => {
  const fsImpl = fakeFs(['C:\\Program Files\\WindowsApps\\Claude_4_x64__abc\\app\\claude.exe']);
  const l = loc.createLocator({
    fsImpl, env: ENV,
    runPowerShell: async () => 'C:\\Program Files\\WindowsApps\\Claude_4_x64__abc\r\n'
  });
  assert.strictEqual(
    await l.resolve(null),
    'C:\\Program Files\\WindowsApps\\Claude_4_x64__abc\\app\\claude.exe'
  );
});

test('returns null when nothing is found and PowerShell fails', async () => {
  const l = loc.createLocator({
    fsImpl: fakeFs([]), env: ENV,
    runPowerShell: async () => { throw new Error('no appx'); }
  });
  assert.strictEqual(await l.resolve(null), null);
});

test('resolveDefaultProfileDir derives the dir from the package family name', async () => {
  const dir = 'C:\\LA\\Claude-Data\\claude_pzs8sxrjxfjjc';
  const out = await loc.resolveDefaultProfileDir({
    fsImpl: fakeFs([dir, dir + '\\Preferences']),
    env: ENV,
    runPowerShell: async () => 'Claude_pzs8sxrjxfjjc\r\n'
  });
  assert.strictEqual(out.toLowerCase(), dir.toLowerCase());
});

test('resolveDefaultProfileDir falls back to APPDATA\\Claude without a package', async () => {
  const out = await loc.resolveDefaultProfileDir({
    fsImpl: fakeFs([]),
    env: { LOCALAPPDATA: 'C:\\LA', APPDATA: 'C:\\RA' },
    runPowerShell: async () => { throw new Error('no appx'); }
  });
  assert.strictEqual(out, 'C:\\RA\\Claude');
});
