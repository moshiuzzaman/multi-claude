'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const chats = require('../src/main/chats.js');

const ID = '11111111-2222-4333-8444-555555555555';
const ID2 = '99999999-8888-4777-8666-555555555555';

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mc-chats-'));
}

// A minimal transcript in Claude Code's shape: one JSON record per line.
function transcript({ id = ID, cwd, ccDir, title = 'Fix the delete dialog', prompt = 'please fix it' }) {
  const toolOut = path.join(ccDir, 'projects', 'proj', id, 'tool-results', 'out.txt');
  return [
    { type: 'session-owner', accountUuid: 'acc-a', organizationUuid: 'org-a', sessionId: id },
    { type: 'user', sessionId: id, cwd, uuid: 'u1', parentUuid: null, message: { role: 'user', content: prompt } },
    { type: 'assistant', sessionId: id, cwd, uuid: 'a1', parentUuid: 'u1',
      message: { role: 'assistant', content: [{ type: 'text', text: `saved to ${toolOut}` }] } },
    { type: 'ai-title', sessionId: id, aiTitle: title }
  ].map((o) => JSON.stringify(o)).join('\n') + '\n';
}

// One account's Claude Code folder holding one chat, with its side files.
function seed(ccDir, { id = ID, cwd, title, sidecar = true, history = true } = {}) {
  const proj = path.join(ccDir, 'projects', 'proj');
  fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, `${id}.jsonl`), transcript({ id, cwd, ccDir, title }));
  if (sidecar) {
    fs.mkdirSync(path.join(proj, id, 'tool-results'), { recursive: true });
    fs.writeFileSync(path.join(proj, id, 'tool-results', 'out.txt'), 'tool output');
  }
  if (history) {
    fs.mkdirSync(path.join(ccDir, 'file-history', id), { recursive: true });
    fs.writeFileSync(path.join(ccDir, 'file-history', id, 'snap@v1'), 'old file');
  }
  return path.join(proj, `${id}.jsonl`);
}

const dead = () => false;

test('listChats reads title, folder, size and last use; ignores non-chat files', () => {
  const base = tmp();
  const cc = path.join(base, 'cc-a');
  const cwd = path.join(base, 'work');
  fs.mkdirSync(cwd);
  seed(cc, { cwd });
  fs.writeFileSync(path.join(cc, 'projects', 'proj', 'notes.jsonl'), '{}\n');

  const list = chats.listChats(cc, { isAlive: dead });
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].id, ID);
  assert.strictEqual(list[0].title, 'Fix the delete dialog');
  assert.strictEqual(list[0].cwd, cwd);
  assert.strictEqual(list[0].folderExists, true);
  assert.strictEqual(list[0].running, false);
  assert.ok(list[0].size > 0);
  assert.ok(list[0].lastUsed > 0);
});

test('listChats prefers a custom title and falls back to the first prompt', () => {
  const base = tmp();
  const cc = path.join(base, 'cc');
  const file = seed(cc, { cwd: base });
  fs.appendFileSync(file, JSON.stringify({ type: 'custom-title', sessionId: ID, customTitle: 'My name' }) + '\n');
  assert.strictEqual(chats.listChats(cc, { isAlive: dead })[0].title, 'My name');

  const cc2 = path.join(base, 'cc2');
  const proj = path.join(cc2, 'projects', 'p');
  fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, `${ID}.jsonl`),
    JSON.stringify({ type: 'user', sessionId: ID, cwd: base, message: { role: 'user', content: 'hello there' } }) + '\n');
  assert.strictEqual(chats.listChats(cc2, { isAlive: dead })[0].title, 'hello there');
});

test('listChats returns nothing for an account with no Claude Code folder', () => {
  assert.deepStrictEqual(chats.listChats(path.join(tmp(), 'nope'), { isAlive: dead }), []);
});

test('a chat is running only when its session record names a live process', () => {
  const base = tmp();
  const cc = path.join(base, 'cc');
  seed(cc, { cwd: base });
  fs.mkdirSync(path.join(cc, 'sessions'));
  fs.writeFileSync(path.join(cc, 'sessions', '4242.json'), JSON.stringify({ pid: 4242, sessionId: ID }));

  assert.strictEqual(chats.listChats(cc, { isAlive: (pid) => pid === 4242 })[0].running, true);
  assert.strictEqual(chats.listChats(cc, { isAlive: dead })[0].running, false);
});

