# Multi-Claude — Account Manager (Design)

Date: 2026-11-09
Status: Approved for implementation
Supersedes: `Claude-Account2.bat`

## 1. Problem

The user holds several legitimate Claude accounts and currently switches between them
with `Claude-Account2.bat`, which launches Claude Desktop against a second Chromium
profile directory (`%USERPROFILE%\Claude_Work`) via `--user-data-dir`.

This works but does not scale: adding a third account means copying and hand-editing
the batch file, there is no way to see which profiles exist or which are running, and
removing an account means manually deleting a folder from Explorer.

Goal: a small Windows desktop application (Electron) that lists Claude profiles and
can add, launch, rename, delete, and create shortcuts for them.

## 2. Policy and security position

### 2.1 Why this is acceptable

`--user-data-dir` is a stock Chromium flag. The design:

- does not patch, repack, or modify Claude Desktop
- does not read, copy, move, or back up auth tokens, cookies, or Local Storage
- does not spoof device identity
- does not interact with any rate-limit or quota mechanism

It is functionally identical to Chrome profiles. Anthropic's Consumer Terms prohibit
sharing account credentials or making an account available to another person, and make
the account holder responsible for activity on the account. There is no "one account
per person" clause. Enforcement has targeted account **sharing**, **reselling access**,
and **circumventing usage limits**.

### 2.2 Non-goals, enforced by omission

The following are deliberately excluded from the product, permanently, because they
convert profile isolation into limit-circumvention:

- automatic switching when an account hits a usage limit
- running accounts in parallel to pool or multiply quota
- any "next available account" / failover / rotation behaviour
- profile cloning or export (would duplicate live session tokens on disk)
- any credential capture, storage, or inspection

Each account is logged in by the user, inside Claude's own window.

### 2.3 Caveats recorded for the user

- An account registered under an employer domain may be linked to that organisation's
  enterprise account, whose administrator can manage it. Nothing here changes that.
- Claude Desktop exposes an internal `multiAccount` feature flag, observed as
  `unavailable` on this machine. If Anthropic ships native multi-account support, this
  tool becomes redundant and should be retired rather than worked around.
- The app is named `Multi-Claude`, not "Claude Account Manager", and its About text
  states it is not affiliated with Anthropic.

## 3. Environment (verified 2026-11-09 on the target machine)

| Fact | Value |
|---|---|
| Claude install | MSIX / Microsoft Store |
| Package family | `Claude_pzs8sxrjxfjjc` |
| Executable | `C:\Program Files\WindowsApps\Claude_<version>_x64__pzs8sxrjxfjjc\app\claude.exe` |
| Default profile dir | `%LOCALAPPDATA%\Claude-Data\claude_pzs8sxrjxfjjc` |
| Existing 2nd profile | `C:\Users\BS01085\Claude_Work` |
| Node / npm | v22.18.0 / 10.9.3 |
| Admin rights | No (not required) |

Two findings that shaped the design:

1. The Store build already passes its own `--user-data-dir`. The "default" account is
   therefore just another profile folder, so all accounts share one model.
2. `Get-CimInstance Win32_Process` returns command lines for `claude.exe` without
   elevation, so running-state can be detected for **all** instances, including ones
   started from the old `.bat` or a Start Menu shortcut. The top-level process does not
   always carry `--user-data-dir`, but its child processes always do.

## 4. Architecture

Three layers, each independently testable.

### 4.1 `src/main/` — privileged core (Node; renderer input is never trusted)

| Module | Responsibility |
|---|---|
| `claude-locator.js` | Resolve `claude.exe`. Order: cached path (if it still exists) → `%LOCALAPPDATA%\AnthropicClaude\app-*\claude.exe` (newest) → `%LOCALAPPDATA%\AnthropicClaude\claude.exe` → `(Get-AppxPackage *Claude*).InstallLocation` + `\app\claude.exe` → user-supplied path. Caches the winner; re-resolves when the cached path disappears (i.e. after an update). |
| `store.js` | Load/save `accounts.json`. Atomic write (temp file + rename). Schema validation on load; a corrupt file is renamed aside rather than silently reset. |
| `profiles.js` | Create profile directories, slugify labels, resolve collisions, compute directory size. |
| `launcher.js` | Spawn `claude.exe --user-data-dir=<dir>` detached and `unref()`ed. The default account launches with no flag. |
| `scanner.js` | Return the set of `--user-data-dir` values currently in use. |
| `deleter.js` | All delete guards and the actual removal. |
| `shortcuts.js` | `shell.writeShortcutLink` wrappers. |
| `ipc.js` | The IPC surface, below. |

