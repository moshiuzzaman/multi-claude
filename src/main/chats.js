'use strict';
// Claude Code chats inside one account's Claude Code folder (its
// CLAUDE_CONFIG_DIR), and copying one chat to another account's folder.
//
// "Copy a chat to another account" (docs/FEATURES.md): for a chat that was
// started in the wrong account. It is
// started by hand, one chat at a time, and nothing here knows about usage.
//
// Claude Code keeps a chat as <config>/projects/<encoded folder>/<id>.jsonl,
// one JSON record per line, plus an optional <id>/ folder beside it (subagent
// transcripts, saved tool output) and <id>-named entries in file-history/,
// todos/ and tasks/. The format is Claude Code's own and changes between
// versions, so this module reads only what it needs and refuses anything it
// cannot recognise rather than guess.
//
// Never touched: sign-ins (.credentials.json, .claude.json), settings, memory.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHAT_FILE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;
// Top-level folders whose <id>-named entries belong to one chat.
const SIDE_DIRS = ['file-history', 'todos', 'tasks'];
// Reading a whole multi-megabyte transcript just for its title is wasteful:
// the folder is near the start and titles are appended near the end.
const HEAD_BYTES = 64 * 1024;
const TAIL_BYTES = 256 * 1024;
const TITLE_MAX = 100;
// Claude Desktop stamps this on every new Code-tab chat; its real title is
// kept in the Desktop's own profile data, which Multi-Claude does not read.
const PLACEHOLDER_TITLES = new Set(['new session']);

function err(code, message, cause) {
  const e = new Error(message);
  e.code = code;
  if (cause) e.cause = cause;
  return e;
}

function defaultIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM: it exists but belongs to someone else, so it is alive.
    return e.code === 'EPERM';
  }
}

/** Parsed records from text that may start or end mid-line. */
function parseLines(text) {
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line);
      if (o && typeof o === 'object') out.push(o);
    } catch { /* a cut line at a chunk edge, or not a record */ }
  }
  return out;
}

function readHeadTail(file, size) {
  if (size <= HEAD_BYTES + TAIL_BYTES) return [fs.readFileSync(file, 'utf8'), ''];
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(HEAD_BYTES);
    fs.readSync(fd, head, 0, HEAD_BYTES, 0);
    const tail = Buffer.alloc(TAIL_BYTES);
    fs.readSync(fd, tail, 0, TAIL_BYTES, size - TAIL_BYTES);
    return [head.toString('utf8'), tail.toString('utf8')];
  } finally {
    fs.closeSync(fd);
  }
}

function promptText(record) {
  if (record.type !== 'user' || record.isMeta || record.isSidechain) return null;
  const c = record.message && record.message.content;
  let text = null;
  if (typeof c === 'string') text = c;
  else if (Array.isArray(c)) {
    const block = c.find((b) => b && b.type === 'text' && typeof b.text === 'string');
    text = block ? block.text : null;
  }
  if (!text) return null;
  text = text.trim();
  // Slash commands and system notes are stored as tagged text, not prompts;
  // an interrupted turn leaves a bracketed marker.
  if (!text || text.startsWith('<') || text.startsWith('[Request interrupted')) return null;
  return text;
}

function clip(s) {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > TITLE_MAX ? one.slice(0, TITLE_MAX - 1) + '…' : one;
}

/** Title and folder from a chat's records, as Claude Code itself names chats. */
function describe(records) {
  let custom = null;
  let ai = null;
  let prompt = null;
  let cwd = null;
  for (const r of records) {
    if (!cwd && typeof r.cwd === 'string' && r.cwd) cwd = r.cwd;
    if (r.type === 'custom-title' && typeof r.customTitle === 'string' && r.customTitle.trim() &&
        !PLACEHOLDER_TITLES.has(r.customTitle.trim().toLowerCase())) custom = r.customTitle;
    if (r.type === 'ai-title' && typeof r.aiTitle === 'string' && r.aiTitle.trim()) ai = r.aiTitle;
    if (!prompt) prompt = promptText(r);
  }
  const title = custom || ai || prompt;
  return { title: title ? clip(title) : null, cwd };
}

/** Live Claude Code processes, from <config>/sessions/<pid>.json: [{ pid, sessionId }]. */
function liveSessions(ccDir, isAlive) {
  const out = [];
  let names;
  try { names = fs.readdirSync(path.join(ccDir, 'sessions')); } catch { return out; }
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      const o = JSON.parse(fs.readFileSync(path.join(ccDir, 'sessions', name), 'utf8'));
      if (o && typeof o.sessionId === 'string' && Number.isInteger(o.pid) && o.pid > 0 && isAlive(o.pid)) {
        out.push({ pid: o.pid, sessionId: o.sessionId });
      }
    } catch { /* a record being written, or not one of ours */ }
  }
  return out;
}

