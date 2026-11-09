# Multi-Claude Implementation Plan

> **Historical record.** This is the original Version 1 implementation plan, kept as written.
> It does not describe the current app. For what is built now, see the design spec
> (`docs/superpowers/specs/2026-11-09-multi-claude-account-manager-design.md`, Versions 2 and 3)
> and the README.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Windows Electron app that lists Claude Desktop profiles and can add, launch, rename, create shortcuts for, and permanently delete them.

**Architecture:** A privileged Node main process owns every path, the `claude.exe` lookup, process scanning and deletion; a sandboxed renderer talks to it through a narrow preload bridge that only ever passes account **ids**, never paths. Profile isolation is achieved with Chromium's stock `--user-data-dir` flag — nothing about Claude Desktop is modified.

**Tech Stack:** Electron 33.x, Node 22, React 18 + Vite 5 for the renderer, `node:test` for unit tests, `electron-builder` for packaging.

> **Change, 2026-11-09:** the renderer was switched from vanilla HTML to React + Vite at the user's request, before any UI code was written. Task 10 below reflects the original vanilla plan; the built implementation uses React components and an `app://` protocol handler instead. See the spec §4.3 for the current design.

**Spec:** `docs/superpowers/specs/2026-11-09-multi-claude-account-manager-design.md`

## Global Constraints

- Windows only. `process.platform !== 'win32'` must abort at startup with a clear message.
- Node >= 22, npm >= 10. Electron 33.x. No native modules — the app must install with `npm install` on a machine without build tools.
- `BrowserWindow` is always `{ contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true }`.
- Renderer CSP, verbatim: `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:;`
- **Every IPC call takes an account `id`.** No IPC call accepts a filesystem path or an executable path from the renderer. The single exception is `locateExe()`, whose path comes from a native `dialog.showOpenDialog`, not from renderer script.
- The app never reads, writes, copies, parses or transmits any file inside a profile directory. It only creates directories, measures their size, and deletes them wholesale.
- **Forbidden features — do not implement, even if they seem convenient:** automatic account switching on usage limits, parallel/pooled launching, "next available account" failover, profile cloning or export, credential capture of any kind.
- Product name is `Multi-Claude`. The About text must contain, verbatim: `Not affiliated with, or endorsed by, Anthropic.`
- Managed profile root: `%USERPROFILE%\ClaudeProfiles`. Config file: `%APPDATA%\multi-claude\accounts.json`.
- Unit tests must run without Electron, via `node --test`.

**A note on code in this plan:** tests are given in full, because they define the behaviour. Implementations are given as real signatures plus the actual algorithm for anything non-obvious; where an implementation is a direct, unambiguous consequence of its test, the test is the specification. Nothing here is "add appropriate handling" — every guard, error code and edge case is named.

---

### Task 0: Project scaffold

**Files:**
- Create: `package.json`, `.gitignore`, `src/main/main.js`, `src/renderer/index.html`
- Test: none (deliverable is a window that opens)

**Interfaces:**
- Consumes: nothing
- Produces: `npm start` opens a window; `npm test` runs `node --test test/`

- [ ] **Step 1: Initialise the project**

```bash
cd "C:/Users/BS01085/Music/multi-Claude"
npm init -y
npm install --save-dev electron@^33.0.0 electron-builder@^25.0.0
```

- [ ] **Step 2: Write `package.json` scripts and metadata**

```json
{
  "name": "multi-claude",
  "productName": "Multi-Claude",
  "version": "1.0.0",
  "description": "Launch and manage separate Claude Desktop profiles. Not affiliated with Anthropic.",
  "main": "src/main/main.js",
  "scripts": {
    "start": "electron .",
    "test": "node --test test/",
    "dist": "electron-builder"
  }
}
```

- [ ] **Step 3: Write `.gitignore`**

```
node_modules/
dist/
*.log
```

- [ ] **Step 4: Minimal `src/main/main.js`**

```js
'use strict';
const { app, BrowserWindow } = require('electron');
const path = require('node:path');

if (process.platform !== 'win32') {
  console.error('Multi-Claude is Windows-only.');
  app.exit(1);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 760, height: 620, minWidth: 560, minHeight: 420,
    backgroundColor: '#1f1e1d',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
```

- [ ] **Step 5: Minimal `src/renderer/index.html`**

```html
<!doctype html>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:;">
<title>Multi-Claude</title>
<body style="background:#1f1e1d;color:#f0eee6;font-family:system-ui">Multi-Claude</body>
```

- [ ] **Step 6: Verify the window opens**

Run: `npm start`
Expected: a dark window titled "Multi-Claude". Close it.

- [ ] **Step 7: Commit**

```bash
git init
git add -A
git commit -m "chore: scaffold Electron app"
```

---

### Task 1: Path utilities and guards

**Files:**
- Create: `src/main/paths.js`
- Test: `test/paths.test.js`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `normalizeDir(p: string): string | null` — trimmed, unquoted, resolved, lowercased, trailing separators stripped; `null` for non-strings and blanks
  - `samePath(a: string, b: string): boolean`
  - `isInside(child: string, parent: string): boolean` — strictly inside; equal returns `false`
  - `segmentCount(p: string): number` — path segments after the drive root
  - `isDriveRoot(p: string): boolean`
  - `isReparsePoint(p: string): Promise<boolean>` — true for junctions and symlinks

- [ ] **Step 1: Write the failing test**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const p = require('../src/main/paths.js');

test('normalizeDir strips quotes, trailing slashes, and lowercases', () => {
  assert.strictEqual(p.normalizeDir('"C:\\Users\\Bob\\X\\"'), 'c:\\users\\bob\\x');
  assert.strictEqual(p.normalizeDir('C:\\Users\\Bob\\X'), 'c:\\users\\bob\\x');
  assert.strictEqual(p.normalizeDir('  C:\\Users\\Bob\\X  '), 'c:\\users\\bob\\x');
});

test('normalizeDir rejects junk', () => {
  assert.strictEqual(p.normalizeDir(''), null);
  assert.strictEqual(p.normalizeDir('   '), null);
  assert.strictEqual(p.normalizeDir(null), null);
  assert.strictEqual(p.normalizeDir(42), null);
});

test('samePath ignores case and trailing separators', () => {
  assert.ok(p.samePath('C:\\A\\B', 'c:\\a\\b\\'));
  assert.ok(!p.samePath('C:\\A\\B', 'C:\\A\\C'));
  assert.ok(!p.samePath('', 'C:\\A'));
});

test('isInside is strict and not fooled by prefixes', () => {
  assert.ok(p.isInside('C:\\Users\\Bob\\Profiles\\x', 'C:\\Users\\Bob\\Profiles'));
  assert.ok(!p.isInside('C:\\Users\\Bobby', 'C:\\Users\\Bob'));
  assert.ok(!p.isInside('C:\\Users\\Bob', 'C:\\Users\\Bob'), 'equal is not inside');
  assert.ok(!p.isInside('C:\\Users', 'C:\\Users\\Bob'));
});

test('segmentCount counts below the drive root', () => {
  assert.strictEqual(p.segmentCount('C:\\'), 0);
  assert.strictEqual(p.segmentCount('C:\\Users'), 1);
  assert.strictEqual(p.segmentCount('C:\\Users\\Bob'), 2);
  assert.strictEqual(p.segmentCount('C:\\Users\\Bob\\Claude_Work'), 3);
  assert.strictEqual(p.segmentCount('C:\\Users\\Bob\\ClaudeProfiles\\personal'), 4);
});

test('isDriveRoot', () => {
  assert.ok(p.isDriveRoot('C:\\'));
  assert.ok(p.isDriveRoot('d:\\'));
  assert.ok(!p.isDriveRoot('C:\\Users'));
});

