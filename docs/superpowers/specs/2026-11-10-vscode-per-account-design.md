# Per-account "VS Code" button — Design

**Status:** approved 2026-11-10, not yet implemented.

**Goal:** every account in Multi-Claude gets a button that opens VS Code already
connected to Claude Code as *that* account, with no sign-in step and no risk of
silently landing on the wrong account.

## 1. Why this is possible

Claude Code's identity is its config directory. From the VS Code extension's
`extension.js` (v2.1.319):

```js
function Ig(){ if(process.env.CLAUDE_CONFIG_DIR) return process.env.CLAUDE_CONFIG_DIR;
               return wt.join(lS.homedir(),".claude") }
```

Multi-Claude already gives every account its own `%APPDATA%\multi-claude\cc\<id>`
and signs in there through Anthropic's own flow. Verified on 2026-11-10 — the same
binary, the same command, only `CLAUDE_CONFIG_DIR` differing:

| config dir | reported account |
|---|---|
| `cc\f774b841` | `moshiuzzaman@brainstation-23.com`, pro |
| `cc\ec255f4b` | `moshi.bs23@gmail.com`, pro |

Credentials live in `.credentials.json` inside each config dir, not in Windows
Credential Manager (`cmdkey /list` reports no Claude entries). If Claude Code ever
switches to Credential Manager, isolation still holds: the credential target name
carries a `-sha256(CLAUDE_CONFIG_DIR).slice(0,8)` suffix whenever `CLAUDE_CONFIG_DIR`
is set.

So the feature reduces to: **start VS Code with `CLAUDE_CONFIG_DIR` set to that
account's config dir.** Multi-Claude still never reads, copies or intermediates a
credential, which keeps the project's standing constraint intact.

## 2. The blocker, and the measurement that settles it

VS Code is single-instance per user-data-dir. Launching `code` while an instance is
running hands the request to that process; the new window inherits the *original*
environment. Measured by counting instance roots (Code.exe whose parent is not
Code.exe):

```
baseline                     ROOTS: 1   root pid 58204  user-data-dir: DEFAULT
after `code --new-window`    ROOTS: 1   root pid 58204  user-data-dir: DEFAULT
with --user-data-dir         ROOTS: 2   root pid 58204  DEFAULT
                                        root pid 21088  C:\Users\...\.mc-vscode-test
```

Environment is inherited only at process creation. No new process means the window
cannot see a new `CLAUDE_CONFIG_DIR` — it silently belongs to whichever account
started the running instance. **Therefore every account needs its own
`--user-data-dir`.**

Extensions are unaffected: `--extensions-dir` is a separate flag defaulting to
`~/.vscode/extensions`, so all installed extensions, including the Claude Code
extension and its bundled CLI, stay shared.

## 3. Decisions

| Question | Decision |
|---|---|
| Which folder does the window open? | None passed. Each profile restores its own last session, like a normal VS Code. No new state in `accounts.json`. |
| What does a new profile start with? | `settings.json` and `keybindings.json` re-copied from the main VS Code on **every** launch. |
| Account not connected to Claude Code? | Open anyway. The extension prompts sign-in and writes into that account's config dir, so it self-heals. |
| Parallel use | No limit. README states the intent: for working across accounts you own, not for multiplying quota. |

### 3.1 Why there is no settings injection

Writing `claudeCode.environmentVariables` into each profile's settings was considered
as belt-and-braces and **rejected**. The source `settings.json` is JSONC — it contains
trailing commas and would fail `JSON.parse`. A tolerant parser means a runtime
dependency, and this project has none; the `files` array in `package.json` ships only
`src/`, `dist-renderer/` and `package.json`, so a runtime dependency would not be
packaged at all.

It is also unnecessary. The environment variable is unreliable *only* when a handoff
can reach an instance started with different environment, and a per-account
`--user-data-dir` removes exactly that case: any handoff reaches that account's own
instance.

One guard replaces the parser. Before copying, test the settings text for the substring
`claudeCode.environmentVariables`. That setting overrides inherited environment, so if
it is ever present the copy is skipped and the user is told.

## 4. Architecture

### 4.1 `src/main/vscode.js` (new)

Mirrors `cc-cli.js`. Pure functions plus one spawn, so it is testable without Electron.