/** Chat ids with a live Claude Code process. */
function runningIds(ccDir, isAlive) {
  return new Set(liveSessions(ccDir, isAlive).map((s) => s.sessionId));
}

// A process id is only trusted while it still names Claude Code: ids are
// reused, and a stale session record must never close something else.
const CLAUDE_PROCESS = /^(claude|node)(\.exe)?$/i;

/**
 * End the Claude Code process(es) running one chat, so it can be copied.
 * nameOf(pid) -> process name; kill(pid) ends it. Waits for it to be gone.
 * Returns { closed, stillRunning }; closed 0 means it was not running.
 */
async function closeChat({
  ccDir, id, isAlive = defaultIsAlive, nameOf, kill,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)), tries = 12
}) {
  if (typeof id !== 'string' || !UUID.test(id)) throw err('bad_id', 'That is not a chat id.');
  const pids = liveSessions(ccDir, isAlive).filter((s) => s.sessionId === id).map((s) => s.pid);
  if (pids.length === 0) return { closed: 0, stillRunning: false };

  for (const pid of pids) {
    let name = '';
    try { name = String((await nameOf(pid)) || '').trim(); } catch { /* treated as unknown */ }
    if (!CLAUDE_PROCESS.test(name)) {
      throw err('not_claude', "That chat's process could not be confirmed as Claude Code, so nothing was closed.");
    }
  }
  for (const pid of pids) await kill(pid);

  let alive = pids;
  for (let i = 0; i < tries && alive.length; i++) {
    await sleep(500);
    alive = alive.filter((pid) => isAlive(pid));
  }
  return { closed: pids.length, stillRunning: alive.length > 0 };
}

function listDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
}

/**
 * Every chat in this Claude Code folder, newest first:
 * { id, title, cwd, folderExists, size, lastUsed, running }.
 */
function listChats(ccDir, { isAlive = defaultIsAlive } = {}) {
  const projects = path.join(ccDir, 'projects');
  const running = runningIds(ccDir, isAlive);
  const out = [];
  for (const proj of listDirs(projects)) {
    let names;
    try { names = fs.readdirSync(path.join(projects, proj)); } catch { continue; }
    for (const name of names) {
      const m = CHAT_FILE.exec(name);
      if (!m) continue;
      const file = path.join(projects, proj, name);
      let st;
      try { st = fs.statSync(file); } catch { continue; }
      if (!st.isFile() || st.size === 0) continue;
      let info = { title: null, cwd: null };
      try {
        const [head, tail] = readHeadTail(file, st.size);
        info = describe([...parseLines(head), ...parseLines(tail)]);
      } catch { /* unreadable: still listed, by id */ }
      out.push({
        id: m[1],
        title: info.title,
        cwd: info.cwd,
        folderExists: !!(info.cwd && fs.existsSync(info.cwd)),
        size: st.size,
        lastUsed: st.mtimeMs,
        running: running.has(m[1])
      });
    }
  }
  out.sort((a, b) => b.lastUsed - a.lastUsed);
  return out;
}

/** Where a chat's transcript is: { proj, file } or null. */
function findChat(ccDir, id) {
  const projects = path.join(ccDir, 'projects');
  for (const proj of listDirs(projects)) {
    const file = path.join(projects, proj, `${id}.jsonl`);
    if (fs.existsSync(file)) return { proj, file };
  }
  return null;
}

/** JSON-string form of a path, as it appears inside a transcript line. */
const inJson = (s) => JSON.stringify(s).slice(1, -1);

/**
 * Rewrites one transcript's text for its new home: the old Claude Code
 * folder becomes the new one (so saved tool output still resolves), and,
 * for a copy under a new id, every mention of the old id.
 */
function rewriter({ fromDir, toDir, id, finalId }) {
  const pairs = [];
  for (const sep of ['\\', '/']) {
    const a = fromDir.split(/[\\/]/).join(sep) + sep;
    const b = toDir.split(/[\\/]/).join(sep) + sep;
    pairs.push([inJson(a), inJson(b)]);
  }
  return (text) => {
    let t = text;
    for (const [a, b] of pairs) t = t.split(a).join(b);
    if (finalId !== id) t = t.split(id).join(finalId);
    return t;
  };
}

async function walkFiles(dir) {
  const out = [];
  for (const d of await fsp.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) out.push(...await walkFiles(p));
    else if (d.isFile()) out.push(p);
  }
  return out;
}