test('copyChat copies the transcript, its folder and file history, and fixes paths', async () => {
  const base = tmp();
  const from = path.join(base, 'cc-a');
  const to = path.join(base, 'cc-b');
  seed(from, { cwd: base });

  const r = await chats.copyChat({ fromDir: from, toDir: to, id: ID, isAlive: dead });
  assert.strictEqual(r.id, ID);
  assert.strictEqual(r.cwd, base);

  const copied = path.join(to, 'projects', 'proj', `${ID}.jsonl`);
  const text = fs.readFileSync(copied, 'utf8');
  assert.ok(!text.includes(JSON.stringify(from).slice(1, -1)), 'old config path left in the copy');
  assert.ok(text.includes(JSON.stringify(to).slice(1, -1)), 'new config path missing');
  assert.strictEqual(fs.readFileSync(path.join(to, 'projects', 'proj', ID, 'tool-results', 'out.txt'), 'utf8'), 'tool output');
  assert.strictEqual(fs.readFileSync(path.join(to, 'file-history', ID, 'snap@v1'), 'utf8'), 'old file');
  // Copy keeps the original.
  assert.ok(fs.existsSync(path.join(from, 'projects', 'proj', `${ID}.jsonl`)));
  // No temporary files left behind.
  assert.deepStrictEqual(fs.readdirSync(path.join(to, 'projects', 'proj')).sort(), [ID, `${ID}.jsonl`].sort());
});

test('move removes the original only after the copy is in place', async () => {
  const base = tmp();
  const from = path.join(base, 'cc-a');
  const to = path.join(base, 'cc-b');
  seed(from, { cwd: base });

  await chats.copyChat({ fromDir: from, toDir: to, id: ID, move: true, isAlive: dead });
  assert.ok(fs.existsSync(path.join(to, 'projects', 'proj', `${ID}.jsonl`)));
  assert.ok(!fs.existsSync(path.join(from, 'projects', 'proj', `${ID}.jsonl`)));
  assert.ok(!fs.existsSync(path.join(from, 'projects', 'proj', ID)));
  assert.ok(!fs.existsSync(path.join(from, 'file-history', ID)));
});

test('copy as a new chat gives every copied piece the new id', async () => {
  const base = tmp();
  const from = path.join(base, 'cc-a');
  const to = path.join(base, 'cc-b');
  seed(from, { cwd: base });

  const r = await chats.copyChat({ fromDir: from, toDir: to, id: ID, newId: ID2, isAlive: dead });
  assert.strictEqual(r.id, ID2);
  const text = fs.readFileSync(path.join(to, 'projects', 'proj', `${ID2}.jsonl`), 'utf8');
  assert.ok(!text.includes(ID));
  assert.ok(text.includes(ID2));
  assert.ok(fs.existsSync(path.join(to, 'projects', 'proj', ID2, 'tool-results', 'out.txt')));
  assert.ok(fs.existsSync(path.join(to, 'file-history', ID2)));
});

async function refuses(promise, code) {
  await assert.rejects(promise, (e) => {
    assert.strictEqual(e.code, code, `expected ${code}, got ${e.code}: ${e.message}`);
    return true;
  });
}

test('copyChat refuses a running chat', async () => {
  const base = tmp();
  const from = path.join(base, 'cc-a');
  seed(from, { cwd: base });
  fs.mkdirSync(path.join(from, 'sessions'));
  fs.writeFileSync(path.join(from, 'sessions', '7.json'), JSON.stringify({ pid: 7, sessionId: ID }));
  await refuses(chats.copyChat({ fromDir: from, toDir: path.join(base, 'cc-b'), id: ID, isAlive: () => true }), 'running');
});

test('copyChat refuses when the target already has the chat, and changes nothing', async () => {
  const base = tmp();
  const from = path.join(base, 'cc-a');
  const to = path.join(base, 'cc-b');
  seed(from, { cwd: base });
  const existing = seed(to, { cwd: base, title: 'continued there' });
  const before = fs.readFileSync(existing, 'utf8');
  await refuses(chats.copyChat({ fromDir: from, toDir: to, id: ID, isAlive: dead }), 'exists');
  assert.strictEqual(fs.readFileSync(existing, 'utf8'), before);
});

test('copyChat refuses when the project folder is gone', async () => {
  const base = tmp();
  const from = path.join(base, 'cc-a');
  seed(from, { cwd: path.join(base, 'deleted-project') });
  await refuses(chats.copyChat({ fromDir: from, toDir: path.join(base, 'cc-b'), id: ID, isAlive: dead }), 'folder_missing');
});

test('copyChat refuses ids that are not chat ids', async () => {
  const base = tmp();
  await refuses(chats.copyChat({ fromDir: base, toDir: base, id: '..\\..\\x', isAlive: dead }), 'bad_id');
  await refuses(chats.copyChat({ fromDir: base, toDir: path.join(base, 'b'), id: ID, newId: 'nope', isAlive: dead }), 'bad_id');
});

