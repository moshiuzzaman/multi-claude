# Per-account VS Code Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every account gets a button that opens VS Code already connected to Claude Code as that account.

**Architecture:** Claude Code's identity is its config directory, and each account already has one at `%APPDATA%\multi-claude\cc\<id>` with its own sign-in. VS Code is single-instance *per user-data-dir*, so an account is selected by launching `Code.exe` with its own `--user-data-dir` plus `CLAUDE_CONFIG_DIR` in the environment. A new `src/main/vscode.js` owns discovery, profile seeding and launching; `service.js` exposes `openVsCode`; the existing ipc → preload → api chain carries only the account id.

**Tech Stack:** Node 22, Electron 33, React 18, `node:test`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-10-vscode-per-account-design.md`

## Global Constraints

- Windows only. No new runtime dependency is permitted: `package.json`'s `files` array ships only `src/`, `dist-renderer/` and `package.json`, so anything in `node_modules` would not be packaged.
- Binaries are launched **directly, never through a shell**. Use `Code.exe`, never the `bin\code` shim (a `.cmd` that requires one). During development Git Bash rewrote `/usage` into a filesystem path, which is why this rule exists.
- The preload bridge passes **account ids only** — never a filesystem path.
- Multi-Claude never reads, copies or intermediates a credential. This feature only sets an environment variable; Anthropic's own CLI did the sign-in.
- Tests run under `node --test`, with no Electron and no network. Inject `fsImpl` / `fspImpl` / `spawnImpl` rather than touching the real system.
- Error results cross IPC as `{ ok: false, code, message }` — never a thrown exception.
- Commits made by an agent end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

### Task 1: VS Code discovery

**Files:**
- Create: `src/main/vscode.js`
- Test: `test/vscode.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `candidateEditors(env, fsImpl) -> string[]`, `findVsCode(env, fsImpl) -> string | null`, and the exported constant `OVERRIDE_KEY = 'claudeCode.environmentVariables'`.

- [ ] **Step 1: Write the failing test**

Create `test/vscode.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const V = require('../src/main/vscode.js');

const fakeFs = (present) => ({ existsSync: (p) => present.includes(p) });

test('candidateEditors prefers the per-user install over the system one', () => {
  const env = { LOCALAPPDATA: 'C:\\u\\AppData\\Local', ProgramFiles: 'C:\\Program Files' };
  const user = 'C:\\u\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe';
  const system = 'C:\\Program Files\\Microsoft VS Code\\Code.exe';
  assert.deepStrictEqual(V.candidateEditors(env, fakeFs([user, system])), [user, system]);
});

test('candidateEditors drops paths that do not exist', () => {
  const env = { LOCALAPPDATA: 'C:\\u\\AppData\\Local', ProgramFiles: 'C:\\Program Files' };
  const system = 'C:\\Program Files\\Microsoft VS Code\\Code.exe';
  assert.deepStrictEqual(V.candidateEditors(env, fakeFs([system])), [system]);
});

test('candidateEditors builds no path from a missing environment variable', () => {
  assert.deepStrictEqual(V.candidateEditors({}, fakeFs([])), []);
});

test('findVsCode returns null when VS Code is not installed', () => {
  assert.strictEqual(V.findVsCode({ LOCALAPPDATA: 'C:\\u' }, fakeFs([])), null);
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/main/vscode.js'`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/main/vscode.js`:

```js
'use strict';
// Opening VS Code against one account's Claude Code config dir.
//
// VS Code is single-instance per user-data-dir: launching it while an instance
// is already running hands the request to that process, and the new window
// inherits the *original* environment. Measured on 2026-11-10, a second launch
// created no new process at all. So an account cannot be selected with
// CLAUDE_CONFIG_DIR alone — every account needs its own --user-data-dir, which
// makes any handoff land on that account's own instance.
//
// Extensions are unaffected: --extensions-dir is a separate flag defaulting to
// ~/.vscode/extensions, so the Claude Code extension stays shared.

const fs = require('node:fs');
const path = require('node:path');

// The setting that overrides inherited environment. If the user's own
// settings.json sets it, copying that file would silently repoint the account.
const OVERRIDE_KEY = 'claudeCode.environmentVariables';