/**
 * Copy one chat from one account's Claude Code folder to another's.
 *
 * Everything is copied first; the transcript itself lands last, under a
 * temporary name renamed into place, so Claude Code never sees half a chat.
 * Any failure removes every file this call wrote and leaves the original as
 * it was. With move, the original is removed only after the copy is in place.
 *
 * Returns { id, cwd, moved, moveIncomplete }.
 */
async function copyChat({
  fromDir, toDir, id, newId = null, move = false,
  isAlive = defaultIsAlive, renameImpl = fsp.rename
}) {
  if (typeof id !== 'string' || !UUID.test(id)) throw err('bad_id', 'That is not a chat id.');
  if (newId !== null && (typeof newId !== 'string' || !UUID.test(newId))) throw err('bad_id', 'That is not a chat id.');
  const finalId = newId || id;
  if (!newId && path.resolve(fromDir).toLowerCase() === path.resolve(toDir).toLowerCase()) {
    throw err('same_account', 'Pick a different account to copy to.');
  }

  const src = findChat(fromDir, id);
  if (!src) throw err('missing', 'That chat is no longer there.');
  if (runningIds(fromDir, isAlive).has(id)) {
    throw err('running', 'This chat is open. Close it first, then copy it.');
  }

  const text = await fsp.readFile(src.file, 'utf8');
  const records = parseLines(text);
  if (!records.some((r) => r.sessionId === id)) {
    throw err('unsupported', "This chat's format isn't supported yet. Nothing was changed.");
  }
  const { cwd, title } = describe(records);
  const completedTurns = records.filter((r) => promptText(r) !== null).length;
  if (!cwd || !fs.existsSync(cwd)) {
    throw err('folder_missing', `The chat's project folder${cwd ? ` (${cwd})` : ''} is not on this PC, so it can't be continued.`);
  }

  const dstProj = path.join(toDir, 'projects', src.proj);
  const dstFile = path.join(dstProj, `${finalId}.jsonl`);
  if (fs.existsSync(dstFile) || fs.existsSync(path.join(dstProj, finalId))) {
    throw err('exists', 'That account already has a copy of this chat.');
  }

  const rewrite = rewriter({ fromDir, toDir, id, finalId });
  const srcSide = path.join(fromDir, 'projects', src.proj, id);
  const sideEntries = []; // [from, to] pairs outside projects/
  for (const dir of SIDE_DIRS) {
    let names;
    try { names = fs.readdirSync(path.join(fromDir, dir)); } catch { continue; }
    for (const name of names) {
      if (!name.includes(id)) continue;
      const to = path.join(toDir, dir, name.split(id).join(finalId));
      if (fs.existsSync(to)) continue; // never overwrite the other account's own files
      sideEntries.push([path.join(fromDir, dir, name), to]);
    }
  }

  const created = [];
  const tmp = path.join(dstProj, `.${finalId}.jsonl.mc-copy`);
  try {
    await fsp.mkdir(dstProj, { recursive: true });

    if (fs.existsSync(srcSide)) {
      const dstSide = path.join(dstProj, finalId);
      created.push(dstSide);
      await fsp.cp(srcSide, dstSide, { recursive: true, errorOnExist: true, force: false });
      // Subagent transcripts carry the same paths and id as the chat.
      for (const f of await walkFiles(dstSide)) {
        if (f.endsWith('.jsonl')) await fsp.writeFile(f, rewrite(await fsp.readFile(f, 'utf8')));
      }
    }

    for (const [from, to] of sideEntries) {
      await fsp.mkdir(path.dirname(to), { recursive: true });
      created.push(to);
      await fsp.cp(from, to, { recursive: true, errorOnExist: true, force: false });
    }

    const out = rewrite(text);
    created.push(tmp);
    await fsp.writeFile(tmp, out, 'utf8');
    const st = await fsp.stat(tmp);
    if (st.size !== Buffer.byteLength(out, 'utf8')) throw new Error('The copy is incomplete.');
    await renameImpl(tmp, dstFile);
    created[created.length - 1] = dstFile;
  } catch (e) {
    for (const p of created.reverse()) {
      try { await fsp.rm(p, { recursive: true, force: true }); } catch { /* best effort */ }
    }
    throw err('copy_failed', 'The chat could not be copied. Nothing was changed.', e);
  }

  let moveIncomplete = false;
  if (move) {
    for (const p of [src.file, srcSide, ...sideEntries.map(([from]) => from)]) {
      try { await fsp.rm(p, { recursive: true, force: true }); } catch { moveIncomplete = true; }
    }
  }
  return { id: finalId, cwd, title, completedTurns, moved: move && !moveIncomplete, moveIncomplete };
}

/**
 * Remove every file belonging to one chat id from a Claude Code folder:
 * the transcript, its <id>/ folder, and <id>-named side entries. Used only to
 * undo a copy this module just made under a fresh id.
 */