test('isReparsePoint detects a junction, not a plain directory', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-paths-'));
  const real = path.join(base, 'real');
  const link = path.join(base, 'link');
  fs.mkdirSync(real);
  fs.symlinkSync(real, link, 'junction');
  assert.strictEqual(await p.isReparsePoint(real), false);
  assert.strictEqual(await p.isReparsePoint(link), true);
  fs.rmSync(base, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node --test test/paths.test.js`
Expected: FAIL — `Cannot find module '../src/main/paths.js'`

- [ ] **Step 3: Implement `src/main/paths.js`**

```js
'use strict';
const path = require('node:path');
const fsp = require('node:fs/promises');

function normalizeDir(p) {
  if (typeof p !== 'string') return null;
  let v = p.trim();
  if (v === '') return null;
  v = v.replace(/^"+/, '').replace(/"+$/, '').trim();
  if (v === '') return null;
  v = path.resolve(v);
  v = v.replace(/[\\/]+$/, '');
  if (/^[a-zA-Z]:$/.test(v)) v += '\\';     // keep the root separator on "C:"
  return v.toLowerCase();
}

function samePath(a, b) {
  const na = normalizeDir(a);
  const nb = normalizeDir(b);
  return na !== null && nb !== null && na === nb;
}

function isInside(child, parent) {
  const c = normalizeDir(child);
  const pa = normalizeDir(parent);
  if (c === null || pa === null || c === pa) return false;
  const prefix = pa.endsWith('\\') ? pa : pa + '\\';
  return c.startsWith(prefix);
}

function segmentCount(p) {
  const n = normalizeDir(p);
  if (n === null) return 0;
  const root = path.parse(n).root;
  const rest = n.slice(root.length);
  return rest === '' ? 0 : rest.split('\\').filter(Boolean).length;
}

function isDriveRoot(p) {
  const n = normalizeDir(p);
  return n !== null && n === path.parse(n).root.toLowerCase();
}

async function isReparsePoint(p) {
  const st = await fsp.lstat(p);          // lstat reports junctions as symlinks on Windows
  return st.isSymbolicLink();
}

module.exports = { normalizeDir, samePath, isInside, segmentCount, isDriveRoot, isReparsePoint };
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test test/paths.test.js`
Expected: PASS, 7/7

- [ ] **Step 5: Commit**

```bash
git add src/main/paths.js test/paths.test.js
git commit -m "feat: path normalisation and guard helpers"
```

---

### Task 2: Account store

**Files:**
- Create: `src/main/store.js`
- Test: `test/store.test.js`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `SCHEMA_VERSION = 1`
  - `validate(raw: unknown): {version, exePath, accounts}` — throws `Error` with `.code = 'INVALID_SCHEMA'`
  - `load(file: string): Promise<{data, recoveredFrom: string|null}>` — a corrupt or invalid file is renamed to `accounts.corrupt-<ISO ts>.json` and an empty store returned, with its new name in `recoveredFrom`
  - `save(file: string, data): Promise<void>` — atomic (temp file + rename)
  - `emptyStore(): {version: 1, exePath: null, accounts: []}`

An `Account` is `{ id: string, label: string, kind: 'default'|'imported'|'managed', dir: string, createdAt: string }`.

- [ ] **Step 1: Write the failing test**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const store = require('../src/main/store.js');

function tmpFile() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-store-'));
  return path.join(d, 'accounts.json');
}

const GOOD = {
  version: 1,
  exePath: 'C:\\x\\claude.exe',
  accounts: [{ id: 'a1', label: 'Work', kind: 'imported', dir: 'C:\\Users\\Bob\\Claude_Work', createdAt: '2026-11-09T00:00:00.000Z' }]
};

test('validate accepts a good store', () => {
  assert.deepStrictEqual(store.validate(GOOD), GOOD);
});

test('validate rejects bad shapes with code INVALID_SCHEMA', () => {
  const bad = [
    null, 42, 'x', {},
    { version: 2, exePath: null, accounts: [] },
    { version: 1, exePath: null, accounts: 'nope' },
    { version: 1, exePath: null, accounts: [{ id: 'a', label: 'L', kind: 'weird', dir: 'C:\\x', createdAt: 'x' }] },
    { version: 1, exePath: null, accounts: [{ id: 'a', label: 'L', kind: 'managed', createdAt: 'x' }] }
  ];
  for (const b of bad) {
    assert.throws(() => store.validate(b), (e) => e.code === 'INVALID_SCHEMA', JSON.stringify(b));
  }
});

test('validate rejects duplicate ids', () => {
  const dup = { version: 1, exePath: null, accounts: [
    { id: 'a', label: 'A', kind: 'managed', dir: 'C:\\x\\a', createdAt: 'x' },
    { id: 'a', label: 'B', kind: 'managed', dir: 'C:\\x\\b', createdAt: 'x' }
  ]};
  assert.throws(() => store.validate(dup), (e) => e.code === 'INVALID_SCHEMA');
});

test('save then load round-trips', async () => {
  const f = tmpFile();
  await store.save(f, GOOD);
  const { data, recoveredFrom } = await store.load(f);
  assert.deepStrictEqual(data, GOOD);
  assert.strictEqual(recoveredFrom, null);
});

test('load returns an empty store when the file is absent', async () => {
  const { data, recoveredFrom } = await store.load(tmpFile());
  assert.deepStrictEqual(data, store.emptyStore());
  assert.strictEqual(recoveredFrom, null);
});

test('load quarantines a corrupt file instead of destroying it', async () => {
  const f = tmpFile();
  fs.writeFileSync(f, '{ this is not json');
  const { data, recoveredFrom } = await store.load(f);
  assert.deepStrictEqual(data, store.emptyStore());
  assert.ok(recoveredFrom, 'should report the quarantine filename');
  assert.ok(fs.existsSync(recoveredFrom), 'quarantined file must still exist on disk');
  assert.strictEqual(fs.readFileSync(recoveredFrom, 'utf8'), '{ this is not json');
});

test('load quarantines a schema-invalid file too', async () => {
  const f = tmpFile();
  fs.writeFileSync(f, JSON.stringify({ version: 99 }));
  const { data, recoveredFrom } = await store.load(f);
  assert.deepStrictEqual(data, store.emptyStore());
  assert.ok(recoveredFrom);
});

test('save leaves no .tmp file behind', async () => {
  const f = tmpFile();
  await store.save(f, GOOD);
  assert.ok(!fs.existsSync(f + '.tmp'));
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node --test test/store.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `src/main/store.js`**

Key points: `validate` is a hand-written shape check (no dependency); `load` wraps both `JSON.parse` and `validate` in one try/catch so either failure quarantines; `save` writes `file + '.tmp'` then `fs.rename` over the target.

```js
'use strict';
const fsp = require('node:fs/promises');
const fs = require('node:fs');

const SCHEMA_VERSION = 1;
const KINDS = new Set(['default', 'imported', 'managed']);

function fail(msg) {
  const e = new Error(msg);
  e.code = 'INVALID_SCHEMA';
  throw e;
}

function emptyStore() {
  return { version: SCHEMA_VERSION, exePath: null, accounts: [] };
}

function validate(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) fail('not an object');
  if (raw.version !== SCHEMA_VERSION) fail('bad version');
  if (!(raw.exePath === null || typeof raw.exePath === 'string')) fail('bad exePath');
  if (!Array.isArray(raw.accounts)) fail('accounts is not an array');
  const seen = new Set();
  for (const a of raw.accounts) {
    if (a === null || typeof a !== 'object') fail('bad account');
    for (const k of ['id', 'label', 'kind', 'dir', 'createdAt']) {
      if (typeof a[k] !== 'string' || a[k] === '') fail(`bad account.${k}`);
    }
    if (!KINDS.has(a.kind)) fail('bad account.kind');
    if (seen.has(a.id)) fail('duplicate account id');
    seen.add(a.id);
  }
  return raw;
}

async function load(file) {
  let text;
  try {
    text = await fsp.readFile(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return { data: emptyStore(), recoveredFrom: null };
    throw e;
  }
  try {
    return { data: validate(JSON.parse(text)), recoveredFrom: null };
  } catch {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const quarantine = file.replace(/\.json$/, '') + `.corrupt-${stamp}.json`;
    await fsp.rename(file, quarantine);
    return { data: emptyStore(), recoveredFrom: quarantine };
  }
}

async function save(file, data) {
  validate(data);
  await fsp.mkdir(require('node:path').dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fsp.rename(tmp, file);
}

module.exports = { SCHEMA_VERSION, KINDS, emptyStore, validate, load, save };
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test test/store.test.js`
Expected: PASS, 8/8

- [ ] **Step 5: Commit**

```bash
git add src/main/store.js test/store.test.js
git commit -m "feat: account store with atomic writes and corrupt-file quarantine"
```

---

### Task 3: Profile naming and sizing

**Files:**
- Create: `src/main/profiles.js`
- Test: `test/profiles.test.js`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `slugify(label: string): string` — lowercase `[a-z0-9-]`, max 40 chars, never empty, never a Windows reserved device name
  - `uniqueSlug(base: string, taken: Set<string>): string` — appends `-2`, `-3`, ...
  - `dirSize(dir: string): Promise<number>` — bytes; missing directory resolves to `0`
  - `newId(): string` — 8 lowercase hex chars

- [ ] **Step 1: Write the failing test**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const pr = require('../src/main/profiles.js');

test('slugify produces safe folder names', () => {
  assert.strictEqual(pr.slugify('Work'), 'work');
  assert.strictEqual(pr.slugify('My Personal Account'), 'my-personal-account');
  assert.strictEqual(pr.slugify('  Ünïcödé  '), 'unicode');
  assert.strictEqual(pr.slugify('a/b\\c:d*e?f'), 'a-b-c-d-e-f');
  assert.strictEqual(pr.slugify('---'), 'account');
  assert.strictEqual(pr.slugify(''), 'account');
  assert.ok(pr.slugify('x'.repeat(100)).length <= 40);
});

test('slugify avoids Windows reserved device names', () => {
  for (const n of ['CON', 'prn', 'AUX', 'nul', 'COM1', 'lpt9']) {
    const s = pr.slugify(n);
    assert.ok(!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(s), `${n} -> ${s}`);
  }
});

test('uniqueSlug resolves collisions', () => {
  assert.strictEqual(pr.uniqueSlug('work', new Set()), 'work');
  assert.strictEqual(pr.uniqueSlug('work', new Set(['work'])), 'work-2');
  assert.strictEqual(pr.uniqueSlug('work', new Set(['work', 'work-2'])), 'work-3');
});

test('newId is 8 hex chars and not repeated', () => {
  const a = pr.newId(), b = pr.newId();
  assert.match(a, /^[0-9a-f]{8}$/);
  assert.notStrictEqual(a, b);
});

test('dirSize sums nested files and tolerates a missing dir', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-size-'));
  fs.mkdirSync(path.join(base, 'sub'));
  fs.writeFileSync(path.join(base, 'a.bin'), Buffer.alloc(1000));
  fs.writeFileSync(path.join(base, 'sub', 'b.bin'), Buffer.alloc(2000));
  assert.strictEqual(await pr.dirSize(base), 3000);
  assert.strictEqual(await pr.dirSize(path.join(base, 'nope')), 0);
  fs.rmSync(base, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node --test test/profiles.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `src/main/profiles.js`**

```js
'use strict';
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/;

function slugify(label) {
  let s = String(label == null ? '' : label)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  if (s === '') s = 'account';
  if (RESERVED.test(s)) s = s + '-profile';
  return s;
}

function uniqueSlug(base, taken) {
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

function newId() {
  return crypto.randomBytes(4).toString('hex');
}

async function dirSize(dir) {
  let total = 0;
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    try {
      if (e.isDirectory() && !e.isSymbolicLink()) total += await dirSize(full);
      else if (e.isFile()) total += (await fsp.stat(full)).size;
    } catch { /* a file vanishing mid-walk is normal; skip it */ }
  }
  return total;
}

module.exports = { slugify, uniqueSlug, newId, dirSize };
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test test/profiles.test.js`
Expected: PASS, 5/5

- [ ] **Step 5: Commit**

```bash
git add src/main/profiles.js test/profiles.test.js
git commit -m "feat: profile slug generation, ids, and directory sizing"
```

---

### Task 4: Running-instance scanner

**Files:**
- Create: `src/main/scanner.js`
- Test: `test/scanner.test.js`

**Interfaces:**
- Consumes: `paths.normalizeDir`
- Produces:
  - `PS_COMMAND: string` — the PowerShell one-liner
  - `parseScanOutput(stdout: string): string[]` — normalised, deduplicated profile directories
  - `createScanner({ runPowerShell }): { scan(): Promise<{ dirs: string[], ok: boolean }> }` — `ok: false` means the scan failed and callers must render "unknown", never "not running"

`runPowerShell(command: string): Promise<string>` is injected so the scanner is testable without spawning anything.

- [ ] **Step 1: Write the failing test**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const sc = require('../src/main/scanner.js');

test('parseScanOutput normalises, dedupes and drops blanks', () => {
  const out = [
    'C:\\Users\\BS01085\\AppData\\Local\\Claude-Data\\claude_pzs8sxrjxfjjc',
    '"C:\\Users\\BS01085\\AppData\\Local\\Claude-Data\\claude_pzs8sxrjxfjjc"',
    'C:\\Users\\BS01085\\Claude_Work\\',
    '',
    '   '
  ].join('\r\n');
  assert.deepStrictEqual(sc.parseScanOutput(out), [
    'c:\\users\\bs01085\\appdata\\local\\claude-data\\claude_pzs8sxrjxfjjc',
    'c:\\users\\bs01085\\claude_work'
  ]);
});

test('parseScanOutput on empty input yields an empty list', () => {
  assert.deepStrictEqual(sc.parseScanOutput(''), []);
  assert.deepStrictEqual(sc.parseScanOutput('\r\n\r\n'), []);
});

test('scan reports ok:true and the parsed dirs', async () => {
  const scanner = sc.createScanner({ runPowerShell: async () => 'C:\\A\\B' });
  assert.deepStrictEqual(await scanner.scan(), { dirs: ['c:\\a\\b'], ok: true });
});

test('scan reports ok:false and no dirs when PowerShell fails', async () => {
  const scanner = sc.createScanner({ runPowerShell: async () => { throw new Error('boom'); } });
  assert.deepStrictEqual(await scanner.scan(), { dirs: [], ok: false });
});

test('PS_COMMAND targets claude.exe and extracts user-data-dir', () => {
  assert.match(sc.PS_COMMAND, /Win32_Process/);
  assert.match(sc.PS_COMMAND, /claude\.exe/i);
  assert.match(sc.PS_COMMAND, /--user-data-dir/);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node --test test/scanner.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `src/main/scanner.js`**

The extraction happens inside PowerShell so that multi-kilobyte command lines never cross the process boundary — a single Claude renderer's command line can run past 20 KB.

```js
'use strict';
const { normalizeDir } = require('./paths.js');

const PS_COMMAND = [
  "Get-CimInstance Win32_Process -Filter \"Name='claude.exe'\" |",
  "ForEach-Object {",
  "  if ($_.CommandLine -match '--user-data-dir=(?:\"([^\"]+)\"|([^\\s]+))') {",
  "    if ($Matches[1]) { $Matches[1] } else { $Matches[2] }",
  "  }",
  "} | Sort-Object -Unique"
].join(' ');

function parseScanOutput(stdout) {
  const seen = new Set();
  for (const line of String(stdout).split(/\r?\n/)) {
    const n = normalizeDir(line);
    if (n !== null) seen.add(n);
  }
  return [...seen];
}

function createScanner({ runPowerShell }) {
  return {
    async scan() {
      try {
        return { dirs: parseScanOutput(await runPowerShell(PS_COMMAND)), ok: true };
      } catch {
        return { dirs: [], ok: false };
      }
    }
  };
}

module.exports = { PS_COMMAND, parseScanOutput, createScanner };
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test test/scanner.test.js`
Expected: PASS, 5/5

- [ ] **Step 5: Integration check against the real machine**

With Claude Desktop open, run the command for real and confirm it prints at least the default profile directory:

```bash
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='claude.exe'\" | ForEach-Object { if ($_.CommandLine -match '--user-data-dir=(?:\"([^\"]+)\"|([^\s]+))') { if ($Matches[1]) { $Matches[1] } else { $Matches[2] } } } | Sort-Object -Unique"
```

Expected: at least `C:\Users\BS01085\AppData\Local\Claude-Data\claude_pzs8sxrjxfjjc`.
If the quoting fights the shell, run it from a `.ps1` file instead and adjust `PS_COMMAND` to match what actually worked — then re-run Step 4.

- [ ] **Step 6: Commit**

```bash
git add src/main/scanner.js test/scanner.test.js
git commit -m "feat: detect which Claude profiles are currently running"
```

---

### Task 5: Delete guards

This is the highest-risk module in the application. It gets the most tests.

**Files:**
- Create: `src/main/deleter.js`
- Test: `test/deleter.test.js`

**Interfaces:**
- Consumes: `paths.{normalizeDir,isInside,segmentCount,isDriveRoot,isReparsePoint}`
- Produces:
  - `class DeleteBlocked extends Error` with `.code`
  - `checkDeletable({ account, runningDirs, confirmLabel, unlockOutsideRoot, profilesRoot, userProfile }): Promise<void>` — resolves if deletion may proceed, otherwise throws `DeleteBlocked`
  - `removeProfile(opts): Promise<void>` — runs `checkDeletable`, then `fs.rm` with retries

Codes, checked in this order: `default_account`, `running`, `missing`, `reparse_point`, `drive_root`, `user_profile_root`, `too_shallow`, `outside_root`, `label_mismatch`.

- [ ] **Step 1: Write the failing test**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const del = require('../src/main/deleter.js');

const USER = 'C:\\Users\\Bob';
const ROOT = 'C:\\Users\\Bob\\ClaudeProfiles';

function acct(over = {}) {
  return { id: 'i1', label: 'Personal', kind: 'managed',
           dir: path.join(ROOT, 'personal'), createdAt: 'x', ...over };
}

function opts(over = {}) {
  return { account: acct(), runningDirs: [], confirmLabel: 'Personal',
           unlockOutsideRoot: false, profilesRoot: ROOT, userProfile: USER,
           skipExistence: true, ...over };
}

async function blocked(o, code) {
  await assert.rejects(() => del.checkDeletable(o), (e) => {
    assert.strictEqual(e.code, code, `expected ${code}, got ${e.code}`);
    return true;
  });
}

test('refuses the default account', async () => {
  await blocked(opts({ account: acct({ kind: 'default' }) }), 'default_account');
});

test('refuses an account that is running', async () => {
  await blocked(opts({ runningDirs: ['c:\\users\\bob\\claudeprofiles\\personal'] }), 'running');
});

test('running check ignores case and trailing separators', async () => {
  await blocked(opts({ runningDirs: ['C:\\Users\\Bob\\ClaudeProfiles\\Personal\\'] }), 'running');
});

test('refuses a drive root', async () => {
  await blocked(opts({ account: acct({ dir: 'C:\\' }) }), 'drive_root');
});

test('refuses the user profile root', async () => {
  await blocked(opts({ account: acct({ dir: USER, kind: 'imported' }), unlockOutsideRoot: true }), 'user_profile_root');
});

test('refuses a path that is too shallow', async () => {
  await blocked(opts({ account: acct({ dir: 'C:\\Users', kind: 'imported' }), unlockOutsideRoot: true }), 'too_shallow');
});

test('refuses a managed-kind path outside the managed root', async () => {
  await blocked(opts({ account: acct({ dir: 'C:\\Somewhere\\Else\\x' }) }), 'outside_root');
});

test('refuses an imported path outside the root without the unlock', async () => {
  await blocked(opts({ account: acct({ kind: 'imported', dir: 'C:\\Users\\Bob\\Claude_Work' }) }), 'outside_root');
});

test('allows an imported path outside the root WITH the unlock', async () => {
  await del.checkDeletable(opts({
    account: acct({ kind: 'imported', dir: 'C:\\Users\\Bob\\Claude_Work' }),
    unlockOutsideRoot: true
  }));
});

test('refuses a wrong confirmation label, including case and whitespace', async () => {
  await blocked(opts({ confirmLabel: 'personal' }), 'label_mismatch');
  await blocked(opts({ confirmLabel: ' Personal' }), 'label_mismatch');
  await blocked(opts({ confirmLabel: '' }), 'label_mismatch');
});

test('allows the happy path', async () => {
  await del.checkDeletable(opts());
});

test('refuses a junction and does not follow it', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-del-'));
  const root = path.join(base, 'ClaudeProfiles');
  const real = path.join(base, 'precious');
  const link = path.join(root, 'linked');
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(real);
  fs.writeFileSync(path.join(real, 'keep.txt'), 'do not delete');
  fs.symlinkSync(real, link, 'junction');

  await assert.rejects(
    () => del.checkDeletable({
      account: { id: 'j', label: 'Linked', kind: 'managed', dir: link, createdAt: 'x' },
      runningDirs: [], confirmLabel: 'Linked', unlockOutsideRoot: false,
      profilesRoot: root, userProfile: base, skipExistence: false
    }),
    (e) => e.code === 'reparse_point'
  );

  assert.ok(fs.existsSync(path.join(real, 'keep.txt')), 'target must be untouched');
  fs.rmSync(base, { recursive: true, force: true });
});

test('removeProfile deletes a real directory tree', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-rm-'));
  const root = path.join(base, 'ClaudeProfiles');
  const dir = path.join(root, 'victim');
  fs.mkdirSync(path.join(dir, 'nested'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'nested', 'f.txt'), 'x');

  await del.removeProfile({
    account: { id: 'v', label: 'Victim', kind: 'managed', dir, createdAt: 'x' },
    runningDirs: [], confirmLabel: 'Victim', unlockOutsideRoot: false,
    profilesRoot: root, userProfile: base, skipExistence: false
  });

  assert.ok(!fs.existsSync(dir));
  assert.ok(fs.existsSync(root), 'the managed root itself must survive');
  fs.rmSync(base, { recursive: true, force: true });
});

test('removeProfile refuses to run when a guard fails', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-rm2-'));
  const root = path.join(base, 'ClaudeProfiles');
  const dir = path.join(root, 'safe');
  fs.mkdirSync(dir, { recursive: true });

  await assert.rejects(() => del.removeProfile({
    account: { id: 's', label: 'Safe', kind: 'managed', dir, createdAt: 'x' },
    runningDirs: [], confirmLabel: 'WRONG', unlockOutsideRoot: false,
    profilesRoot: root, userProfile: base, skipExistence: false
  }), (e) => e.code === 'label_mismatch');

  assert.ok(fs.existsSync(dir), 'nothing may be deleted when a guard fails');
  fs.rmSync(base, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node --test test/deleter.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `src/main/deleter.js`**

`skipExistence` exists only so the pure guard tests can use fictional paths; production callers never pass it.

```js
'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const P = require('./paths.js');

class DeleteBlocked extends Error {
  constructor(code, message) { super(message); this.name = 'DeleteBlocked'; this.code = code; }
}

const MIN_SEGMENTS = 3;

async function checkDeletable({ account, runningDirs, confirmLabel, unlockOutsideRoot,
                                profilesRoot, userProfile, skipExistence = false }) {
  if (account.kind === 'default') {
    throw new DeleteBlocked('default_account',
      'The default account cannot be deleted from here.');
  }

  const dir = P.normalizeDir(account.dir);
  if (dir === null) throw new DeleteBlocked('missing', 'This account has no valid folder.');

  const running = new Set((runningDirs || []).map(P.normalizeDir).filter(Boolean));
  if (running.has(dir)) {
    throw new DeleteBlocked('running',
      'This account is open. Close its Claude window first.');
  }

  if (!skipExistence && !fs.existsSync(account.dir)) {
    throw new DeleteBlocked('missing', 'That folder no longer exists.');
  }

  if (!skipExistence && await P.isReparsePoint(account.dir)) {
    throw new DeleteBlocked('reparse_point',
      'That folder is a junction or symbolic link and will not be deleted.');
  }

  if (P.isDriveRoot(dir)) throw new DeleteBlocked('drive_root', 'Refusing to delete a drive root.');
  if (P.samePath(dir, userProfile)) {
    throw new DeleteBlocked('user_profile_root', 'Refusing to delete your user folder.');
  }
  if (P.segmentCount(dir) < MIN_SEGMENTS) {
    throw new DeleteBlocked('too_shallow', 'That path is too close to the drive root.');
  }

  if (!P.isInside(dir, profilesRoot)) {
    const allowed = account.kind === 'imported' && unlockOutsideRoot === true;
    if (!allowed) {
      throw new DeleteBlocked('outside_root',
        'That folder is outside the Multi-Claude profiles folder. Tick the unlock box to delete it anyway.');
    }
  }

  if (confirmLabel !== account.label) {
    throw new DeleteBlocked('label_mismatch', 'The name you typed does not match.');
  }
}

async function removeProfile(opts) {
  await checkDeletable(opts);
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await fsp.rm(opts.account.dir, { recursive: true, force: true });
      return;
    } catch (e) {
      lastErr = e;
      if (e.code !== 'EBUSY' && e.code !== 'EPERM' && e.code !== 'ENOTEMPTY') break;
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  const e = new DeleteBlocked('partial',
    'The folder could not be fully deleted. Close Claude and try again.');
  e.cause = lastErr;
  throw e;
}

module.exports = { DeleteBlocked, checkDeletable, removeProfile, MIN_SEGMENTS };
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test test/deleter.test.js`
Expected: PASS, 14/14

- [ ] **Step 5: Commit**

```bash
git add src/main/deleter.js test/deleter.test.js
git commit -m "feat: guarded permanent deletion of profile folders"
```

---

### Task 6: Claude executable locator

**Files:**
- Create: `src/main/claude-locator.js`
- Test: `test/claude-locator.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `createLocator({ fsImpl, env, runPowerShell }): { resolve(cachedPath): Promise<string|null> }`

Resolution order, first hit wins: `cachedPath` if it still exists → newest `%LOCALAPPDATA%\AnthropicClaude\app-*\claude.exe` → `%LOCALAPPDATA%\AnthropicClaude\claude.exe` → `(Get-AppxPackage *Claude*).InstallLocation` + `\app\claude.exe` → `null`.

"Newest" means descending lexicographic sort of the `app-*` directory names, matching the existing `.bat`'s `dir /o-n`.

- [ ] **Step 1: Write the failing test**

```js
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
      return [...names];
    }
  };
}

const ENV = { LOCALAPPDATA: 'C:\\LA' };
const never = async () => { throw new Error('PowerShell should not have been called'); };

test('uses the cached path when it still exists', async () => {
  const l = loc.createLocator({ fsImpl: fakeFs(['C:\\cached\\claude.exe']), env: ENV, runPowerShell: never });
  assert.strictEqual(await l.resolve('C:\\cached\\claude.exe'), 'C:\\cached\\claude.exe');
});

test('ignores a stale cached path and falls through', async () => {
  const fsImpl = fakeFs(['C:\\LA\\AnthropicClaude\\app-1.2.3\\claude.exe']);
  const l = loc.createLocator({ fsImpl, env: ENV, runPowerShell: never });
  assert.strictEqual(await l.resolve('C:\\gone\\claude.exe'),
    'C:\\LA\\AnthropicClaude\\app-1.2.3\\claude.exe');
});

test('picks the newest app-* folder', async () => {
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
  assert.strictEqual(await l.resolve(null),
    'C:\\Program Files\\WindowsApps\\Claude_4_x64__abc\\app\\claude.exe');
});

test('returns null when nothing is found and PowerShell fails', async () => {
  const l = loc.createLocator({
    fsImpl: fakeFs([]), env: ENV,
    runPowerShell: async () => { throw new Error('no appx'); }
  });
  assert.strictEqual(await l.resolve(null), null);
});
```

Note on the "newest" test: `'app-1.2.3' > 'app-1.10.0'` lexicographically, so `1.2.3` is the expected winner. This deliberately matches the existing `.bat` rather than doing semver comparison; with a single installed version — the normal case — the distinction never arises.

- [ ] **Step 2: Run it and confirm it fails**

Run: `node --test test/claude-locator.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `src/main/claude-locator.js`**

```js
'use strict';
const path = require('node:path');

function createLocator({ fsImpl, env, runPowerShell }) {
  const exists = (p) => { try { return fsImpl.existsSync(p); } catch { return false; } };

  function fromAppFolders() {
    const base = path.join(env.LOCALAPPDATA || '', 'AnthropicClaude');
    let names;
    try { names = fsImpl.readdirSync(base); } catch { return null; }
    const apps = names.filter((n) => n.toLowerCase().startsWith('app-')).sort().reverse();
    for (const n of apps) {
      const exe = path.join(base, n, 'claude.exe');
      if (exists(exe)) return exe;
    }
    return null;
  }

  async function fromAppx() {
    let out;
    try { out = await runPowerShell('(Get-AppxPackage *Claude*).InstallLocation'); }
    catch { return null; }
    for (const line of String(out).split(/\r?\n/)) {
      const dir = line.trim();
      if (!dir) continue;
      const exe = path.join(dir, 'app', 'claude.exe');
      if (exists(exe)) return exe;
    }
    return null;
  }

  return {
    async resolve(cachedPath) {
      if (cachedPath && exists(cachedPath)) return cachedPath;
      const fromApps = fromAppFolders();
      if (fromApps) return fromApps;
      const flat = path.join(env.LOCALAPPDATA || '', 'AnthropicClaude', 'claude.exe');
      if (exists(flat)) return flat;
      return await fromAppx();
    }
  };
}

module.exports = { createLocator };
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test test/claude-locator.test.js`
Expected: PASS, 6/6

- [ ] **Step 5: Commit**

```bash
git add src/main/claude-locator.js test/claude-locator.test.js
git commit -m "feat: resolve claude.exe across Store and classic installs"
```

---

### Task 7: Launcher, shortcuts, and the `--launch` argument

**Files:**
- Create: `src/main/launcher.js`, `src/main/shortcuts.js`, `src/main/argv.js`
- Test: `test/launcher.test.js`, `test/argv.test.js`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `buildArgs(account): string[]` — `[]` for `kind: 'default'`, otherwise `['--user-data-dir=<dir>']`
  - `createLauncher({ spawnImpl }): { launch(exePath, account): void }`
  - `parseLaunchArg(argv: string[]): string | null` — understands `--launch <id>` and `--launch=<id>`
  - `shortcutName(label): string` — `Claude - <label>.lnk`, with characters illegal in filenames stripped
  - `createShortcut({ shell, desktopDir, exePath, account }): string` — returns the written `.lnk` path

- [ ] **Step 1: Write the failing tests**

```js
// test/launcher.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const L = require('../src/main/launcher.js');
const S = require('../src/main/shortcuts.js');

test('the default account launches with no flag', () => {
  assert.deepStrictEqual(L.buildArgs({ kind: 'default', dir: 'C:\\whatever' }), []);
});

test('other accounts launch with --user-data-dir', () => {
  assert.deepStrictEqual(
    L.buildArgs({ kind: 'managed', dir: 'C:\\Users\\Bob\\ClaudeProfiles\\personal' }),
    ['--user-data-dir=C:\\Users\\Bob\\ClaudeProfiles\\personal']
  );
});

test('launch spawns detached, unreferenced, with stdio ignored', () => {
  const calls = [];
  let unrefed = false;
  const spawnImpl = (exe, args, opts) => {
    calls.push({ exe, args, opts });
    return { unref: () => { unrefed = true; } };
  };
  const launcher = L.createLauncher({ spawnImpl });
  launcher.launch('C:\\x\\claude.exe', { kind: 'managed', dir: 'C:\\p' });

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].exe, 'C:\\x\\claude.exe');
  assert.deepStrictEqual(calls[0].args, ['--user-data-dir=C:\\p']);
  assert.strictEqual(calls[0].opts.detached, true);
  assert.strictEqual(calls[0].opts.stdio, 'ignore');
  assert.ok(unrefed, 'the child must be unref()ed so Multi-Claude can exit');
});

test('shortcutName is a legal filename', () => {
  assert.strictEqual(S.shortcutName('Work'), 'Claude - Work.lnk');
  assert.strictEqual(S.shortcutName('A/B:C*?'), 'Claude - ABC.lnk');
  assert.strictEqual(S.shortcutName(''), 'Claude - account.lnk');
});

test('createShortcut targets Multi-Claude with --launch <id>', () => {
  const written = [];
  const shell = { writeShortcutLink: (p, op, opts) => { written.push({ p, op, opts }); return true; } };
  const out = S.createShortcut({
    shell, desktopDir: 'C:\\Desktop', exePath: 'C:\\MC\\Multi-Claude.exe',
    account: { id: 'abc123', label: 'Work' }
  });
  assert.strictEqual(out, 'C:\\Desktop\\Claude - Work.lnk');
  assert.strictEqual(written[0].opts.target, 'C:\\MC\\Multi-Claude.exe');
  assert.strictEqual(written[0].opts.args, '--launch abc123');
});
```

```js
// test/argv.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseLaunchArg } = require('../src/main/argv.js');

test('parses both --launch forms', () => {
  assert.strictEqual(parseLaunchArg(['electron.exe', '.', '--launch', 'abc123']), 'abc123');
  assert.strictEqual(parseLaunchArg(['app.exe', '--launch=abc123']), 'abc123');
});

test('returns null when absent or malformed', () => {
  assert.strictEqual(parseLaunchArg(['app.exe']), null);
  assert.strictEqual(parseLaunchArg(['app.exe', '--launch']), null);
  assert.strictEqual(parseLaunchArg(['app.exe', '--launch', '--other']), null);
  assert.strictEqual(parseLaunchArg(['app.exe', '--launch=']), null);
});

test('rejects ids that are not plain hex', () => {
  assert.strictEqual(parseLaunchArg(['app.exe', '--launch', '../../etc']), null);
  assert.strictEqual(parseLaunchArg(['app.exe', '--launch', 'abc 123']), null);
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `node --test test/launcher.test.js test/argv.test.js`
Expected: FAIL — modules not found

- [ ] **Step 3: Implement the three modules**

```js
// src/main/argv.js
'use strict';
function parseLaunchArg(argv) {
  const args = Array.isArray(argv) ? argv : [];
  let raw = null;
  for (let i = 0; i < args.length; i++) {
    const a = String(args[i]);
    if (a.startsWith('--launch=')) { raw = a.slice('--launch='.length); break; }
    if (a === '--launch') { raw = i + 1 < args.length ? String(args[i + 1]) : null; break; }
  }
  if (!raw || !/^[0-9a-f]{8}$/.test(raw)) return null;   // ids are 8 hex chars; reject anything else
  return raw;
}
module.exports = { parseLaunchArg };
```

```js
// src/main/launcher.js
'use strict';
function buildArgs(account) {
  return account.kind === 'default' ? [] : [`--user-data-dir=${account.dir}`];
}
function createLauncher({ spawnImpl }) {
  return {
    launch(exePath, account) {
      const child = spawnImpl(exePath, buildArgs(account), {
        detached: true, stdio: 'ignore', windowsHide: false
      });
      child.unref();
    }
  };
}
module.exports = { buildArgs, createLauncher };
```

```js
// src/main/shortcuts.js
'use strict';
const path = require('node:path');

function shortcutName(label) {
  const clean = String(label == null ? '' : label).replace(/[\\/:*?"<>|]/g, '').trim();
  return `Claude - ${clean === '' ? 'account' : clean}.lnk`;
}

function createShortcut({ shell, desktopDir, exePath, account }) {
  const target = path.join(desktopDir, shortcutName(account.label));
  shell.writeShortcutLink(target, 'create', {
    target: exePath,
    args: `--launch ${account.id}`,
    icon: exePath,
    iconIndex: 0,
    description: `Open Claude with the ${account.label} profile`
  });
  return target;
}
module.exports = { shortcutName, createShortcut };
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test test/launcher.test.js test/argv.test.js`
Expected: PASS, 8/8

- [ ] **Step 5: Commit**

```bash
git add src/main/launcher.js src/main/shortcuts.js src/main/argv.js test/launcher.test.js test/argv.test.js
git commit -m "feat: profile launching, desktop shortcuts, and --launch handling"
```

---

### Task 8: Application service — seeding and operations

**Files:**
- Create: `src/main/service.js`
- Test: `test/service.test.js`

**Interfaces:**
- Consumes: `store`, `profiles`, `deleter`, `launcher`, `scanner`, `claude-locator`
- Produces: `createService(deps): { init, list, add, rename, launch, remove, openFolder, createShortcut, setExePath, scan }`

`deps` is `{ configFile, profilesRoot, userProfile, defaultProfileDir, locator, launcher, scanner, shellImpl, desktopDir, appExePath }`. Every operation resolves an account by id from the store and never trusts a caller-supplied path.

Seeding on `init()`, when the store has no accounts:
1. Register `defaultProfileDir` as `{ kind: 'default', label: 'Default' }`.
2. If `<userProfile>\Claude_Work` exists, register it as `{ kind: 'imported', label: 'Work' }`.
3. `mkdir -p` the managed root.

- [ ] **Step 1: Write the failing test**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createService } = require('../src/main/service.js');

function harness() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-svc-'));
  const userProfile = path.join(base, 'user');
  const profilesRoot = path.join(userProfile, 'ClaudeProfiles');
  const defaultProfileDir = path.join(base, 'default-profile');
  fs.mkdirSync(userProfile, { recursive: true });
  fs.mkdirSync(defaultProfileDir, { recursive: true });
  const launched = [];
  const svc = createService({
    configFile: path.join(base, 'cfg', 'accounts.json'),
    profilesRoot, userProfile, defaultProfileDir,
    locator: { resolve: async () => 'C:\\fake\\claude.exe' },
    launcher: { launch: (exe, acct) => launched.push({ exe, id: acct.id }) },
    scanner: { scan: async () => ({ dirs: [], ok: true }) },
    shellImpl: { writeShortcutLink: () => true, openPath: async () => '' },
    desktopDir: path.join(base, 'desktop'),
    appExePath: 'C:\\MC\\Multi-Claude.exe'
  });
  return { base, userProfile, profilesRoot, defaultProfileDir, svc, launched };
}

test('init seeds the default account', async () => {
  const h = harness();
  await h.svc.init();
  const list = await h.svc.list();
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].kind, 'default');
  assert.strictEqual(list[0].label, 'Default');
  fs.rmSync(h.base, { recursive: true, force: true });
});