- `candidateEditors(env, fsImpl)` — `%LOCALAPPDATA%\Programs\Microsoft VS Code\Code.exe`
  then `%ProgramFiles%\Microsoft VS Code\Code.exe`, filtered to those that exist.
  `Code.exe` directly — never the `bin\code` shim, which is a `.cmd` requiring a shell.
  The project's standing rule is that binaries are launched directly, never through a
  shell; during development Git Bash rewrote `/usage` into a filesystem path.
- `findVsCode(env, fsImpl)` — first candidate, else `null`.
- `seedProfile(profileDir, sourceUserDir)` — creates `<profileDir>\User`, copies
  `settings.json` and `keybindings.json` when present. Returns
  `{ copied, skipped }` where `skipped` is `'override'` or `null`. Missing source files
  are not an error.
- `launch(exePath, { profileDir, ccDir })` — spawns `exePath` with argv
  `['--user-data-dir', profileDir]`, env `{ ...process.env, CLAUDE_CONFIG_DIR: ccDir }`,
  `detached: true`, `stdio: 'ignore'`, then `unref()`. No folder argument. No shell.

### 4.2 `service.js`

`openVsCode({ id })`: `find(id)` → `requireVsCode()` → `prepareCcDir(a)` →
`vscodeDirFor(a)` → `seedProfile` → `launch` → `{ ok: true, settingsSkipped }`.

Same shape as the existing `openClaudeCode`. `requireVsCode()` mirrors `requireCli()`.

### 4.3 Paths

`main.js` gains `vscodeRoot: path.join(appDir, 'vscode')` beside the existing `ccRoot`,
and `vscodeUserDir` pointing at `%APPDATA%\Code\User`. Each account's profile is
`%APPDATA%\multi-claude\vscode\<id>`.

### 4.4 Deletion

`deleter.js` removes `vscode\<id>` alongside `cc\<id>`. The existing deletion guards are
unchanged; this path is app-owned and derived from the account id, never user-supplied.

### 4.5 Wiring

`ipc.js` CHANNELS and handler → `preload.js` → `renderer/lib/api.js` → UI. The bridge
continues to pass only account ids; no filesystem path crosses it.

### 4.6 UI

A ghost **VS Code** button in `AccountRow.jsx` beside Folder and Shortcut, and in the
Account page's action group. **Not** on Dashboard cards, which stay limits plus
Launch/Close.

`openClaudeCode` is reachable from `api.js` but no component calls it. It is surfaced in
the same group as **Terminal**, since it is the same idea already written.

## 5. Error handling

| Case | Behaviour |
|---|---|
| No VS Code found | `no_vscode`: "VS Code is not installed on this PC. Install it from code.visualstudio.com, then try again." — mirroring `no_claude_code`. |
| Account not connected | Launch proceeds; the extension prompts sign-in. |
| Guard substring present | Launch proceeds; the UI reports that settings were not copied. |
| Profile dir cannot be created | Error surfaces to the UI; nothing is launched. |

## 6. Testing

`node --test`, no Electron, alongside the existing 190 tests.

- `candidateEditors` — ordering, filtering, missing env vars, with a fake fs.
- `seedProfile` — copies both files; tolerates a missing `keybindings.json`; creates
  `User/`; returns `skipped: 'override'` and copies nothing when the guard substring is
  present.
- `launch` — argv is exactly `['--user-data-dir', profileDir]`, env carries
  `CLAUDE_CONFIG_DIR`, no shell, detached, with an injected spawn.
- `openVsCode` — raises `no_vscode` when nothing is found; passes the account's own
  config dir and profile dir.

## 7. Consequences

- Each profile grows to a few hundred MB (`workspaceStorage`, `CachedData`, logs); three
  accounts is roughly a gigabyte under `%APPDATA%\multi-claude\vscode\`. Account deletion
  reclaims it.
- Re-copying settings on every launch discards settings changed *inside* an account
  window. Accepted deliberately; it also makes each launch re-assert a known-good state.
- Each account's VS Code keeps its own window layout and recent-folders list. That is
  what makes per-account restore work.

## 8. Out of scope

- Including VS Code profiles in the Storage view's measurement.
- Tracking or closing VS Code windows the way `closer.js` does for Claude Desktop.
- VS Code Insiders, VSCodium, or other editors.
- Any form of automatic account switching or failover.

## 9. Documentation

README gains a row in *Where things live* for `%APPDATA%\multi-claude\vscode\<id>`, a
short section on the button, and one line placing it as working across accounts you own
rather than multiplying quota.