async function removeChatFiles(ccDir, id) {
  if (typeof id !== 'string' || !UUID.test(id)) throw err('bad_id', 'That is not a chat id.');
  const found = findChat(ccDir, id);
  const targets = [];
  if (found) targets.push(found.file, path.join(path.dirname(found.file), id));
  for (const dir of SIDE_DIRS) {
    let names;
    try { names = fs.readdirSync(path.join(ccDir, dir)); } catch { continue; }
    for (const name of names) if (name.includes(id)) targets.push(path.join(ccDir, dir, name));
  }
  for (const t of targets) {
    try { await fsp.rm(t, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

// ---- Claude Desktop's Code-tab chat list (copying a chat, phase 2) -------------
//
// Each Claude profile lists its Code-tab chats as
// <profile>/claude-code-sessions/<a>/<b>/local_<uuid>.json, where <a>/<b> are
// Claude Desktop's own ids for the signed-in account. The transcript itself is
// in ~/.claude, linked by cliSessionId. The format is Claude Desktop's own and
// differs between entries, so only the fields every entry has are written, the
// rest are left for Claude Desktop to fill in, and the folder and settings are
// taken from the profile's own newest entry.

const LOCAL_ENTRY = /^local_[0-9a-f-]{36}\.json$/i;

/** The profile's newest Code-tab entry: { dir, entry } or null. */
function newestDesktopEntry(profileDir) {
  const root = path.join(profileDir, 'claude-code-sessions');
  let best = null;
  for (const a of listDirs(root)) {
    for (const b of listDirs(path.join(root, a))) {
      const dir = path.join(root, a, b);
      let names;
      try { names = fs.readdirSync(dir); } catch { continue; }
      for (const name of names) {
        if (!LOCAL_ENTRY.test(name)) continue;
        try {
          const e = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
          const at = Number(e.lastActivityAt) || Number(e.createdAt) || 0;
          if (!best || at > best.at) best = { dir, entry: e, at };
        } catch { /* one being written */ }
      }
    }
  }
  return best;
}

function looksLikeEntry(e) {
  return e && typeof e === 'object' &&
    typeof e.sessionId === 'string' && e.sessionId.startsWith('local_') &&
    typeof e.cwd === 'string' && typeof e.title === 'string' &&
    typeof e.createdAt === 'number' && typeof e.lastActivityAt === 'number' &&
    typeof e.isArchived === 'boolean';
}

/**
 * Add one chat to a profile's Code-tab list, pointing at a transcript already
 * in ~/.claude. The caller makes sure that profile's Claude window is closed:
 * Claude Desktop reads the list when it starts and would overwrite it.
 * Returns the new entry's file.
 */
async function addDesktopEntry({ profileDir, cliSessionId, cwd, title, completedTurns = 0, now = Date.now(), entryId }) {
  if (!UUID.test(cliSessionId || '') || !UUID.test(entryId || '')) throw err('bad_id', 'That is not a chat id.');
  const newest = newestDesktopEntry(profileDir);
  if (!newest) {
    throw err('no_desktop_list',
      "That account's Claude window has no Code-tab chats yet. Open its Code tab once, then copy again.");
  }
  if (!looksLikeEntry(newest.entry)) {
    throw err('unsupported_desktop',
      "This Claude Desktop's chat list isn't in a format Multi-Claude knows. Nothing was changed.");
  }
  const t = newest.entry;
  const entry = {
    sessionId: `local_${entryId}`,
    cliSessionId,
    cwd,
    originCwd: cwd,
    title: title || 'Copied chat',
    createdAt: now,
    lastActivityAt: now,
    isArchived: false,
    model: typeof t.model === 'string' ? t.model : undefined,
    permissionMode: typeof t.permissionMode === 'string' ? t.permissionMode : 'default',
    remoteMcpServersConfig: Array.isArray(t.remoteMcpServersConfig) ? t.remoteMcpServersConfig : [],
    completedTurns
  };
  if (entry.model === undefined) delete entry.model;

  const file = path.join(newest.dir, `local_${entryId}.json`);
  if (fs.existsSync(file)) throw err('exists', 'That chat is already in the list.');
  const tmp = `${file}.mc-copy`;
  try {
    await fsp.writeFile(tmp, JSON.stringify(entry, null, 2), 'utf8');
    await fsp.rename(tmp, file);
  } catch (e) {
    try { await fsp.rm(tmp, { force: true }); } catch { /* best effort */ }
    throw err('copy_failed', "The chat could not be added to that account's Code tab. Nothing was changed.", e);
  }
  return file;
}

module.exports = {
  listChats, copyChat, closeChat, removeChatFiles, addDesktopEntry, newestDesktopEntry,
  findChat, describe, parseLines, UUID
};
