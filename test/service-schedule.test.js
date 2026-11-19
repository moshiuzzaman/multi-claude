'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createService } = require('../src/main/service.js');

function harness({ reply } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-sched-'));
  const userProfile = path.join(base, 'user');
  const defaultProfileDir = path.join(base, 'default-profile');
  fs.mkdirSync(userProfile, { recursive: true });
  fs.mkdirSync(defaultProfileDir, { recursive: true });
  const sends = [];
  const notes = [];
  const replyBox = { value: reply || ((n) => ({ ok: true, sessionId: 'chat-1', reply: 'Hello' + n })) };
  const loginBox = { value: false };
  const svc = createService({
    configFile: path.join(base, 'cfg', 'accounts.json'),
    ccRoot: path.join(base, 'cfg', 'cc'),
    scheduleStateFile: path.join(base, 'cfg', 'schedule-state.json'),
    ccCli: {
      find: async () => ({ path: 'C:\\cc\\claude.exe', version: [2, 1, 326] }),
      authStatus: async () => ({ loggedIn: true }),
      openTerminal: () => {}
    },
    scheduledSend: {
      send: async (cli, dir, opts) => { sends.push({ dir, ...opts }); return replyBox.value(sends.length, opts); }
    },
    loginItem: { get: () => loginBox.value, set: (on) => { loginBox.value = on; } },
    notify: (n) => notes.push(n),
    profilesRoot: path.join(userProfile, 'ClaudeProfiles'),
    userProfile,
    defaultProfileDir,
    locator: { resolve: async () => 'C:\\fake\\claude.exe' },
    launcher: { launch: () => {} },
    scanner: { scan: async () => ({ dirs: [], ok: true }) },
    shellImpl: { writeShortcutLink: () => true, openPath: async () => '', openExternal: async () => {} },
    desktopDir: path.join(base, 'desktop')
  });
  return { base, svc, sends, notes, replyBox, loginBox };
}

const stateFile = (h) => path.join(h.base, 'cfg', 'schedule-state.json');
const readState = (h) => JSON.parse(fs.readFileSync(stateFile(h), 'utf8'));
const writeLastSlot = async (h, id, lastSlot) => {
  const st = readState(h);
  st[id].lastSlot = lastSlot;
  fs.writeFileSync(stateFile(h), JSON.stringify(st));
};

async function ready(h) {
  await h.svc.init();
  const [a] = await h.svc.list();
  fs.mkdirSync(path.join(h.base, 'cfg', 'cc', a.id), { recursive: true });
  return a;
}

test('turning it on saves the schedule and sends nothing for times already past today', async () => {
  const h = harness();
  const a = await ready(h);
  const v = await h.svc.setSchedule({ id: a.id, on: true, times: ['00:00', '23:59'], message: 'hello' });
  assert.strictEqual(v.schedule.on, true);
  assert.deepStrictEqual(v.schedule.times, ['00:00', '23:59']);
  assert.strictEqual(v.schedule.message, 'hello');
  assert.ok(Number.isFinite(v.next));
  await h.svc.scheduleTick();
  assert.strictEqual(h.sends.length, 0);
  fs.rmSync(h.base, { recursive: true, force: true });
});

test('a passed time sends once, from the account folder, then into the same chat', async () => {
  const h = harness();
  const a = await ready(h);
  await h.svc.setSchedule({ id: a.id, on: true, times: ['00:00'] });
  // Pretend the last handled time was two days ago: one send, not two.
  await writeLastSlot(h, a.id, Date.now() - 2 * 86400000 - 60000);
  // Same files, fresh service, as after a restart.
  const svc = createService(harnessDeps(h));
  await svc.init();
  const r = await svc.scheduleTick();
  assert.strictEqual(r.sent, 1);
  assert.strictEqual(h.sends.length, 1);
  assert.strictEqual(h.sends[0].sessionId, null);
  assert.strictEqual(h.sends[0].message, 'hi');
  assert.ok(h.sends[0].dir.endsWith(a.id));
  assert.ok(h.sends[0].cwd.endsWith(path.join(a.id, 'scheduled')));
  // Again straight away: nothing more is due.
  assert.strictEqual((await svc.scheduleTick()).sent, 0);
  const view = svc.getSchedule({ id: a.id });
  assert.strictEqual(view.last.ok, true);
  assert.strictEqual(readState(h)[a.id].sessionId, 'chat-1');
  fs.rmSync(h.base, { recursive: true, force: true });
});