### 4.2 `src/preload/preload.js`

`contextBridge.exposeInMainWorld('multiClaude', ...)` exposing exactly these calls and
nothing else:

    list()                     -> Account[]
    add({ label })             -> Account
    rename({ id, label })      -> Account
    launch({ id })             -> { ok }
    remove({ id, confirmLabel, unlockOutsideRoot }) -> { ok }
    openFolder({ id })         -> { ok }
    createShortcut({ id })     -> { path }
    locateExe()                -> { path }       // opens a native file dialog
    onState(cb)                -> unsubscribe    // push: running set + sizes

Every call takes an **account id**, never a path and never an executable location. The
main process looks up the path itself. This is the central injection defence.

### 4.3 `src/renderer/` — React, built by Vite

One screen (`App.jsx`, `AccountRow`, `DeleteDialog`, `TextPromptDialog`), bundled by
Vite into `dist-renderer/`. Window options:

    { contextIsolation: true, nodeIntegration: false, sandbox: true,
      webSecurity: true, preload: <preload.js> }

CSP meta tag: `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:;`

The bundle is served over a custom `app://` protocol registered as `standard` and
`secure`, not over `file://`. Two reasons: ES modules are blocked by CORS on `file://`,
and a real origin lets the CSP stay at `'self'` rather than needing `'unsafe-inline'`.
The protocol handler rejects any path that escapes `dist-renderer/`.

No remote content is ever loaded. `will-navigate` and `setWindowOpenHandler` are both
blocked in the main process.

## 5. Data model

`%APPDATA%\multi-claude\accounts.json`:

    {
      "version": 1,
      "exePath": "C:\\Program Files\\WindowsApps\\...\\claude.exe",
      "accounts": [
        { "id": "a1b2c3d4", "label": "Default", "kind": "default",
          "dir": "C:\\Users\\BS01085\\AppData\\Local\\Claude-Data\\claude_pzs8sxrjxfjjc",
          "createdAt": "2026-11-09T00:00:00Z" },
        { "id": "e5f6g7h8", "label": "Work", "kind": "imported",
          "dir": "C:\\Users\\BS01085\\Claude_Work", "createdAt": "..." },
        { "id": "i9j0k1l2", "label": "Personal", "kind": "managed",
          "dir": "C:\\Users\\BS01085\\ClaudeProfiles\\personal", "createdAt": "..." }
      ]
    }

`kind` drives every permission decision:

- `default` — launches with no flag; never deletable; size and open-folder work only if
  the directory exists
- `imported` — a pre-existing folder outside the managed root; deletable only with an
  explicit unlock
- `managed` — created by this app inside `%USERPROFILE%\ClaudeProfiles`; freely deletable

No field ever holds a credential, token, cookie, or email address.

### 5.1 First-run seeding

On first launch, with no `accounts.json`:

1. Resolve the package family name; register the default profile directory as
   `kind: default`, labelled "Default".
2. If `%USERPROFILE%\Claude_Work` exists, register it as `kind: imported`, labelled "Work".
3. Create `%USERPROFILE%\ClaudeProfiles` if absent.

Nothing is moved. `Claude-Account2.bat` keeps working unchanged.

## 6. Flows

### 6.1 Launch

Resolve exe → resolve account directory → spawn detached. `default` gets no
`--user-data-dir`. Mark running optimistically, then let the next scan confirm. If the
executable cannot be resolved, show an inline banner with a "Locate claude.exe…" button
rather than an error dialog.

### 6.2 Add account

The user types a label → slugify to `[a-z0-9-]`, collisions get `-2`, `-3` → create
`%USERPROFILE%\ClaudeProfiles\<slug>` → persist as `kind: managed` → launch it. Claude
opens signed out and the user signs in normally. The app never sees those credentials.