test('copyChat refuses a chat it cannot read, and an unknown chat', async () => {
  const base = tmp();
  const from = path.join(base, 'cc-a');
  const proj = path.join(from, 'projects', 'p');
  fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, `${ID}.jsonl`), 'not json at all\n');
  await refuses(chats.copyChat({ fromDir: from, toDir: path.join(base, 'cc-b'), id: ID, isAlive: dead }), 'unsupported');
  await refuses(chats.copyChat({ fromDir: from, toDir: path.join(base, 'cc-b'), id: ID2, isAlive: dead }), 'missing');
});

test('a failed copy removes everything it wrote and leaves the original', async () => {
  const base = tmp();
  const from = path.join(base, 'cc-a');
  const to = path.join(base, 'cc-b');
  const src = seed(from, { cwd: base });
  const before = fs.readFileSync(src, 'utf8');

  // Fail on the last step, after the side folders were already copied.
  const failingRename = async () => { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); };
  await refuses(
    chats.copyChat({ fromDir: from, toDir: to, id: ID, move: true, isAlive: dead, renameImpl: failingRename }),
    'copy_failed'
  );
  assert.ok(!fs.existsSync(path.join(to, 'projects', 'proj', `${ID}.jsonl`)));
  assert.ok(!fs.existsSync(path.join(to, 'projects', 'proj', ID)));
  assert.ok(!fs.existsSync(path.join(to, 'file-history', ID)));
  assert.deepStrictEqual(fs.readdirSync(path.join(to, 'projects', 'proj')), []);
  assert.strictEqual(fs.readFileSync(src, 'utf8'), before);
  assert.ok(fs.existsSync(path.join(from, 'file-history', ID)));
});

test('titles skip Claude Desktop\'s "New session" placeholder and interrupt markers', () => {
  const base = tmp();
  const proj = path.join(base, 'cc', 'projects', 'p');
  fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, `${ID}.jsonl`), [
    { type: 'custom-title', sessionId: ID, customTitle: 'New session' },
    { type: 'user', sessionId: ID, cwd: base, message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] } },
    { type: 'user', sessionId: ID, cwd: base, message: { role: 'user', content: 'fix the delete dialog' } }
  ].map((o) => JSON.stringify(o)).join('\n') + '\n');
  assert.strictEqual(chats.listChats(path.join(base, 'cc'), { isAlive: dead })[0].title, 'fix the delete dialog');
});

function withSession(cc, pid, id = ID) {
  fs.mkdirSync(path.join(cc, 'sessions'), { recursive: true });
  fs.writeFileSync(path.join(cc, 'sessions', `${pid}.json`), JSON.stringify({ pid, sessionId: id }));
}

test('closeChat ends the chat\'s Claude Code process and waits for it to go', async () => {
  const cc = path.join(tmp(), 'cc');
  withSession(cc, 501);
  const alive = new Set([501]);
  const killed = [];
  const r = await chats.closeChat({
    ccDir: cc, id: ID, isAlive: (p) => alive.has(p),
    nameOf: async () => 'claude', kill: async (p) => { killed.push(p); alive.delete(p); },
    sleep: async () => {}
  });
  assert.deepStrictEqual(killed, [501]);
  assert.deepStrictEqual(r, { closed: 1, stillRunning: false });
});

test('closeChat never kills a process that is not Claude Code (a reused pid)', async () => {
  const cc = path.join(tmp(), 'cc');
  withSession(cc, 502);
  const killed = [];
  await assert.rejects(chats.closeChat({
    ccDir: cc, id: ID, isAlive: () => true,
    nameOf: async () => 'chrome', kill: async (p) => { killed.push(p); }, sleep: async () => {}
  }), (e) => e.code === 'not_claude');
  await assert.rejects(chats.closeChat({
    ccDir: cc, id: ID, isAlive: () => true,
    nameOf: async () => { throw new Error('no such process'); }, kill: async (p) => { killed.push(p); }, sleep: async () => {}
  }), (e) => e.code === 'not_claude');
  assert.deepStrictEqual(killed, []);
});

test('closeChat does nothing for a chat that is not running, and reports one that survives', async () => {
  const cc = path.join(tmp(), 'cc');
  withSession(cc, 503);
  const none = await chats.closeChat({ ccDir: cc, id: ID, isAlive: () => false,
    nameOf: async () => 'claude', kill: async () => { throw new Error('must not kill'); }, sleep: async () => {} });
  assert.deepStrictEqual(none, { closed: 0, stillRunning: false });

  const stuck = await chats.closeChat({ ccDir: cc, id: ID, isAlive: () => true,
    nameOf: async () => 'claude.exe', kill: async () => {}, sleep: async () => {} });
  assert.deepStrictEqual(stuck, { closed: 1, stillRunning: true });
});