// The deps of an existing harness, for a second service over the same files.
function harnessDeps(h) {
  const userProfile = path.join(h.base, 'user');
  return {
    configFile: path.join(h.base, 'cfg', 'accounts.json'),
    ccRoot: path.join(h.base, 'cfg', 'cc'),
    scheduleStateFile: path.join(h.base, 'cfg', 'schedule-state.json'),
    ccCli: { find: async () => ({ path: 'C:\\cc\\claude.exe', version: [2, 1, 326] }), authStatus: async () => ({ loggedIn: true }), openTerminal: () => {} },
    scheduledSend: { send: async (cli, dir, opts) => { h.sends.push({ dir, ...opts }); return h.replyBox.value(h.sends.length, opts); } },
    notify: (n) => h.notes.push(n),
    profilesRoot: path.join(userProfile, 'ClaudeProfiles'),
    userProfile,
    defaultProfileDir: path.join(h.base, 'default-profile'),
    locator: { resolve: async () => 'C:\\fake\\claude.exe' },
    launcher: { launch: () => {} },
    scanner: { scan: async () => ({ dirs: [], ok: true }) },
    shellImpl: { writeShortcutLink: () => true, openPath: async () => '', openExternal: async () => {} },
    desktopDir: path.join(h.base, 'desktop')
  };
}

test('Send now reuses the chat while its file is there, and starts a new one when it is gone', async () => {
  const h = harness();
  const a = await ready(h);
  await h.svc.sendScheduledNow({ id: a.id });
  assert.strictEqual(h.sends[0].sessionId, null);
  // The chat's transcript exists: the next message goes into it.
  const proj = path.join(h.base, 'cfg', 'cc', a.id, 'projects', 'x');
  fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, 'chat-1.jsonl'), '{}\n');
  await h.svc.sendScheduledNow({ id: a.id });
  assert.strictEqual(h.sends[1].sessionId, 'chat-1');
  // Deleted: a new chat.
  fs.rmSync(proj, { recursive: true, force: true });
  await h.svc.sendScheduledNow({ id: a.id });
  assert.strictEqual(h.sends[2].sessionId, null);
  fs.rmSync(h.base, { recursive: true, force: true });
});

test('a failed scheduled send is kept and notified; Send now only reports it', async () => {
  const h = harness({ reply: () => ({ ok: false, limitReached: true, reason: "You've hit your weekly limit" }) });
  const a = await ready(h);
  const manual = await h.svc.sendScheduledNow({ id: a.id });
  assert.strictEqual(manual.result.ok, false);
  assert.match(manual.last.reason, /weekly limit/);
  assert.strictEqual(h.notes.length, 0);

  await h.svc.setSchedule({ id: a.id, on: true, times: ['00:00'] });
  await writeLastSlot(h, a.id, Date.now() - 86400000 - 60000);
  const svc = createService(harnessDeps(h));
  await svc.init();
  await svc.scheduleTick();
  assert.strictEqual(h.notes.length, 1);
  assert.match(h.notes[0].title, /scheduled message not sent/);
  fs.rmSync(h.base, { recursive: true, force: true });
});

test('an account not signed in to Claude Code is told so, and its folder is not created', async () => {
  const h = harness();
  await h.svc.init();
  const [a] = await h.svc.list();
  const r = await h.svc.sendScheduledNow({ id: a.id });
  assert.strictEqual(r.result.ok, false);
  assert.match(r.result.reason, /Sign in to Claude Code/);
  assert.strictEqual(h.sends.length, 0);
  assert.ok(!fs.existsSync(path.join(h.base, 'cfg', 'cc', a.id)));
  fs.rmSync(h.base, { recursive: true, force: true });
});

test('bad messages and times are refused', async () => {
  const h = harness();
  const a = await ready(h);
  await assert.rejects(h.svc.setSchedule({ id: a.id, message: '   ' }), { code: 'bad_message' });
  await assert.rejects(h.svc.setSchedule({ id: a.id, message: '--model opus' }), { code: 'bad_message' });
  await assert.rejects(h.svc.setSchedule({ id: a.id, times: ['9am'] }), { code: 'bad_time' });
  // Up to 5 times a day.
  const five = ['07:00', '09:00', '11:00', '13:00', '15:00'];
  assert.deepStrictEqual((await h.svc.setSchedule({ id: a.id, times: five })).schedule.times, five);
  await assert.rejects(h.svc.setSchedule({ id: a.id, times: [...five, '17:00'] }), { code: 'too_many_times' });
  fs.rmSync(h.base, { recursive: true, force: true });
});

test('start with Windows is a setting', async () => {
  const h = harness();
  await h.svc.init();
  assert.strictEqual(h.svc.settings().openAtLoginSupported, true);
  assert.strictEqual(h.svc.settings().openAtLogin, false);
  const s = await h.svc.setOpenAtLogin({ on: true });
  assert.strictEqual(s.openAtLogin, true);
  assert.strictEqual(h.loginBox.value, true);
  fs.rmSync(h.base, { recursive: true, force: true });
});