### 6.3 Running state, size, open folder

A scanner polls every 5 s **only while the window is focused**, pausing on blur, plus an
immediate scan after any launch. The PowerShell call extracts just the
`--user-data-dir` values and returns a short deduplicated list, so command-line blobs —
which can run to tens of KB per process — are never piped into Node:

    Get-CimInstance Win32_Process -Filter "Name='claude.exe'" |
      ForEach-Object {
        if ($_.CommandLine -match '--user-data-dir=(?:"([^"]+)"|([^\s]+))') {
          if ($Matches[1]) { $Matches[1] } else { $Matches[2] }
        }
      } | Sort-Object -Unique

Paths are normalised — resolved, lowercased, trailing separator stripped — before
comparison.

Sizes come from an async directory walk, cached for 60 s and recomputed on demand. Open
folder uses `shell.openPath`.

### 6.4 Delete

Ordered guards. The first failure stops the operation and explains itself:

1. `kind === 'default'` → refused outright; the UI disables the control.
2. The account appears in the running set → refused: "Close this Claude window first."
3. Path checks against the **realpath**:
   - must not be a reparse point (junction or symlink)
   - must not be a drive root, the user profile root, or shallower than 3 segments
   - must sit inside `%USERPROFILE%\ClaudeProfiles`, unless `kind === 'imported'` **and**
     the caller passed `unlockOutsideRoot: true` (a separate checkbox in the dialog)
4. `confirmLabel` must exactly equal the account's label.

Then `fs.rm(dir, { recursive: true, force: true })`, retrying up to 3 times with a 300 ms
backoff on `EBUSY` / `EPERM`. On success the entry is removed from `accounts.json`.

The dialog states plainly that this erases local data on this PC only, that the
Anthropic account itself is unaffected, and that no application can delete that account
from here.

### 6.5 Rename

The label is **cosmetic only**. Renaming updates `label` in `accounts.json` and nothing
else — the profile directory on disk keeps its original name forever. Renaming a running
account is allowed. Existing shortcuts keep their old filename; the UI says so and offers
to create a fresh shortcut rather than rewriting the old one.

This matters for deletion: the confirmation prompt always asks for the **current** label.

### 6.6 Shortcuts

`shell.writeShortcutLink` writing to the Desktop:

    target: <path to Multi-Claude.exe>
    args:   --launch <account-id>
    icon:   <path to Multi-Claude.exe>
    name:   "Claude - <label>.lnk"

Targeting our own executable rather than `claude.exe` means shortcuts survive Claude
updates, since the executable is re-resolved on every launch. The app takes a
single-instance lock; a second invocation carrying `--launch <id>` is routed to the
running instance via the `second-instance` event, which launches that profile without
showing the window. With no instance running, the app starts, launches the profile, and
quits without ever creating a window.

## 7. Error handling

| Condition | Behaviour |
|---|---|
| `claude.exe` unresolvable | Inline banner plus a "Locate claude.exe…" file dialog; the chosen path is persisted |
| `accounts.json` corrupt | Renamed to `accounts.corrupt-<ts>.json`, re-seeded, and the user is told |
| Profile directory missing | Row greyed with "folder missing"; offers Forget, which removes the entry only |
| Spawn fails | Toast carrying the OS error; nothing persisted |
| Delete blocked by a guard | The specific reason is shown in the dialog; nothing is deleted |
| `fs.rm` fails after retries | Partial-deletion warning; the entry is kept so the user can retry |
| PowerShell scan fails | Running indicators show "unknown" rather than "not running" |

## 8. Testing

Pure logic is unit-tested with `node:test`, no Electron required:

- `slugify` and collision resolution
- `accounts.json` schema validation, atomic write, corrupt-file recovery
- path normalisation and comparison (case, trailing separators, short vs long paths)
- **delete guards** — the critical suite: default-kind, running, reparse point, drive
  root, shallow path, outside-root without unlock, outside-root with unlock, wrong
  confirmation label, and the happy path, all against temp directories
- the regex that parses `--user-data-dir` out of quoted and unquoted command lines,
  against captured real samples

Manual verification: launch two profiles at once and confirm both show running; confirm
the default shows running when Claude is opened from the Start Menu; create and click a
shortcut; delete a throwaway profile.

