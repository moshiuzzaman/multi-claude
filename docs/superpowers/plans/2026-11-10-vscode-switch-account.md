# Switch VS Code's Claude Account In Place — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the VS Code button makes the VS Code you already have open use that account — no second window, no second profile, no re-login to extensions.

**Architecture:** The Claude Code extension watches `claudeCode.environmentVariables` and refreshes its hosts in place when `CLAUDE_CONFIG_DIR` changes. So switching accounts is a write to the user's real `settings.json`. That file is JSONC and must never be parsed, so the setting lives inside comment markers and is replaced as a whole block. The per-account `--user-data-dir` machinery from v1 is removed.

**Tech Stack:** Node 22, Electron 33, React 18, `node:test`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-10-vscode-switch-account-design.md`
**Supersedes:** `docs/superpowers/plans/2026-11-10-vscode-per-account.md` (shipped, now being partly reverted)

## Global Constraints

- Windows only. No new runtime dependency: `package.json`'s `files` array ships only `src/`, `dist-renderer/` and `package.json`, so anything in `node_modules` would not be packaged. **`settings.json` is JSONC — never parse it.**
- Binaries are launched directly, never through a shell.
- The preload bridge passes account ids only — never a filesystem path.
- Multi-Claude never reads, copies or intermediates a credential.
- Writes to a user-owned file are atomic: backup, write a temp file, rename. Mirrors the existing cache writes in `service.js`.
- Tests run under `node --test` with no Electron and no network.
- Commits made by an agent end with a `Co-Authored-By:` trailer naming that agent's own model.

---

### Task 1: The settings block

**Files:**
- Create: `src/main/vscode-settings.js`
- Test: `test/vscode-settings.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `OVERRIDE_KEY`, `BEGIN`, `END`, `readManaged(text) -> string|null`, `hasForeignKey(text) -> boolean`, `writeManaged(text, ccDir) -> string`.

- [ ] **Step 1: Write the failing test**

Create `test/vscode-settings.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const S = require('../src/main/vscode-settings.js');

const DIR = 'C:\\Users\\me\\AppData\\Roaming\\multi-claude\\cc\\abc123';

test('readManaged returns null when there is no block', () => {
  assert.strictEqual(S.readManaged('{ "a": 1, }'), null);
});

test('writeManaged inserts a block and readManaged reads it back', () => {
  const out = S.writeManaged('{\n  "a": 1,\n}\n', DIR);
  assert.strictEqual(S.readManaged(out), DIR);
  assert.ok(out.includes('"a": 1,'), 'the original settings survive');
});

test('writeManaged replaces the block instead of adding a second one', () => {
  const once = S.writeManaged('{\n  "a": 1,\n}\n', DIR);
  const twice = S.writeManaged(once, 'C:\\other\\cc\\zz');
  assert.strictEqual(S.readManaged(twice), 'C:\\other\\cc\\zz');
  assert.strictEqual(twice.split(S.BEGIN).length - 1, 1, 'exactly one block');
  assert.ok(!twice.includes('abc123'), 'the old value is gone');
});

test('writeManaged escapes backslashes so the file stays valid', () => {
  const out = S.writeManaged('{}', DIR);
  assert.ok(out.includes('\\\\Users\\\\me'), 'backslashes are doubled');
});

test('writeManaged builds a whole file from an empty string', () => {
  const out = S.writeManaged('', DIR);
  assert.ok(out.trimStart().startsWith('{'));
  assert.ok(out.trimEnd().endsWith('}'));
  assert.strictEqual(S.readManaged(out), DIR);
});

test('writeManaged keeps the file CRLF when it already is', () => {
  const out = S.writeManaged('{\r\n  "a": 1,\r\n}\r\n', DIR);
  assert.ok(!/[^\r]\n/.test(out), 'no bare LF was introduced');
});

test('hasForeignKey is false when the only key is ours', () => {
  assert.strictEqual(S.hasForeignKey(S.writeManaged('{}', DIR)), false);
});

test('hasForeignKey is true when the user set the key themselves', () => {
  const text = '{\n  "claudeCode.environmentVariables": [],\n}\n';
  assert.strictEqual(S.hasForeignKey(text), true);
  assert.strictEqual(S.hasForeignKey(S.writeManaged(text, DIR)), true);
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/main/vscode-settings.js'`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/main/vscode-settings.js`:

```js
'use strict';
// Writing CLAUDE_CONFIG_DIR into the user's own VS Code settings.
//
// The Claude Code extension watches `claudeCode.environmentVariables` and
// refreshes its hosts in place when CLAUDE_CONFIG_DIR changes, so switching
// account is a settings edit rather than a new window.
//
// settings.json is JSONC: it carries comments and trailing commas, so it must
// never be parsed — a tolerant parser would be this project's first runtime
// dependency, and the packaged build ships no node_modules. Instead the
// setting lives inside comment markers and is replaced as a whole block, which
// bounds the edit exactly without parsing anything.

