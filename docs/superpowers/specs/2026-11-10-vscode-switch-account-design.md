# Switching VS Code's Claude account in place — Design (v2)

**Status:** approved 2026-11-10. Supersedes
`2026-11-10-vscode-per-account-design.md`, which shipped and is being replaced.

**Goal:** clicking an account's VS Code button makes **the VS Code you already
have open** use that account. No second window, no second profile, no signing in
to extensions again.

## 1. Why v1 is being replaced

v1 gave every account its own `--user-data-dir`. That is correct about process
isolation and wrong about what the user wanted. Its consequences in practice:

- a new VS Code window instead of the one already open,
- a separate profile per account, so GitHub, Copilot and Settings Sync are
  signed out once per account — extension *binaries* are shared via
  `--extensions-dir`, but extension sign-ins live in the user-data-dir,
- a few hundred MB per account on disk.

The requirement is the opposite trade-off: one VS Code, one real profile,
switch which Claude account it is using.

## 2. The mechanism

The Claude Code extension already expects its account to change underneath it.
From `extension.js` (v2.1.319):

```js
configDirSettings = new Q0({ refresh: (e) => this.refreshEveryHost(e), ... })
```

and the sibling path that fires it:

```js
refreshEveryHost(`The signed-in account changed outside this window
  (${s==="signed_out"?"signed out":"another account signed in"})`, …)
```

`Q0` is a debounced watcher (`SETTLE_MS = 1000`). The extension registers
`claudeCode.environmentVariables` with it, reading `CLAUDE_CONFIG_DIR` out of
that setting. When the value changes, the extension **refreshes its hosts in
place** — it does not require a new window or a manual reload.

So switching the account is: write `CLAUDE_CONFIG_DIR` into that setting, in
the user's real `settings.json`.

The setting is `scope: "machine"`, so it lives in user settings and cannot be
set per workspace. One account is therefore active machine-wide at a time. That
is accepted, and is what the user asked for.

Multi-Claude still never reads, copies or intermediates a credential. It writes
one path into one settings file; Anthropic's own CLI put the sign-in where that
path points.

### 2.1 Why not re-point `~/.claude` instead

The extension also watches the credentials files themselves and refreshes on
"another account signed in", so re-pointing `~/.claude` at an account's config
dir (via a directory junction, which needs no privilege on Windows) would work
mechanically. It is rejected: it puts Multi-Claude in the business of moving
credential storage around, which is the one thing the project refuses to do,
and it would displace the default account's own `~/.claude` data.

## 3. The managed block

The user's `settings.json` is JSONC — it has trailing commas and comments, so
`JSON.parse` throws on it. A tolerant parser would be the project's first
runtime dependency, and `package.json`'s `files` array ships only `src/`,
`dist-renderer/` and `package.json`, so one would not even be packaged.

Instead the setting is written inside comment markers and replaced as a block:

```jsonc
{
  // >>> multi-claude: managed block — do not edit by hand
  // Points Claude Code at the account Multi-Claude last switched to.
  "claudeCode.environmentVariables": [
    { "name": "CLAUDE_CONFIG_DIR", "value": "C:\\Users\\you\\AppData\\Roaming\\multi-claude\\cc\\ec255f4b" }
  ],
  // <<< multi-claude
  …the rest of the file, untouched…
}
```

- **First switch** inserts the block immediately after the opening `{`.
- **Later switches** replace everything between the markers, inclusive.

No parsing and no guessing where a value ends: the markers bound the edit
exactly. The path is escaped with `JSON.stringify`, so Windows backslashes
cannot corrupt the file.

**A key found outside the markers is the user's own.** Multi-Claude does not
fight it: the switch reports that the user's own setting is winning and changes
nothing. In JSONC the last key wins, so silently inserting a second copy could
point the editor at an account the user did not pick.

## 4. Architecture

### 4.1 `src/main/vscode-settings.js` (new)

Pure text in, pure text out, so it tests without a real settings file.

- `readManaged(text) -> string | null` — the `CLAUDE_CONFIG_DIR` currently in
  the managed block, or `null` when there is no block.
- `hasForeignKey(text) -> boolean` — true when `claudeCode.environmentVariables`
  appears outside the managed block.
- `writeManaged(text, ccDir) -> string` — the new file text, inserting or
  replacing the block. Given `''` it returns a complete minimal settings file.