## 9. Packaging

`electron-builder` produces an NSIS per-user installer targeting
`%LOCALAPPDATA%\Programs\multi-claude`, plus a portable executable. The build is
unsigned, so SmartScreen warns on first run; the README says so and explains
"More info → Run anyway".

## 10. Known limitations

- Launching the MSIX executable directly runs the second instance **without package
  identity**, so `claude://` deep links and some notification routing still go to the
  default instance. This already applies to the existing `.bat`.
- Windows only, by design.
- Shortcut icons use the Multi-Claude icon rather than Claude's, because the Claude
  executable path changes on every update and would break a pinned icon.

---

# Version 2 — dashboards

Date: 2026-11-09
Status: Built

## 11. What changed

Added token/cost usage, launch history, a disk-storage breakdown, and a five-view
dark-glass UI (React + Vite). The account management of version 1 is unchanged.

## 12. The data-access boundary

Version 1 held an absolute rule: never read anything inside a profile or inside Claude's
data. Version 2 relaxes it **in exactly one direction**, with the user's explicit
agreement:

- The app may read `~/.claude/projects/**/*.jsonl` for **metadata only** — token counts,
  timestamps, model names, project folder paths, recorded cost.
- It must never read, store, return or display message text, prompts, replies, titles or
  tool arguments. `usage.test.js` asserts a summary never contains message content.
- Profile directories themselves are still only created, measured and deleted wholesale.
  Nothing inside one is ever parsed.

Anyone extending `usage-reader.js` inherits that constraint.

## 13. What the data can and cannot say

Verified against 226 real session files (81,866 records, May–Nov 2026):

| Question | Answer |
|---|---|
| Claude.ai subscription usage? | **Not available.** Not local, not in any callable API. Never estimated. |
| Claude Code token counts? | Yes — `message.usage` on ~26k records. Reliable. |
| Cost? | Only on `cost-state` records, present in **28 of 226** sessions. Shown as partial, with the session count. |
| Per-account attribution? | Only via `attachment.organizationUuid`, present in **75 of 226**. The rest go to an "Unattributed" bucket. |

`~/.claude` is keyed to the home directory, not to `--user-data-dir`, so it is shared by
every profile. That is why attribution is partial and why it cannot be fixed by reading
harder.

A correction worth recording: an early probe reported ~$1,020 of cost by summing every
`cost-state` record. Those are *running totals* rewritten as a session progresses, so the
same spend was counted repeatedly. Taking the last record per session gives $249.06.

## 14. New modules

| Module | Responsibility |
|---|---|
| `usage-reader.js` | Parse session logs into per-session summaries. Substring prefilter before `JSON.parse`; async with periodic yields so a cold scan never freezes the window; incremental cache keyed on size + mtime. |
| `usage-aggregate.js` | Pure. Sessions → daily series, per-model, per-project, per-org, totals. Ranks by the metric the UI displays. |
| `activity-log.js` | Append-only JSONL of launch/stop transitions, folded into sessions and daily totals. |
| `storage.js` | Per-profile bytes by category, plus a guarded cache purge. |

## 15. Measured costs and the caches they forced

| Operation | Cold | Warm |
|---|---|---|
| Usage scan (226 files, 81,866 records) | ~3.4 s | ~20 ms |
| Storage walk (~23 GB across 3 profiles) | ~3.5 s | instant |

Both are cached to disk. Two bugs came out of this and are worth not repeating:

- Two mount effects each fired a storage walk. Concurrent walks of the same disk are far
  slower than one, so requests are now de-duplicated by an in-flight promise.
- `vm_bundles` was counted as "profile data". It is 8.8 GB of a 10 GB profile, so it now
  has its own category — otherwise the UI claims a user's login data weighs 8.8 GB.

## 16. Charts

Hand-rolled inline SVG; no chart library. Categorical colours are the validated
dark-surface slots, assigned in fixed order and never cycled or reassigned by rank. Two
slots sit at ΔE 4.0 under tritanopia, so every stacked segment and bar carries a direct
label and a legend — colour is never the sole encoding. Cache reads get their own chart
rather than sharing an axis with token counts, which would flatten the smaller series to
a flat line.