const OVERRIDE_KEY = 'claudeCode.environmentVariables';
const BEGIN = '// >>> multi-claude: managed block — do not edit by hand';
const END = '// <<< multi-claude';

/** The block's extent in `text`, or null when it is not there. */
function findBlock(text) {
  const begin = text.indexOf(BEGIN);
  if (begin === -1) return null;
  const end = text.indexOf(END, begin);
  if (end === -1) return null;
  return { start: begin, end: end + END.length };
}

function blockText(ccDir, nl) {
  return [
    BEGIN,
    '  // Points Claude Code at the account Multi-Claude last switched to.',
    `  "${OVERRIDE_KEY}": [`,
    `    { "name": "CLAUDE_CONFIG_DIR", "value": ${JSON.stringify(ccDir)} }`,
    '  ],',
    END
  ].join(nl + '  ');
}

/** The config dir currently in the managed block, or null. */
function readManaged(text) {
  const s = String(text ?? '');
  const at = findBlock(s);
  if (!at) return null;
  const m = /"value"\s*:\s*("(?:[^"\\]|\\.)*")/.exec(s.slice(at.start, at.end));
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

/**
 * Does the key appear outside our block?
 *
 * Any occurrence counts, including one inside a comment: without a parser we
 * cannot tell the difference, and the conservative answer refuses to write
 * rather than risk overriding a setting the user made deliberately.
 */
function hasForeignKey(text) {
  const s = String(text ?? '');
  const at = findBlock(s);
  const outside = at ? s.slice(0, at.start) + s.slice(at.end) : s;
  return outside.includes(OVERRIDE_KEY);
}

/** The file text with the managed block inserted or replaced. */
function writeManaged(text, ccDir) {
  const s = String(text ?? '');
  const nl = s.includes('\r\n') ? '\r\n' : '\n';
  const block = blockText(ccDir, nl);

  const at = findBlock(s);
  if (at) return s.slice(0, at.start) + block + s.slice(at.end);

  const open = s.indexOf('{');
  if (open === -1) return `{${nl}  ${block}${nl}}${nl}`;
  return `${s.slice(0, open + 1)}${nl}  ${block}${s.slice(open + 1)}`;
}