// ---- Claude Desktop Code-tab list (phase 2) ----------------------------------

const ENTRY_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

function desktopProfile(base, entries = [{ at: 100, model: 'claude-opus-5-5' }]) {
  const profile = path.join(base, 'profile');
  const dir = path.join(profile, 'claude-code-sessions', 'acct', 'org');
  fs.mkdirSync(dir, { recursive: true });
  entries.forEach((e, i) => {
    const id = `0000000${i}-0000-4000-8000-000000000000`;
    fs.writeFileSync(path.join(dir, `local_${id}.json`), JSON.stringify({
      sessionId: `local_${id}`, cliSessionId: ID, cwd: base, originCwd: base, title: 'theirs',
      createdAt: e.at, lastActivityAt: e.at, isArchived: false, model: e.model,
      permissionMode: 'auto', remoteMcpServersConfig: [{ name: 'x' }], somethingInternal: { keep: 1 }
    }));
  });
  fs.writeFileSync(path.join(dir, 'scheduled-tasks.json'), '[]');
  return { profile, dir };
}

test('addDesktopEntry writes one minimal entry beside the profile\'s newest one', async () => {
  const base = tmp();
  const { profile, dir } = desktopProfile(base, [{ at: 100, model: 'old' }, { at: 900, model: 'claude-opus-5-5' }]);
  const file = await chats.addDesktopEntry({
    profileDir: profile, cliSessionId: ID2, cwd: base, title: 'Fix it', completedTurns: 3, now: 1234, entryId: ENTRY_ID
  });
  assert.strictEqual(file, path.join(dir, `local_${ENTRY_ID}.json`));
  const e = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepStrictEqual(e, {
    sessionId: `local_${ENTRY_ID}`, cliSessionId: ID2, cwd: base, originCwd: base, title: 'Fix it',
    createdAt: 1234, lastActivityAt: 1234, isArchived: false, model: 'claude-opus-5-5',
    permissionMode: 'auto', remoteMcpServersConfig: [{ name: 'x' }], completedTurns: 3
  });
  // Nothing else touched, no temp file left.
  assert.deepStrictEqual(fs.readdirSync(dir).filter((n) => n.includes('mc-copy')), []);
  assert.strictEqual(fs.readdirSync(dir).length, 4);
});

test('addDesktopEntry refuses a profile with no Code-tab chats, or an unknown entry format', async () => {
  const base = tmp();
  const empty = path.join(base, 'empty');
  fs.mkdirSync(empty);
  await refuses(chats.addDesktopEntry({ profileDir: empty, cliSessionId: ID2, cwd: base, entryId: ENTRY_ID }), 'no_desktop_list');

  const { profile, dir } = desktopProfile(base);
  const only = fs.readdirSync(dir).find((n) => n.startsWith('local_'));
  fs.writeFileSync(path.join(dir, only), JSON.stringify({ sessionId: 'x', lastActivityAt: 5 }));
  await refuses(chats.addDesktopEntry({ profileDir: profile, cliSessionId: ID2, cwd: base, entryId: ENTRY_ID }), 'unsupported_desktop');
  assert.ok(!fs.existsSync(path.join(dir, `local_${ENTRY_ID}.json`)));
});

test('copyChat may copy inside one folder only under a new id; removeChatFiles undoes it', async () => {
  const base = tmp();
  const cc = path.join(base, 'home');
  seed(cc, { cwd: base });
  await refuses(chats.copyChat({ fromDir: cc, toDir: cc, id: ID, isAlive: dead }), 'same_account');
  const r = await chats.copyChat({ fromDir: cc, toDir: cc, id: ID, newId: ID2, isAlive: dead });
  assert.strictEqual(r.title, 'Fix the delete dialog');
  assert.strictEqual(r.completedTurns, 1);
  assert.ok(fs.existsSync(path.join(cc, 'projects', 'proj', `${ID2}.jsonl`)));
  assert.ok(fs.existsSync(path.join(cc, 'file-history', ID2)));

  await chats.removeChatFiles(cc, ID2);
  assert.ok(!fs.existsSync(path.join(cc, 'projects', 'proj', `${ID2}.jsonl`)));
  assert.ok(!fs.existsSync(path.join(cc, 'projects', 'proj', ID2)));
  assert.ok(!fs.existsSync(path.join(cc, 'file-history', ID2)));
  // The original is untouched.
  assert.ok(fs.existsSync(path.join(cc, 'projects', 'proj', `${ID}.jsonl`)));
  assert.ok(fs.existsSync(path.join(cc, 'file-history', ID)));
});