/** Every place a stock VS Code is commonly installed, per-user install first. */
function candidateEditors(env, fsImpl = fs) {
  const out = [];
  if (env.LOCALAPPDATA) {
    out.push(path.join(env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe'));
  }
  if (env.ProgramFiles) {
    out.push(path.join(env.ProgramFiles, 'Microsoft VS Code', 'Code.exe'));
  }
  return out.filter((p) => { try { return fsImpl.existsSync(p); } catch { return false; } });
}

function findVsCode(env = process.env, fsImpl = fs) {
  return candidateEditors(env, fsImpl)[0] || null;
}

module.exports = { OVERRIDE_KEY, candidateEditors, findVsCode };
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npm test`
Expected: PASS, with the existing 190 tests still green.

- [ ] **Step 5: Commit**

```bash
git add src/main/vscode.js test/vscode.test.js
git commit -m "feat: find the installed VS Code"
```

---

### Task 2: Profile seeding

**Files:**
- Modify: `src/main/vscode.js`
- Test: `test/vscode.test.js`

**Interfaces:**
- Consumes: `OVERRIDE_KEY` from Task 1.
- Produces: `async seedProfile(profileDir, sourceUserDir, fspImpl) -> { copied: string[], skipped: 'override' | 'unreadable' | null }`.

Settings are re-copied on **every** launch, by decision in spec §3. A setting changed inside an account window is therefore discarded next launch; that is deliberate, and it makes each launch re-assert a known-good state.

- [ ] **Step 1: Write the failing test**

Append to `test/vscode.test.js`:

```js
const fsp = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function tmp() {
  return fsSync.mkdtempSync(path.join(os.tmpdir(), 'mc-vsc-'));
}

test('seedProfile copies settings and keybindings into User/', async () => {
  const base = tmp();
  const source = path.join(base, 'Code', 'User');
  const profile = path.join(base, 'profile');
  await fsp.mkdir(source, { recursive: true });
  await fsp.writeFile(path.join(source, 'settings.json'), '{ "a": 1, }');
  await fsp.writeFile(path.join(source, 'keybindings.json'), '[]');

  const res = await V.seedProfile(profile, source);

  assert.deepStrictEqual(res, { copied: ['settings.json', 'keybindings.json'], skipped: null });
  assert.strictEqual(
    await fsp.readFile(path.join(profile, 'User', 'settings.json'), 'utf8'),
    '{ "a": 1, }'
  );
});

test('seedProfile tolerates a missing keybindings.json', async () => {
  const base = tmp();
  const source = path.join(base, 'Code', 'User');
  const profile = path.join(base, 'profile');
  await fsp.mkdir(source, { recursive: true });
  await fsp.writeFile(path.join(source, 'settings.json'), '{}');

  const res = await V.seedProfile(profile, source);

  assert.deepStrictEqual(res, { copied: ['settings.json'], skipped: null });
});

test('seedProfile copies nothing when the source settings would override the account', async () => {
  const base = tmp();
  const source = path.join(base, 'Code', 'User');
  const profile = path.join(base, 'profile');
  await fsp.mkdir(source, { recursive: true });
  await fsp.writeFile(path.join(source, 'settings.json'), '{ "claudeCode.environmentVariables": [] }');
  await fsp.writeFile(path.join(source, 'keybindings.json'), '[]');

  const res = await V.seedProfile(profile, source);

  assert.deepStrictEqual(res, { copied: [], skipped: 'override' });
  assert.strictEqual(fsSync.existsSync(path.join(profile, 'User', 'keybindings.json')), false);
});

test('seedProfile copies nothing when a source file exists but cannot be read', async () => {
  const base = tmp();
  const source = path.join(base, 'Code', 'User');
  const profile = path.join(base, 'profile');
  await fsp.mkdir(source, { recursive: true });
  // A directory where settings.json should be: present, unreadable (EISDIR).
  await fsp.mkdir(path.join(source, 'settings.json'), { recursive: true });
  await fsp.writeFile(path.join(source, 'keybindings.json'), '[]');

  const res = await V.seedProfile(profile, source);

  assert.deepStrictEqual(res, { copied: [], skipped: 'unreadable' });
  assert.strictEqual(fsSync.existsSync(path.join(profile, 'User', 'keybindings.json')), false);
});

test('seedProfile creates User/ even with no source files at all', async () => {
  const base = tmp();
  const profile = path.join(base, 'profile');
  const res = await V.seedProfile(profile, path.join(base, 'nope'));
  assert.deepStrictEqual(res, { copied: [], skipped: null });
  assert.ok(fsSync.existsSync(path.join(profile, 'User')));
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npm test`
Expected: FAIL — `V.seedProfile is not a function`.

- [ ] **Step 3: Write the minimal implementation**

Add to `src/main/vscode.js`, above `module.exports`:

```js
const fsp = require('node:fs/promises');

// settings.json first: if it carries OVERRIDE_KEY the whole seed is abandoned,
// so nothing half-copied is left behind.
const SEEDED_FILES = ['settings.json', 'keybindings.json'];

/**
 * Copy the user's own VS Code settings into an account's profile.
 *
 * A source file that is not there is not an error — a stock VS Code has no
 * keybindings.json until you make one.
 */
async function seedProfile(profileDir, sourceUserDir, fspImpl = fsp) {
  const targetUser = path.join(profileDir, 'User');
  await fspImpl.mkdir(targetUser, { recursive: true });

  const copied = [];
  for (const name of SEEDED_FILES) {
    let text;
    try {
      text = await fspImpl.readFile(path.join(sourceUserDir, name), 'utf8');
    } catch (e) {
      // Not being there is not an error: a stock VS Code has no
      // keybindings.json until you make one. Anything else means the file
      // exists and could not be read (EACCES, EBUSY, EISDIR), so abandon the
      // whole seed rather than leave a half-copied profile behind.
      if (e && e.code === 'ENOENT') continue;
      return { copied: [], skipped: 'unreadable' };
    }
    // Reading the file is enough; it is JSONC and must not be parsed.
    if (name === 'settings.json' && text.includes(OVERRIDE_KEY)) {
      return { copied: [], skipped: 'override' };
    }
    await fspImpl.writeFile(path.join(targetUser, name), text);
    copied.push(name);
  }
  return { copied, skipped: null };
}
```

Update the export line to:

```js
module.exports = { OVERRIDE_KEY, SEEDED_FILES, candidateEditors, findVsCode, seedProfile };
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/vscode.js test/vscode.test.js
git commit -m "feat: seed an account's VS Code profile from your own settings"
```

---

### Task 3: Launching

**Files:**
- Modify: `src/main/vscode.js`
- Test: `test/vscode.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `launch(exePath, { profileDir, ccDir }, spawnImpl) -> void`.

No folder argument is passed: each profile restores its own last session (spec §3).

- [ ] **Step 1: Write the failing test**

Append to `test/vscode.test.js`:

```js
test('launch passes the profile dir and the account config dir, detached', () => {
  const calls = [];
  let unrefed = false;
  const spawnImpl = (exe, args, opts) => {
    calls.push({ exe, args, opts });
    return { unref: () => { unrefed = true; } };
  };

  V.launch('C:\\vs\\Code.exe',
    { profileDir: 'C:\\mc\\vscode\\abc123', ccDir: 'C:\\mc\\cc\\abc123' }, spawnImpl);

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].exe, 'C:\\vs\\Code.exe');
  assert.deepStrictEqual(calls[0].args, ['--user-data-dir', 'C:\\mc\\vscode\\abc123']);
  assert.strictEqual(calls[0].opts.env.CLAUDE_CONFIG_DIR, 'C:\\mc\\cc\\abc123');
  assert.strictEqual(calls[0].opts.detached, true);
  assert.strictEqual(calls[0].opts.stdio, 'ignore');
  assert.ok(unrefed, 'the child must be unref()ed so Multi-Claude can exit');
});

test('launch never goes through a shell and opens no folder', () => {
  const calls = [];
  const spawnImpl = (exe, args, opts) => { calls.push({ exe, args, opts }); return { unref() {} }; };

  V.launch('C:\\vs\\Code.exe', { profileDir: 'C:\\p', ccDir: 'C:\\c' }, spawnImpl);

  assert.notStrictEqual(calls[0].opts.shell, true);
  assert.strictEqual(calls[0].args.length, 2, 'no folder argument: VS Code restores its own session');
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npm test`
Expected: FAIL — `V.launch is not a function`.

- [ ] **Step 3: Write the minimal implementation**

Add to `src/main/vscode.js`:

```js
const { spawn } = require('node:child_process');

/**
 * Open VS Code for one account.
 *
 * --user-data-dir is what makes the account stick: it forces a separate
 * process, so CLAUDE_CONFIG_DIR is read at creation instead of being lost to a
 * handoff. No folder argument, so VS Code reopens that profile's own session.
 */
function launch(exePath, { profileDir, ccDir }, spawnImpl = spawn) {
  const child = spawnImpl(exePath, ['--user-data-dir', profileDir], {
    env: { ...process.env, CLAUDE_CONFIG_DIR: ccDir },
    detached: true,
    stdio: 'ignore',
    windowsHide: false
  });
  child.unref();
}
```

Update the export line to:

```js
module.exports = { OVERRIDE_KEY, SEEDED_FILES, candidateEditors, findVsCode, seedProfile, launch };
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/vscode.js test/vscode.test.js
git commit -m "feat: launch VS Code against one account's config dir"
```

---

### Task 4: Service action and profile cleanup

**Files:**
- Modify: `src/main/service.js` (injectable deps block near line 58; `remove` near line 288; new action beside `openClaudeCode` near line 479)
- Modify: `src/main/main.js` (deps block near line 55)
- Modify: `docs/superpowers/specs/2026-11-10-vscode-per-account-design.md` (§4.4)
- Test: `test/service.test.js`

**Interfaces:**
- Consumes: `findVsCode`, `seedProfile`, `launch` from Tasks 1–3.
- Produces: `service.openVsCode({ id }) -> { ok: true, settingsSkipped: 'override' | 'unreadable' | null }` — the reason is passed straight through from `seedProfile`, so the UI can say which one happened; injectable `deps.vscode = { find, seedProfile, launch }`; `deps.vscodeRoot`; `deps.vscodeUserDir`.

**Correction to the spec:** §4.4 says `deleter.js` removes the profile. It does not — the account's `cc\<id>` is removed in `service.remove` (service.js:288–293), and the VS Code profile belongs beside it. Fix §4.4 in this task.

- [ ] **Step 1: Write the failing test**

In `test/service.test.js`, add to the `createService({ ... })` call inside `harness()`:

```js
    vscodeRoot: path.join(base, 'cfg', 'vscode'),
    vscodeUserDir: path.join(base, 'code-user'),
    vscode: {
      find: async () => (vsCodeInstalled.value ? 'C:\\vs\\Code.exe' : null),
      seedProfile: async (profileDir, userDir) => {
        seeds.push({ profileDir, userDir });
        return { copied: ['settings.json'], skipped: seedSkip.value };
      },
      launch: (exe, opts) => { vsLaunches.push({ exe, ...opts }); }
    },
```

Declare the recorders beside the existing `const terminals = [];`:

```js
  const vsLaunches = [];
  const seeds = [];
  const vsCodeInstalled = { value: true };
  const seedSkip = { value: null };
```

and return them from `harness()` alongside whatever it already returns.

Then add the tests:

```js
test('openVsCode launches with the account own profile and config dir', async () => {
  const h = harness();
  await h.svc.init();
  const accounts = await h.svc.list();
  const a = accounts[0];

  const res = await h.svc.openVsCode({ id: a.id });

  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.settingsSkipped, null);
  assert.strictEqual(h.vsLaunches.length, 1);
  assert.strictEqual(h.vsLaunches[0].exe, 'C:\\vs\\Code.exe');
  assert.ok(h.vsLaunches[0].profileDir.endsWith(a.id));
  assert.ok(h.vsLaunches[0].ccDir.endsWith(a.id));
  assert.notStrictEqual(h.vsLaunches[0].profileDir, h.vsLaunches[0].ccDir);
  assert.strictEqual(h.seeds.length, 1);
});

test('openVsCode reports when settings were not copied', async () => {
  const h = harness();
  await h.svc.init();
  const accounts = await h.svc.list();
  h.seedSkip.value = 'override';

  const res = await h.svc.openVsCode({ id: accounts[0].id });

  assert.strictEqual(res.settingsSkipped, 'override');
  assert.strictEqual(h.vsLaunches.length, 1, 'a skipped seed must not stop the launch');
});

test('openVsCode fails clearly when VS Code is not installed', async () => {
  const h = harness();
  await h.svc.init();
  const accounts = await h.svc.list();
  h.vsCodeInstalled.value = false;

  await assert.rejects(
    () => h.svc.openVsCode({ id: accounts[0].id }),
    (e) => e.code === 'no_vscode'
  );
  assert.strictEqual(h.vsLaunches.length, 0);
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npm test`
Expected: FAIL — `h.svc.openVsCode is not a function`.

- [ ] **Step 3: Write the minimal implementation**

In `src/main/service.js`, require the module beside the other main-process requires:

```js
const vscodeMod = require('./vscode.js');
```

After the `ccDirFor` line (service.js:75), add:

```js
  const vscode = deps.vscode || {
    find: () => vscodeMod.findVsCode(),
    seedProfile: (profileDir, userDir) => vscodeMod.seedProfile(profileDir, userDir),
    launch: (exe, opts) => vscodeMod.launch(exe, opts)
  };

  const vscodeDirFor = (a) => (deps.vscodeRoot ? path.join(deps.vscodeRoot, a.id) : null);

  async function requireVsCode() {
    const found = await vscode.find();
    if (!found) {
      throw err('no_vscode',
        'VS Code was not found in the usual install locations. If it is installed somewhere else, that is why.');
    }
    return found;
  }
```

Add the action immediately after `openClaudeCode` (service.js:485):

```js
    /** Open VS Code already connected to this account's Claude Code. */
    async openVsCode({ id }) {
      const a = find(id);
      const exe = await requireVsCode();
      const ccDir = await prepareCcDir(a);
      const profileDir = vscodeDirFor(a);
      if (!profileDir) throw err('unsupported', 'VS Code profiles are not available here.');

      const seed = await vscode.seedProfile(profileDir, deps.vscodeUserDir);
      vscode.launch(exe, { profileDir, ccDir });
      // The reason passes straight through: a skipped seed never blocks the
      // launch, but the UI says which of the two reasons it was.
      return { ok: true, settingsSkipped: seed.skipped };
    },
```

In `remove`, directly after the `cc` cleanup block (service.js:290–293):

```js
      // The account's VS Code profile goes with it, guarded the same way.
      const vs = vscodeDirFor(account);
      if (vs && P.isInside(vs, deps.vscodeRoot)) {
        try { await fsp.rm(vs, { recursive: true, force: true }); } catch { /* best effort */ }
      }
```

In `src/main/main.js`, inside `createService({ ... })` after the `ccRoot` line:

```js
      // One VS Code profile per account. Separate processes are the only way a
      // per-account CLAUDE_CONFIG_DIR survives VS Code's single-instance handoff.
      vscodeRoot: path.join(appDir, 'vscode'),
      vscodeUserDir: path.join(app.getPath('appData'), 'Code', 'User'),
```

Finally, correct spec §4.4 to read:

```markdown
### 4.4 Deletion

`service.remove` removes `vscode\<id>` immediately after the existing `cc\<id>`
cleanup, guarded by the same `P.isInside` check against the app's own root. The
deletion guards in `deleter.js` are unchanged; this path is app-owned and derived
from the account id, never user-supplied.
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/service.js src/main/main.js test/service.test.js docs/superpowers/specs/2026-11-10-vscode-per-account-design.md
git commit -m "feat: openVsCode service action, with per-account profile cleanup on delete"
```

---

### Task 5: IPC, preload and renderer API

**Files:**
- Modify: `src/main/ipc.js:8-14` (CHANNELS) and the `handlers` object
- Modify: `src/preload/preload.js`
- Modify: `src/renderer/lib/api.js`

**Interfaces:**
- Consumes: `service.openVsCode` from Task 4.
- Produces: `api.openVsCode(id) -> Promise<{ ok, settingsSkipped }>` for the renderer.

- [ ] **Step 1: Add the channel**

In `src/main/ipc.js`, change the `limits` line of `CHANNELS` to:

```js
  'limits', 'connectAccount', 'openClaudeCode', 'openVsCode',
```

and add to `handlers`, beside `openClaudeCode`:

```js
    openVsCode: (p) => service.openVsCode(p),
```

- [ ] **Step 2: Add the bridge entry**

In `src/preload/preload.js`, after the `openClaudeCode` line:

```js
  openVsCode: call('openVsCode'),
```

- [ ] **Step 3: Add the renderer call**

In `src/renderer/lib/api.js`, after the `openClaudeCode` line:

```js
  openVsCode: (id) => call('openVsCode', { id }),
```

- [ ] **Step 4: Verify the chain is complete**

Run: `npm test`
Expected: PASS — the existing tests still green.

Then run: `node -e "const {CHANNELS}=require('./src/main/ipc.js');const p=require('fs').readFileSync('src/preload/preload.js','utf8');const missing=CHANNELS.filter(c=>!p.includes(\"'\"+c+\"'\"));console.log(missing.length?'MISSING: '+missing:'every channel is bridged')"`
Expected: `every channel is bridged`.

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc.js src/preload/preload.js src/renderer/lib/api.js
git commit -m "feat: bridge openVsCode to the renderer"
```

---

### Task 6: The buttons

**Files:**
- Modify: `src/renderer/App.jsx` (the `actions` object, lines 159–253)
- Modify: `src/renderer/components/AccountRow.jsx:54-56`
- Modify: `src/renderer/views/AccountDetail.jsx:61-63`

**Interfaces:**
- Consumes: `api.openVsCode` from Task 5, and the existing `api.openClaudeCode`.
- Produces: `actions.openVsCode(account)` and `actions.openTerminal(account)` for both views.

`openClaudeCode` already exists in `api.js` but no component calls it. It is surfaced here as **Terminal**, by decision in spec §4.6.

- [ ] **Step 1: Add the actions**

In `src/renderer/App.jsx`, inside the `actions` object after the `shortcut` entry:

```js
    openVsCode: async (a) => {
      try {
        const r = await api.openVsCode(a.id);
        const why = r && r.settingsSkipped;
        if (why === 'override') {
          say(`Opening VS Code for ${a.label}. Your own settings were not copied: they set claudeCode.environmentVariables, which would override the account.`);
        } else if (why === 'unreadable') {
          say(`Opening VS Code for ${a.label}. Your own settings were not copied: settings.json could not be read.`);
        } else {
          say(`Opening VS Code for ${a.label}.`);
        }
      } catch (e) { fail(e); }
    },
    openTerminal: async (a) => {
      try {
        await api.openClaudeCode(a.id);
        say(`Opening a Claude Code terminal for ${a.label}.`);
      } catch (e) { fail(e); }
    },
```

- [ ] **Step 2: Add the buttons to the account row**

In `src/renderer/components/AccountRow.jsx`, between the Shortcut and Rename buttons:

```jsx
            <button className="ghost" onClick={() => actions.openVsCode(account)} title="Open VS Code signed in as this account">
              VS Code
            </button>
            <button className="ghost" onClick={() => actions.openTerminal(account)} title="Open a Claude Code terminal for this account">
              Terminal
            </button>
```

- [ ] **Step 3: Add the same buttons to the account page**

In `src/renderer/views/AccountDetail.jsx`, between its Shortcut and Rename buttons:

```jsx
          <button className="ghost" onClick={() => actions.openVsCode(account)} title="Open VS Code signed in as this account">
            VS Code
          </button>
          <button className="ghost" onClick={() => actions.openTerminal(account)} title="Open a Claude Code terminal for this account">
            Terminal
          </button>
```

Dashboard cards are deliberately left alone: they stay limits plus Launch/Close.

- [ ] **Step 4: Build and run it**

Run: `npm run build:renderer`
Expected: a clean Vite build, no unresolved imports.

Then start the app **from your own terminal, not from inside Claude Desktop** (`start.cmd`), click **VS Code** on one account, and confirm a second VS Code instance opens whose Claude panel reports that account. Verify with:

```
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='Code.exe'\""
```

Expected: a Code.exe whose command line contains `--user-data-dir ...\multi-claude\vscode\<id>`.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/App.jsx src/renderer/components/AccountRow.jsx src/renderer/views/AccountDetail.jsx
git commit -m "feat: VS Code and Terminal buttons on every account"
```

---

### Task 7: Documentation

**Files:**
- Modify: `README.md` (*Where things live* table; a new section; the *What it will not do* section)

**Interfaces:**
- Consumes: the finished feature.
- Produces: nothing in code.

- [ ] **Step 1: Add the profile location**

In the *Where things live* table, after the `cc\<account id>` row:

```markdown
| Each account's VS Code profile | `%APPDATA%\multi-claude\vscode\<account id>` |
```

- [ ] **Step 2: Document the button**

Add a section after *Launching and closing*:

```markdown
## Opening VS Code as one account

Each account has a **VS Code** button. It opens VS Code already connected to
Claude Code as that account — no sign-in step, because the account signed in to
Anthropic's own Claude Code when you connected it.

It works by starting VS Code with that account's `CLAUDE_CONFIG_DIR`, which is
the only thing that decides which account Claude Code is. Multi-Claude still
never touches a credential.

Each account gets its own `--user-data-dir`, and that part is not optional. VS
Code is single-instance: launch it while it is already running and the request
is handed to the existing process, so the new window inherits that process's
environment and silently belongs to the wrong account. A separate user-data-dir
forces a separate process. Your extensions are still shared — `--extensions-dir`
is a different flag — but each account keeps its own window layout and recent
folders, which is what lets it reopen where you left off.

Your `settings.json` and `keybindings.json` are copied in on every launch, so an
account window looks like your own VS Code. The flip side: a setting you change
*inside* an account window is replaced on the next launch.

**Terminal** does the same thing in a console window instead, for when you want
Claude Code without an editor.
```

- [ ] **Step 3: State the intent**

In *What it will not do, on purpose*, after the bullet list:

```markdown
Opening several accounts in VS Code at once is allowed, because having more than
one account you own is normal — different clients, different organisations. It
is not there to run the same work across three accounts to triple throughput,
which is the thing Anthropic's enforcement is actually aimed at.
```

- [ ] **Step 4: Check it reads correctly**

Run: `node -e "const t=require('fs').readFileSync('README.md','utf8');console.log(['vscode\\\\<account id>','Opening VS Code as one account','--extensions-dir'].map(s=>s+': '+t.includes(s)).join('\n'))"`
Expected: all three `true`.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: the per-account VS Code button"
```

---

## Self-Review

**Spec coverage.** §1 and §2 are background, implemented by Tasks 1–3. §3 decisions: folder (Task 3, no folder argument), seeding (Task 2), not-connected (no code — opening anyway is the default behaviour, and Task 4 adds no connected check), parallel use (Task 7). §3.1 guard: Task 2. §4.1: Tasks 1–3. §4.2: Task 4. §4.3: Task 4. §4.4: Task 4, with the `deleter.js` → `service.remove` correction. §4.5: Task 5. §4.6: Task 6. §5 errors: `no_vscode` in Task 4, guard reporting in Tasks 4 and 6, `unsupported` in Task 4. §6 testing: Tasks 1–4. §9 docs: Task 7. No gaps.

**Placeholders.** None — every step carries the code it needs.

**Type consistency.** `seedProfile` returns `{ copied, skipped }` in Task 2 and is passed straight through as `settingsSkipped` in Task 4. `launch` takes `(exePath, { profileDir, ccDir }, spawnImpl)` in Task 3 and is called as `vscode.launch(exe, { profileDir, ccDir })` in Task 4. `find()` returns a bare path string, unlike `ccCli.find()` which returns `{ path, version }` — Task 4 uses it as a string throughout. `openVsCode` returns `{ ok, settingsSkipped }` in Task 4 and is read as `r.settingsSkipped` in Task 6.