module.exports = { OVERRIDE_KEY, BEGIN, END, readManaged, hasForeignKey, writeManaged };
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npm test`
Expected: PASS, with every pre-existing test still green.

- [ ] **Step 5: Commit**

```bash
git add src/main/vscode-settings.js test/vscode-settings.test.js
git commit -m "feat: read and write the managed CLAUDE_CONFIG_DIR settings block"
```

---

### Task 2: Reduce the VS Code module

**Files:**
- Modify: `src/main/vscode.js`
- Modify: `test/vscode.test.js`

**Interfaces:**
- Consumes: `src/main/run-powershell.js`'s `runPowerShell(command) -> Promise<stdout>`.
- Produces: `candidateEditors`, `findVsCode` (both unchanged), `launch(exePath, spawnImpl?) -> void`, `PS_RUNNING`, `parseRunning(stdout) -> boolean`, `createVsCodeProbe({ runPowerShell }) -> { isRunning() }`.
- Removes: `OVERRIDE_KEY`, `SEEDED_FILES`, `seedProfile`. `OVERRIDE_KEY` now lives in `vscode-settings.js`.

- [ ] **Step 1: Delete what v1 needed and v2 does not**

In `test/vscode.test.js`, delete every `seedProfile` test (all four, plus the `fsp`/`fsSync`/`os`/`tmp()` helpers they alone use). In the two `launch` tests, change the calls to the new signature and drop the `--user-data-dir` and `CLAUDE_CONFIG_DIR` assertions.

In `src/main/vscode.js`, delete `seedProfile`, `SEEDED_FILES`, `OVERRIDE_KEY`, and the `node:fs/promises` require. Replace the header comment, which currently argues for `--user-data-dir`:

```js
'use strict';
// Finding and starting VS Code.
//
// v1 of this feature gave every account its own --user-data-dir, because VS
// Code is single-instance per user-data-dir and a plain launch hands off to a
// running instance that keeps its own environment. That worked and was wrong:
// it produced a second window and a second profile, so every extension was
// signed out per account.
//
// The account now comes from the `claudeCode.environmentVariables` setting
// instead (see vscode-settings.js), which the extension watches and applies in
// place. So this module only has to find VS Code, say whether it is running,
// and start it when it is not.
```

- [ ] **Step 2: Write the failing tests for what is new**

Append to `test/vscode.test.js`:

```js
test('launch starts VS Code with no arguments, detached', () => {
  const calls = [];
  let unrefed = false;
  const spawnImpl = (exe, args, opts) => {
    calls.push({ exe, args, opts });
    return { unref: () => { unrefed = true; } };
  };

  V.launch('C:\\vs\\Code.exe', spawnImpl);

  assert.strictEqual(calls[0].exe, 'C:\\vs\\Code.exe');
  assert.deepStrictEqual(calls[0].args, [], 'the setting carries the account, not argv');
  assert.strictEqual(calls[0].opts.detached, true);
  assert.strictEqual(calls[0].opts.stdio, 'ignore');
  assert.ok(!calls[0].opts.shell, 'never through a shell');
  assert.ok(unrefed, 'the child must be unref()ed so Multi-Claude can exit');
});

test('parseRunning reads the probe output', () => {
  assert.strictEqual(V.parseRunning('yes\r\n'), true);
  assert.strictEqual(V.parseRunning('no\r\n'), false);
  assert.strictEqual(V.parseRunning(''), false);
});

test('isRunning asks PowerShell once and reports the answer', async () => {
  const asked = [];
  const probe = V.createVsCodeProbe({
    runPowerShell: async (cmd) => { asked.push(cmd); return 'yes\r\n'; }
  });
  assert.strictEqual(await probe.isRunning(), true);
  assert.strictEqual(asked.length, 1);
  assert.ok(asked[0].includes('Code'), 'the probe looks for Code');
});

test('isRunning reports false when the probe fails', async () => {
  const probe = V.createVsCodeProbe({
    runPowerShell: async () => { throw new Error('powershell is unavailable'); }
  });
  assert.strictEqual(await probe.isRunning(), false);
});
```

- [ ] **Step 3: Run the tests and watch them fail**

Run: `node --test test/vscode.test.js`
Expected: FAIL — `V.parseRunning is not a function`, and the launch test failing on the old signature.

- [ ] **Step 4: Write the implementation**

In `src/main/vscode.js`, replace `launch` and add the probe:

```js
/**
 * Start VS Code.
 *
 * No arguments: the account comes from the settings block, so any start picks
 * up the right one, and passing no folder lets VS Code restore its own session.
 */
function launch(exePath, spawnImpl = spawn) {
  const child = spawnImpl(exePath, [], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false
  });
  // Detach fully so Multi-Claude can quit while VS Code keeps running.
  child.unref();
}