### 4.2 `src/main/vscode.js` (reduced)

Keeps `candidateEditors` and `findVsCode` — VS Code must still be found in
order to be started when it is not running.

Removed: `seedProfile`, `SEEDED_FILES`, and `launch`'s `--user-data-dir` and
`CLAUDE_CONFIG_DIR` env. `launch(exePath, spawnImpl)` becomes a plain detached
spawn with no arguments: the setting is authoritative, so any VS Code start
picks up the right account.

Added: `isRunning(runPowerShell) -> Promise<boolean>`, so an already-open VS
Code is never given a second window. Uses the existing `run-powershell.js`
helper, as `scanner.js` does.

`OVERRIDE_KEY` stays and inverts meaning: it was the key we refused to copy, it
is now the key we own.

### 4.3 `service.js`

`openVsCode` is replaced by `useVsCodeAccount({ id })`:

1. `prepareCcDir(a)` for the account's config dir.
2. Read `deps.vscodeSettingsFile`; if `hasForeignKey`, return
   `{ ok: true, switched: false, reason: 'foreign' }` and change nothing.
3. Write the managed block: backup to `settings.json.multi-claude-<ts>.bak`,
   then write via temp file and rename, so a concurrent VS Code write can never
   see a half-file.
4. If `isRunning()` is false, `requireVsCode()` and `launch`.
5. Return `{ ok: true, switched: true, launched: <bool> }`.

Removed: `vscodeDirFor`, `deps.vscodeRoot`, `deps.vscodeUserDir`, and the VS
Code profile cleanup in `remove` — there is no per-account profile any more.

`main.js` supplies `vscodeSettingsFile: %APPDATA%\Code\User\settings.json`.

### 4.4 UI

The button stays where it is, beside Folder and Shortcut in both views, and
becomes **Use in VS Code**. Its message says which account VS Code is now
using, and whether a window was opened. No new indicator is added.

**Terminal is unchanged.** It passes `CLAUDE_CONFIG_DIR` per process to the
CLI, which does not read VS Code settings, so the two cannot conflict.

## 5. Error handling

| Case | Behaviour |
|---|---|
| Own `claudeCode.environmentVariables` outside the markers | Nothing is written; the UI says the user's own setting is in control. |
| `settings.json` missing | Created, containing only the managed block. |
| `settings.json` unreadable | `err('vscode_settings', …)`; nothing is written. |
| VS Code not found and not running | Setting is still written; the UI says VS Code was not found in the usual install locations. |
| Concurrent write by VS Code | Temp-and-rename keeps the file valid; the backup holds the previous version. |

## 6. Testing

`node --test`, no Electron, no network.

- `readManaged` — finds the dir; `null` with no block; `null` on a block with no
  value; tolerates CRLF.
- `hasForeignKey` — true for a key outside the block, false when the only
  occurrence is inside it. Any occurrence outside counts, including one inside
  a comment: without a parser we cannot tell the difference, and the
  conservative answer refuses to write rather than risk fighting a setting the
  user made.
- `writeManaged` — inserts after the opening brace on a file with no block;
  replaces in place on a second call; leaves the rest of a trailing-comma JSONC
  file byte-identical; round-trips through `readManaged`; escapes backslashes;
  builds a valid file from `''`.
- `useVsCodeAccount` — writes the account's own cc dir; refuses on a foreign
  key; launches only when not running; surfaces `vscode_settings` when the file
  cannot be read.

## 7. Consequences

- One account is active machine-wide at a time, and every open VS Code window
  follows it. That is the point, not a defect.
- Multi-Claude writes to a file the user also edits. Backups and atomic writes
  make that safe, not invisible.
- v1's per-account profiles are no longer created. Any left on disk from v1 are
  the user's to delete; the app no longer references them.

## 8. Out of scope

- Showing which account VS Code is currently using.
- Per-workspace accounts (the setting is machine-scoped; not possible).
- VS Code Insiders, VSCodium, or custom install locations.
- Tracking or closing VS Code windows.

## 9. Documentation

The README's "Opening VS Code as one account" section is rewritten: the button
switches the account in the VS Code you already have, the setting it writes and
where, that it is machine-wide and one at a time, and that your extensions and
their sign-ins are your own because there is no second profile. The
`vscode\<account id>` row leaves the *Where things live* table; a
`Code\User\settings.json` note replaces it.