test('init imports an existing Claude_Work folder', async () => {
  const h = harness();
  fs.mkdirSync(path.join(h.userProfile, 'Claude_Work'));
  await h.svc.init();
  const list = await h.svc.list();
  assert.strictEqual(list.length, 2);
  const work = list.find((a) => a.label === 'Work');
  assert.strictEqual(work.kind, 'imported');
  fs.rmSync(h.base, { recursive: true, force: true });
});

test('init creates the managed root and is idempotent', async () => {
  const h = harness();
  await h.svc.init();
  await h.svc.init();
  assert.ok(fs.existsSync(h.profilesRoot));
  assert.strictEqual((await h.svc.list()).length, 1);
  fs.rmSync(h.base, { recursive: true, force: true });
});

test('add creates a folder, persists, and launches it', async () => {
  const h = harness();
  await h.svc.init();
  const a = await h.svc.add({ label: 'My Personal' });
  assert.strictEqual(a.kind, 'managed');
  assert.strictEqual(a.dir, path.join(h.profilesRoot, 'my-personal'));
  assert.ok(fs.existsSync(a.dir));
  assert.strictEqual(h.launched.length, 1);
  assert.strictEqual(h.launched[0].id, a.id);
  fs.rmSync(h.base, { recursive: true, force: true });
});