const PS_RUNNING = "if (Get-Process Code -ErrorAction SilentlyContinue) { 'yes' } else { 'no' }";

function parseRunning(stdout) {
  return String(stdout).trim().split(/\r?\n/).includes('yes');
}

/**
 * Is a VS Code already open?
 *
 * Asked so an open editor is never given a second window — the whole point of
 * switching in place. A probe that cannot run answers "no": starting one extra
 * window is a far smaller failure than refusing to open VS Code at all.
 */
function createVsCodeProbe({ runPowerShell }) {
  return {
    async isRunning() {
      try {
        return parseRunning(await runPowerShell(PS_RUNNING));
      } catch {
        return false;
      }
    }
  };
}
```

Update the export line to:

```js
module.exports = { candidateEditors, findVsCode, launch, PS_RUNNING, parseRunning, createVsCodeProbe };
```

- [ ] **Step 5: Run the full suite and commit**

Run: `npm test`
Expected: PASS. The total drops, because four `seedProfile` tests are gone and four smaller ones replace them.

```bash
git add src/main/vscode.js test/vscode.test.js
git commit -m "refactor: VS Code module only finds, probes and starts the editor"
```

---

### Task 3: The service action

**Files:**
- Modify: `src/main/service.js`
- Modify: `src/main/main.js`
- Modify: `test/service.test.js`

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces: `service.useVsCodeAccount({ id }) -> { ok: true, switched: boolean, launched: boolean, reason?: 'foreign' }`; injectable `deps.vscode = { find, isRunning, launch }`; `deps.vscodeSettingsFile`.
- Removes: `service.openVsCode`, `vscodeDirFor`, `deps.vscodeRoot`, `deps.vscodeUserDir`, and the VS Code profile cleanup in `remove`.

- [ ] **Step 1: Write the failing tests**

In `test/service.test.js`: delete the three `openVsCode` tests and the VS Code profile-deletion test added by v1. In `harness()`, replace the `vscodeRoot` / `vscodeUserDir` / `vscode` block with:

```js
    vscodeSettingsFile: path.join(base, 'code-user', 'settings.json'),
    vscode: {
      find: async () => (vsCodeInstalled.value ? 'C:\\vs\\Code.exe' : null),
      isRunning: async () => vsCodeRunning.value,
      launch: (exe) => { vsLaunches.push(exe); }
    },
```

with recorders beside the existing ones:

```js
  const vsLaunches = [];
  const vsCodeInstalled = { value: true };
  const vsCodeRunning = { value: false };
```

returned from `harness()` along with the rest. Then add:

```js
test('useVsCodeAccount writes the account config dir into settings', async () => {
  const h = harness();
  await h.svc.init();
  const accounts = await h.svc.list();
  const a = accounts[0];

  const res = await h.svc.useVsCodeAccount({ id: a.id });

  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.switched, true);
  const text = fs.readFileSync(h.vscodeSettingsFile, 'utf8');
  assert.ok(text.includes(a.id), 'the account config dir is in the file');
  cleanup(h);
});

test('useVsCodeAccount starts VS Code only when it is not already running', async () => {
  const h = harness();
  await h.svc.init();
  const accounts = await h.svc.list();

  h.vsCodeRunning.value = true;
  const running = await h.svc.useVsCodeAccount({ id: accounts[0].id });
  assert.strictEqual(running.launched, false);
  assert.strictEqual(h.vsLaunches.length, 0, 'an open editor is never given a second window');

  h.vsCodeRunning.value = false;
  const closed = await h.svc.useVsCodeAccount({ id: accounts[0].id });
  assert.strictEqual(closed.launched, true);
  assert.strictEqual(h.vsLaunches.length, 1);
  cleanup(h);
});

test('useVsCodeAccount refuses to fight a setting the user made', async () => {
  const h = harness();
  await h.svc.init();
  const accounts = await h.svc.list();
  fs.mkdirSync(path.dirname(h.vscodeSettingsFile), { recursive: true });
  fs.writeFileSync(h.vscodeSettingsFile, '{\n  "claudeCode.environmentVariables": [],\n}\n');

  const res = await h.svc.useVsCodeAccount({ id: accounts[0].id });

  assert.strictEqual(res.switched, false);
  assert.strictEqual(res.reason, 'foreign');
  assert.strictEqual(
    fs.readFileSync(h.vscodeSettingsFile, 'utf8'),
    '{\n  "claudeCode.environmentVariables": [],\n}\n',
    'the file is untouched'
  );
  cleanup(h);
});

test('useVsCodeAccount backs the settings file up before changing it', async () => {
  const h = harness();
  await h.svc.init();
  const accounts = await h.svc.list();
  fs.mkdirSync(path.dirname(h.vscodeSettingsFile), { recursive: true });
  fs.writeFileSync(h.vscodeSettingsFile, '{\n  "editor.fontSize": 13,\n}\n');

  await h.svc.useVsCodeAccount({ id: accounts[0].id });

  const backups = fs.readdirSync(path.dirname(h.vscodeSettingsFile))
    .filter((n) => n.includes('multi-claude') && n.endsWith('.bak'));
  assert.strictEqual(backups.length, 1);
  assert.ok(fs.readFileSync(path.join(path.dirname(h.vscodeSettingsFile), backups[0]), 'utf8')
    .includes('editor.fontSize'), 'the backup holds the previous version');
  cleanup(h);
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `node --test test/service.test.js`
Expected: FAIL — `h.svc.useVsCodeAccount is not a function`.

- [ ] **Step 3: Write the implementation**

In `src/main/service.js`, add the require beside the others:

```js
const vscodeSettings = require('./vscode-settings.js');
```

Replace the injected `vscode` block and `vscodeDirFor` with:

```js
  const vscode = deps.vscode || {
    find: () => vscodeMod.findVsCode(),
    isRunning: () => vscodeMod.createVsCodeProbe({ runPowerShell: deps.runPowerShell }).isRunning(),
    launch: (exe) => vscodeMod.launch(exe)
  };
```

Delete the VS Code cleanup block in `remove` (the `vscodeDirFor` / `P.isInside(vs, deps.vscodeRoot)` paragraph) — there is no per-account profile any more.

Replace `openVsCode` with:

```js
    /**
     * Point VS Code's Claude Code at this account.
     *
     * The extension watches this setting and refreshes in place, so an editor
     * that is already open switches account without a new window.
     */
    async useVsCodeAccount({ id }) {
      const a = find(id);
      const ccDir = await prepareCcDir(a);
      const file = deps.vscodeSettingsFile;
      if (!file) throw err('unsupported', 'VS Code settings are not available here.');

      let text = '';
      try {
        text = await fsp.readFile(file, 'utf8');
      } catch (e) {
        // Not being there is fine — we create it. Anything else means it
        // exists and cannot be read, and writing would destroy it.
        if (!e || e.code !== 'ENOENT') {
          throw err('vscode_settings', `Could not read your VS Code settings: ${e && e.message}`);
        }
      }

      // A key outside our block is the user's own. Do not fight it: in JSONC
      // the last key wins, so a second copy could silently pick the account.
      if (vscodeSettings.hasForeignKey(text)) {
        return { ok: true, switched: false, reason: 'foreign', launched: false };
      }

      await fsp.mkdir(path.dirname(file), { recursive: true });
      if (text !== '') {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        try { await fsp.writeFile(`${file}.multi-claude-${stamp}.bak`, text); } catch { /* best effort */ }
      }
      const tmp = `${file}.tmp`;
      await fsp.writeFile(tmp, vscodeSettings.writeManaged(text, ccDir));
      await fsp.rename(tmp, file);

      let launched = false;
      if (!(await vscode.isRunning())) {
        const exe = await vscode.find();
        if (exe) { vscode.launch(exe); launched = true; }
      }
      return { ok: true, switched: true, launched };
    },
```

In `src/main/main.js`, replace the two v1 lines with:

```js
      // One VS Code, one account at a time: the account is a setting in the
      // user's own settings.json, which the extension watches.
      vscodeSettingsFile: path.join(app.getPath('appData'), 'Code', 'User', 'settings.json'),
      runPowerShell,
```

(`runPowerShell` is already imported in `main.js` for the locator and scanner.)

- [ ] **Step 4: Run the full suite and commit**

Run: `npm test`
Expected: PASS.

```bash
git add src/main/service.js src/main/main.js test/service.test.js
git commit -m "feat: switch VS Code's Claude account by settings, not by profile"
```

---

### Task 4: Rename across the bridge

**Files:**
- Modify: `src/main/ipc.js`
- Modify: `src/preload/preload.js`
- Modify: `src/renderer/lib/api.js`

**Interfaces:**
- Consumes: `service.useVsCodeAccount` from Task 3.
- Produces: `api.useVsCodeAccount(id)`.

- [ ] **Step 1: Rename the channel**

In `src/main/ipc.js`, change `'openVsCode'` to `'useVsCodeAccount'` in `CHANNELS`, and the handler entry to:

```js
    useVsCodeAccount: (p) => service.useVsCodeAccount(p),
```

- [ ] **Step 2: Rename the bridge entry**

In `src/preload/preload.js`: `useVsCodeAccount: call('useVsCodeAccount'),`

- [ ] **Step 3: Rename the renderer call**

In `src/renderer/lib/api.js`: `useVsCodeAccount: (id) => call('useVsCodeAccount', { id }),`

- [ ] **Step 4: Verify the chain**

Run: `npm test`
Expected: PASS.

Then confirm no stale name survives anywhere:

Run: `grep -rn "openVsCode" src/ test/ ; echo "exit: $?"`
Expected: no matches (`exit: 1` from grep finding nothing).

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc.js src/preload/preload.js src/renderer/lib/api.js
git commit -m "refactor: rename the channel to useVsCodeAccount"
```

---

### Task 5: The button

**Files:**
- Modify: `src/renderer/App.jsx`
- Modify: `src/renderer/components/AccountRow.jsx`
- Modify: `src/renderer/views/AccountDetail.jsx`

**Interfaces:**
- Consumes: `api.useVsCodeAccount` from Task 4.
- Produces: `actions.useVsCodeAccount(account)`.

- [ ] **Step 1: Replace the action**

In `src/renderer/App.jsx`, replace the whole `openVsCode` action with:

```js
    useVsCodeAccount: async (a) => {
      try {
        const r = await api.useVsCodeAccount(a.id);
        if (r && r.switched === false) {
          say(`VS Code still has your own claudeCode.environmentVariables setting, so it is in control. Remove it to let Multi-Claude switch accounts.`, true);
        } else if (r && r.launched) {
          say(`VS Code is opening, using ${a.label}.`);
        } else {
          say(`VS Code is now using ${a.label}.`);
        }
      } catch (e) { fail(e); }
    },
```

Leave `openTerminal` exactly as it is.

- [ ] **Step 2: Relabel the button in both views**

In `src/renderer/components/AccountRow.jsx` and `src/renderer/views/AccountDetail.jsx`, change the VS Code button in each to:

```jsx
            <button className="ghost" onClick={() => actions.useVsCodeAccount(account)} title="Make VS Code use this account">
              Use in VS Code
            </button>
```

(match each file's existing indentation; the Terminal button beside it is unchanged).

- [ ] **Step 3: Build and commit**

Run: `npm run build:renderer`
Expected: a clean Vite build, no unresolved imports.

Run: `npm test`
Expected: PASS.

```bash
git add src/renderer/App.jsx src/renderer/components/AccountRow.jsx src/renderer/views/AccountDetail.jsx
git commit -m "feat: Use in VS Code switches the account in place"
```

---

### Task 6: Documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-11-10-vscode-per-account.md`

- [ ] **Step 1: Replace the README section**

Replace the whole *Opening VS Code as one account* section with:

```markdown
## Using one account in VS Code

Each account has a **Use in VS Code** button. It points Claude Code at that
account inside the VS Code you already have open — no second window, and no
signing in again.

It works by writing that account's `CLAUDE_CONFIG_DIR` into your own
`%APPDATA%\Code\User\settings.json`, as `claudeCode.environmentVariables`. The
Claude Code extension watches that setting and refreshes itself, so an editor
that is already open switches account where it stands. Multi-Claude still never
touches a credential: it writes one path, and Anthropic's own Claude Code put
the sign-in where that path points.

The setting is machine-wide, so **one account is active at a time** and every
open VS Code window follows it. In exchange, it is your real VS Code: your
extensions, your settings, and the sign-ins you already have inside those
extensions.

Multi-Claude writes the setting inside comment markers and replaces only what
is between them, keeping a timestamped `.bak` beside the file each time. If you
set `claudeCode.environmentVariables` yourself, outside those markers, yours
wins and the button says so rather than fighting you.

**Terminal** does the same thing in a console window instead, for when you want
Claude Code without an editor. It passes the account per process, so it never
disturbs the setting.
```

- [ ] **Step 2: Fix the Where things live table**

Delete the `%APPDATA%\multi-claude\vscode\<account id>` row — that folder is no longer created. Add in its place:

```markdown
| VS Code's active account | `%APPDATA%\Code\User\settings.json` (a managed block) |
```

- [ ] **Step 3: Mark the v1 plan superseded**

At the top of `docs/superpowers/plans/2026-11-10-vscode-per-account.md`, directly under the title, add:

```markdown
> **Superseded.** This plan shipped on 2026-11-10 and was replaced the same day
> by `2026-11-10-vscode-switch-account.md`. Its per-account `--user-data-dir`
> approach produced a second window and a second profile, so extension sign-ins
> were per account. Kept as a record of what was built and why it changed.
```

- [ ] **Step 4: Check the prose**

Run: `grep -c "Use in VS Code" README.md ; grep -c "multi-claude.vscode" README.md`
Expected: `1` then `0` — the new section is in and the old profile path is gone.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/superpowers/plans/2026-11-10-vscode-per-account.md
git commit -m "docs: switching the account in place, not a profile per account"
```

---

## Self-Review

**Spec coverage.** §2 mechanism: Tasks 1 and 3. §2.1 rejection of re-pointing `~/.claude`: documentation only, no task needed. §3 managed block: Task 1. §4.1: Task 1. §4.2: Task 2. §4.3: Task 3. §4.4 UI: Task 5, and the renaming it depends on in Task 4. §5 error table: Task 3 (foreign key, missing file, unreadable file, not found) and Task 5 (what the user is told). §6 testing: Tasks 1–3. §7 consequences: README in Task 6. §8 out of scope: nothing to build. §9 docs: Task 6. No gaps.

**Placeholders.** None — every step carries the code it needs. An earlier draft of Task 3 referred to an error-code helper `ce(e)` in `service.js`; no such helper exists, so the step now reads `e.code` directly, matching the house style already used in `src/main/vscode.js`.

**Type consistency.** `writeManaged(text, ccDir) -> string` in Task 1 is called as `vscodeSettings.writeManaged(text, ccDir)` in Task 3. `hasForeignKey(text) -> boolean` likewise. `launch(exePath, spawnImpl?)` in Task 2 is injected as `launch: (exe) => vscodeMod.launch(exe)` in Task 3 and recorded as `launch: (exe) => vsLaunches.push(exe)` in its tests. `useVsCodeAccount` returns `{ ok, switched, launched, reason? }` in Task 3 and is read as `r.switched === false`, `r.launched` in Task 5. `createVsCodeProbe({ runPowerShell })` in Task 2 is constructed with `deps.runPowerShell` in Task 3, which Task 3 Step 3 adds to `main.js`.