test('add resolves slug collisions', async () => {
  const h = harness();
  await h.svc.init();
  const a = await h.svc.add({ label: 'Work' });
  const b = await h.svc.add({ label: 'Work' });
  assert.strictEqual(path.basename(a.dir), 'work');
  assert.strictEqual(path.basename(b.dir), 'work-2');
  fs.rmSync(h.base, { recursive: true, force: true });
});

test('rename changes the label but never the folder', async () => {
  const h = harness();
  await h.svc.init();
  const a = await h.svc.add({ label: 'Old' });
  const dirBefore = a.dir;
  const b = await h.svc.rename({ id: a.id, label: 'New Name' });
  assert.strictEqual(b.label, 'New Name');
  assert.strictEqual(b.dir, dirBefore);
  assert.ok(fs.existsSync(dirBefore));
  fs.rmSync(h.base, { recursive: true, force: true });
});

test('remove deletes the folder and forgets the account', async () => {
  const h = harness();
  await h.svc.init();
  const a = await h.svc.add({ label: 'Temp' });
  await h.svc.remove({ id: a.id, confirmLabel: 'Temp', unlockOutsideRoot: false });
  assert.ok(!fs.existsSync(a.dir));
  assert.ok(!(await h.svc.list()).some((x) => x.id === a.id));
  fs.rmSync(h.base, { recursive: true, force: true });
});

test('remove refuses the default account and keeps it listed', async () => {
  const h = harness();
  await h.svc.init();
  const def = (await h.svc.list())[0];
  await assert.rejects(
    () => h.svc.remove({ id: def.id, confirmLabel: 'Default', unlockOutsideRoot: false }),
    (e) => e.code === 'default_account'
  );
  assert.strictEqual((await h.svc.list()).length, 1);
  fs.rmSync(h.base, { recursive: true, force: true });
});

test('operations on an unknown id are rejected', async () => {
  const h = harness();
  await h.svc.init();
  for (const op of [
    () => h.svc.launch({ id: 'deadbeef' }),
    () => h.svc.rename({ id: 'deadbeef', label: 'x' }),
    () => h.svc.remove({ id: 'deadbeef', confirmLabel: 'x', unlockOutsideRoot: false })
  ]) {
    await assert.rejects(op, (e) => e.code === 'unknown_account');
  }
  fs.rmSync(h.base, { recursive: true, force: true });
});

test('scan marks the running account', async () => {
  const h = harness();
  await h.svc.init();
  const a = await h.svc.add({ label: 'Live' });
  h.svc._setScannerForTest({ scan: async () => ({ dirs: [a.dir.toLowerCase()], ok: true }) });
  const state = await h.svc.scan();
  assert.strictEqual(state.ok, true);
  assert.ok(state.running.includes(a.id));
  fs.rmSync(h.base, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node --test test/service.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `src/main/service.js`**

Structure: hold the store in memory after `init()`, persist on every mutation, and expose a `_setScannerForTest` hatch used only by the test above.

```js
'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const store = require('./store.js');
const profiles = require('./profiles.js');
const deleter = require('./deleter.js');
const P = require('./paths.js');

function err(code, message) { const e = new Error(message); e.code = code; return e; }

function createService(deps) {
  let data = store.emptyStore();
  let scanner = deps.scanner;

  const persist = () => store.save(deps.configFile, data);
  const find = (id) => {
    const a = data.accounts.find((x) => x.id === id);
    if (!a) throw err('unknown_account', 'That account is no longer in the list.');
    return a;
  };

  async function exe() {
    const resolved = await deps.locator.resolve(data.exePath);
    if (!resolved) throw err('no_exe', 'Could not find claude.exe. Use "Locate claude.exe…".');
    if (resolved !== data.exePath) { data.exePath = resolved; await persist(); }
    return resolved;
  }

  return {
    async init() {
      const { data: loaded, recoveredFrom } = await store.load(deps.configFile);
      data = loaded;
      if (data.accounts.length === 0) {
        const now = () => new Date().toISOString();
        data.accounts.push({ id: profiles.newId(), label: 'Default', kind: 'default',
                             dir: deps.defaultProfileDir, createdAt: now() });
        const work = path.join(deps.userProfile, 'Claude_Work');
        if (fs.existsSync(work)) {
          data.accounts.push({ id: profiles.newId(), label: 'Work', kind: 'imported',
                               dir: work, createdAt: now() });
        }
        await persist();
      }
      await fsp.mkdir(deps.profilesRoot, { recursive: true });
      return { recoveredFrom };
    },

    async list() {
      return data.accounts.map((a) => ({ ...a, exists: fs.existsSync(a.dir) }));
    },

    async add({ label }) {
      const clean = String(label || '').trim();
      if (clean === '') throw err('bad_label', 'Give the account a name.');
      const taken = new Set(data.accounts.map((a) => path.basename(a.dir).toLowerCase()));
      const slug = profiles.uniqueSlug(profiles.slugify(clean), taken);
      const dir = path.join(deps.profilesRoot, slug);
      await fsp.mkdir(dir, { recursive: true });
      const account = { id: profiles.newId(), label: clean, kind: 'managed',
                        dir, createdAt: new Date().toISOString() };
      data.accounts.push(account);
      await persist();
      deps.launcher.launch(await exe(), account);
      return account;
    },

    async rename({ id, label }) {
      const clean = String(label || '').trim();
      if (clean === '') throw err('bad_label', 'Give the account a name.');
      const a = find(id);
      a.label = clean;                     // the folder on disk is never renamed
      await persist();
      return a;
    },

    async launch({ id }) {
      deps.launcher.launch(await exe(), find(id));
      return { ok: true };
    },

    async remove({ id, confirmLabel, unlockOutsideRoot }) {
      const account = find(id);
      const { dirs } = await scanner.scan();
      await deleter.removeProfile({
        account, runningDirs: dirs, confirmLabel, unlockOutsideRoot: unlockOutsideRoot === true,
        profilesRoot: deps.profilesRoot, userProfile: deps.userProfile
      });
      data.accounts = data.accounts.filter((x) => x.id !== id);
      await persist();
      return { ok: true };
    },

    async forget({ id }) {
      find(id);
      data.accounts = data.accounts.filter((x) => x.id !== id);
      await persist();
      return { ok: true };
    },

    async openFolder({ id }) {
      const a = find(id);
      if (!fs.existsSync(a.dir)) throw err('missing', 'That folder no longer exists.');
      await deps.shellImpl.openPath(a.dir);
      return { ok: true };
    },

    async createShortcut({ id }) {
      const a = find(id);
      await fsp.mkdir(deps.desktopDir, { recursive: true });
      const { createShortcut } = require('./shortcuts.js');
      return { path: createShortcut({ shell: deps.shellImpl, desktopDir: deps.desktopDir,
                                      exePath: deps.appExePath, account: a }) };
    },

    async setExePath(p) { data.exePath = p; await persist(); return { ok: true }; },

    async scan() {
      const { dirs, ok } = await scanner.scan();
      const set = new Set(dirs.map(P.normalizeDir).filter(Boolean));
      const running = data.accounts.filter((a) => set.has(P.normalizeDir(a.dir))).map((a) => a.id);
      return { running, ok };
    },

    async sizes() {
      const out = {};
      for (const a of data.accounts) out[a.id] = await profiles.dirSize(a.dir);
      return out;
    },

    _setScannerForTest(s) { scanner = s; }
  };
}

module.exports = { createService };
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test test/service.test.js`
Expected: PASS, 10/10

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: all suites green

- [ ] **Step 6: Commit**

```bash
git add src/main/service.js test/service.test.js
git commit -m "feat: account service with seeding, add, rename, launch, delete"
```

---

### Task 9: Wiring — IPC, preload, single instance

**Files:**
- Modify: `src/main/main.js`
- Create: `src/main/ipc.js`, `src/main/run-powershell.js`, `src/preload/preload.js`

**Interfaces:**
- Consumes: `service`, `argv.parseLaunchArg`
- Produces: `window.multiClaude` in the renderer, with exactly the calls listed in spec §4.2

Every handler returns `{ ok: true, value }` or `{ ok: false, code, message }` — errors are never thrown across the IPC boundary, so the renderer always gets a structured answer.

- [ ] **Step 1: Write `src/main/run-powershell.js`**

```js
'use strict';
const { execFile } = require('node:child_process');

function runPowerShell(command) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
      { windowsHide: true, maxBuffer: 4 * 1024 * 1024, timeout: 15000 },
      (e, stdout) => (e ? reject(e) : resolve(stdout)));
  });
}
module.exports = { runPowerShell };
```

- [ ] **Step 2: Write `src/main/ipc.js`**

```js
'use strict';
const { ipcMain, dialog } = require('electron');

const CHANNELS = ['list', 'add', 'rename', 'launch', 'remove', 'forget',
                  'openFolder', 'createShortcut', 'locateExe', 'scan', 'sizes'];

function register(service) {
  const wrap = (fn) => async (_event, payload) => {
    try { return { ok: true, value: await fn(payload || {}) }; }
    catch (e) { return { ok: false, code: e.code || 'error', message: e.message }; }
  };

  const handlers = {
    list: () => service.list(),
    add: (p) => service.add(p),
    rename: (p) => service.rename(p),
    launch: (p) => service.launch(p),
    remove: (p) => service.remove(p),
    forget: (p) => service.forget(p),
    openFolder: (p) => service.openFolder(p),
    createShortcut: (p) => service.createShortcut(p),
    scan: () => service.scan(),
    sizes: () => service.sizes(),
    locateExe: async () => {
      const r = await dialog.showOpenDialog({
        title: 'Locate claude.exe',
        properties: ['openFile'],
        filters: [{ name: 'Claude', extensions: ['exe'] }]
      });
      if (r.canceled || r.filePaths.length === 0) return { path: null };
      await service.setExePath(r.filePaths[0]);
      return { path: r.filePaths[0] };
    }
  };

  for (const c of CHANNELS) ipcMain.handle(`mc:${c}`, wrap(handlers[c]));
}

module.exports = { register, CHANNELS };
```

- [ ] **Step 3: Write `src/preload/preload.js`**

```js
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const call = (channel) => (payload) => ipcRenderer.invoke(`mc:${channel}`, payload);

contextBridge.exposeInMainWorld('multiClaude', {
  list: call('list'),
  add: call('add'),
  rename: call('rename'),
  launch: call('launch'),
  remove: call('remove'),
  forget: call('forget'),
  openFolder: call('openFolder'),
  createShortcut: call('createShortcut'),
  locateExe: call('locateExe'),
  scan: call('scan'),
  sizes: call('sizes')
});
```

- [ ] **Step 4: Rewrite `src/main/main.js`**

```js
'use strict';
const { app, BrowserWindow, shell } = require('electron');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const { createService } = require('./service.js');
const { createLocator } = require('./claude-locator.js');
const { createLauncher } = require('./launcher.js');
const { createScanner } = require('./scanner.js');
const { runPowerShell } = require('./run-powershell.js');
const { parseLaunchArg } = require('./argv.js');
const ipc = require('./ipc.js');

if (process.platform !== 'win32') { console.error('Multi-Claude is Windows-only.'); app.exit(1); }

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

const userProfile = os.homedir();
const familySuffix = 'claude_pzs8sxrjxfjjc';   // resolved below when a package is present
const service = createService({
  configFile: path.join(app.getPath('appData'), 'multi-claude', 'accounts.json'),
  profilesRoot: path.join(userProfile, 'ClaudeProfiles'),
  userProfile,
  defaultProfileDir: path.join(process.env.LOCALAPPDATA || '', 'Claude-Data', familySuffix),
  locator: createLocator({ fsImpl: require('node:fs'), env: process.env, runPowerShell }),
  launcher: createLauncher({ spawnImpl: spawn }),
  scanner: createScanner({ runPowerShell }),
  shellImpl: shell,
  desktopDir: app.getPath('desktop'),
  appExePath: process.execPath
});

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 760, height: 640, minWidth: 560, minHeight: 440,
    backgroundColor: '#1f1e1d', show: false, title: 'Multi-Claude',
    webPreferences: {
      contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true,
      preload: path.join(__dirname, '..', 'preload', 'preload.js')
    }
  });
  win.removeMenu();
  win.once('ready-to-show', () => win.show());
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

async function launchById(id) {
  try { await service.launch({ id }); } catch (e) { console.error('launch failed:', e.message); }
}

app.on('second-instance', async (_e, argv) => {
  const id = parseLaunchArg(argv);
  if (id) { await launchById(id); return; }
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});

app.whenReady().then(async () => {
  await service.init();
  const id = parseLaunchArg(process.argv);
  if (id) { await launchById(id); app.quit(); return; }   // shortcut mode: no window at all
  ipc.register(service);
  createWindow();
});

app.on('window-all-closed', () => app.quit());
```

- [ ] **Step 5: Resolve the default profile directory properly**

The hardcoded `familySuffix` above is a placeholder that must not ship. Replace it with a resolution that works on any machine: query the package family name once and derive the directory, falling back to the classic installer location.

Add to `src/main/claude-locator.js`:

```js
async function resolveDefaultProfileDir({ fsImpl, env, runPowerShell }) {
  try {
    const out = await runPowerShell('(Get-AppxPackage *Claude*).PackageFamilyName');
    const family = String(out).split(/\r?\n/).map((s) => s.trim()).find(Boolean);
    if (family) {
      const dir = require('node:path').join(env.LOCALAPPDATA || '', 'Claude-Data', family.toLowerCase());
      if (fsImpl.existsSync(dir)) return dir;
    }
  } catch { /* fall through to the classic location */ }
  return require('node:path').join(env.APPDATA || '', 'Claude');
}
```

Export it, and in `main.js` build the service after `app.whenReady()` so the lookup can be awaited:

```js
const defaultProfileDir = await resolveDefaultProfileDir({
  fsImpl: require('node:fs'), env: process.env, runPowerShell
});
```

Restructure `main.js` so `createService(...)` runs inside `app.whenReady()` with that value, rather than at module load.

- [ ] **Step 6: Verify end to end by hand**

Run: `npm start`

Check: the window opens; the console shows no errors. (The UI is still the Task 0 placeholder — Task 10 replaces it.) In DevTools, `await window.multiClaude.list()` returns `{ok: true, value: [...]}` with the Default and Work accounts, and `await window.multiClaude.scan()` reports the default account as running while Claude is open.

- [ ] **Step 7: Commit**

```bash
git add src/main/main.js src/main/ipc.js src/main/run-powershell.js src/preload/preload.js src/main/claude-locator.js
git commit -m "feat: wire IPC, preload bridge, and single-instance shortcut launching"
```

---

### Task 10: Renderer UI

**Files:**
- Modify: `src/renderer/index.html`
- Create: `src/renderer/styles.css`, `src/renderer/app.js`

**Interfaces:**
- Consumes: `window.multiClaude`
- Produces: the finished single-screen UI

**Layout.** A header with the title, an account count and an `+ Add account` button; a scrolling list of account rows; a footer line reading `Not affiliated with, or endorsed by, Anthropic.`

Each row shows: a status dot (green `running`, grey `idle`, amber `unknown` when `scan.ok === false`), the label, the folder path in small muted type, the size once `sizes()` returns, and buttons `Launch`, `Folder`, `Shortcut`, `Rename`, `Delete`. The default account's row carries a `Default` pill and its `Delete` button is `disabled` with `title="The default account cannot be deleted."`. A row whose `exists` is `false` is dimmed, shows `folder missing`, and replaces `Delete` with `Forget`.

**Delete dialog** — a `<dialog>` element containing, in order:
1. `Permanently delete "<label>"?`
2. `This erases the profile folder on this PC: <dir>`
3. `Your Anthropic account is not affected. Nothing can delete that from here.`
4. When the account sits outside the managed root: a checkbox labelled `This folder is outside the Multi-Claude profiles folder. Delete it anyway.`
5. A text input labelled `Type <label> to confirm`
6. `Cancel` (autofocused) and `Delete permanently` (disabled until the typed text matches exactly, and until the checkbox is ticked where one is shown)

**Polling.** Call `scan()` on load and every 5000 ms, but only while `document.hasFocus()`; listen for `focus` and `blur` on `window` to start and stop the timer. Call `scan()` immediately after any `launch()` or `add()`. Call `sizes()` on load and after any delete, never on the timer.

- [ ] **Step 1: Write `src/renderer/styles.css`**

Dark theme matching the main process `backgroundColor`. Tokens: `--bg: #1f1e1d`, `--surface: #262625`, `--border: #3a3937`, `--text: #f0eee6`, `--muted: #a3a097`, `--accent: #c96442`, `--danger: #d4594a`, `--ok: #4ade80`. Rows are `display: grid` with the actions in a right-aligned flex group; the whole layout must stay usable at the 560 px minimum width, wrapping the action buttons under the label rather than overflowing.

- [ ] **Step 2: Write `src/renderer/index.html`**

Must contain the CSP meta tag verbatim from Global Constraints, link `styles.css`, include the `<dialog>` markup for delete and rename, and load `app.js` with `defer`. No inline `<script>` or `<style>` — the CSP forbids both.

- [ ] **Step 3: Write `src/renderer/app.js`**

A `render(accounts, runningIds, scanOk, sizes)` function that rebuilds the list, plus thin handlers that call `window.multiClaude.*` and surface `{ok: false}` responses as a toast carrying `message`. All DOM built with `document.createElement` and `textContent` — never `innerHTML` with account labels, since a label is free text.

- [ ] **Step 4: Verify by hand**

Run: `npm start`

Check each of these:
- Default and Work are listed; Default shows its pill and a disabled Delete.
- `+ Add account` → name it `Test Delete Me` → a folder appears at `C:\Users\BS01085\ClaudeProfiles\test-delete-me` and Claude opens signed out.
- Within ~5 s the new account's dot turns green, and so does Default if Claude is open.
- `Folder` opens Explorer at the right directory.
- `Shortcut` writes `Claude - Test Delete Me.lnk` to the Desktop; close Multi-Claude, double-click the shortcut, and Claude opens on that profile with no Multi-Claude window appearing.
- `Rename` to `Renamed` changes the label while the folder stays `test-delete-me`.
- `Delete` while the account is open → refused with "Close its Claude window first."
- Close that Claude window, delete again, type the wrong name → the button stays disabled. Type `Renamed` → the folder is gone from disk and the row disappears.
- `Claude-Account2.bat` still works unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/
git commit -m "feat: account manager UI"
```

---

### Task 11: Packaging and README

**Files:**
- Modify: `package.json`
- Create: `build/icon.ico`, `README.md`

- [ ] **Step 1: Add the electron-builder config to `package.json`**

```json
{
  "build": {
    "appId": "dev.multiclaude.app",
    "productName": "Multi-Claude",
    "directories": { "output": "dist", "buildResources": "build" },
    "files": ["src/**/*", "package.json"],
    "win": { "target": ["nsis", "portable"], "icon": "build/icon.ico" },
    "nsis": {
      "oneClick": false,
      "perMachine": false,
      "allowToChangeInstallationDirectory": true,
      "createDesktopShortcut": true
    }
  }
}
```

- [ ] **Step 2: Provide `build/icon.ico`**

A 256×256 `.ico`. Do not reuse Claude's icon — it is Anthropic's mark and this is not an Anthropic product. A plain generated glyph is fine.

- [ ] **Step 3: Write `README.md`**

Must cover: what it does; that it uses Chromium's stock `--user-data-dir` and modifies nothing about Claude Desktop; that it must not be used to pool or rotate accounts around usage limits; that delete removes local data only and never the Anthropic account; that the build is unsigned so SmartScreen warns on first run and the way past it is "More info → Run anyway"; and the line `Not affiliated with, or endorsed by, Anthropic.`

- [ ] **Step 4: Build and verify the installer**

Run: `npm run dist`
Expected: `dist/Multi-Claude Setup 1.0.0.exe` and a portable exe. Install it, launch from the Start Menu, confirm the account list loads, and confirm a desktop shortcut created by the installed build still launches the right profile.

- [ ] **Step 5: Commit**

```bash
git add package.json build/ README.md
git commit -m "chore: package with electron-builder and document usage"
```

---

## Self-Review

**Spec coverage.** §2.2 forbidden features → Global Constraints. §3 environment → Tasks 6 and 9 Step 5. §4.1 modules → Tasks 1–8 (`ipc.js` in Task 9). §4.2 IPC surface → Task 9 Step 2, plus `forget` and `sizes`, which the spec's error-handling table requires but its IPC list omitted; the spec should be read as including them. §4.3 renderer hardening → Task 0 Step 4, Task 9 Step 4, Task 10 Step 2. §5 data model → Task 2. §5.1 seeding → Task 8. §6.1–6.6 flows → Tasks 7, 8, 10. §7 error handling → every row has a code in Task 8 or Task 5. §8 testing → Tasks 1–8 plus the manual list in Task 10 Step 4. §9 packaging → Task 11. §10 limitations → README.

**Placeholder scan.** The only `TODO`-shaped item is the hardcoded `familySuffix` in Task 9 Step 4, which Step 5 of the same task removes; it is called out explicitly as "must not ship" rather than left implicit.

**Type consistency.** `normalizeDir` returns `string | null` and every caller null-checks. `scan()` returns `{running: string[], ok: boolean}` in both the service and the renderer. `DeleteBlocked.code` values in Task 5 match those asserted in Task 8 and rendered in Task 10. `buildArgs` is consumed only by `createLauncher`. `createShortcut` is defined in Task 7 and called through the service in Task 8.

**Known deviation.** The spec's §6.3 says sizes are "cached for 60 s"; this plan instead fetches sizes on load and after deletes, never on a timer. That is simpler and strictly cheaper, and it removes the cache entirely. Noted here rather than silently changed.
