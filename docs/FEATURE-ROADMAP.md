# Multi-Claude feature roadmap

Features to build one at a time, in order. Each one comes from a feature seen in a
similar tool (researched November 2026), with a link to that tool's code or docs.

**Priority:**
- **Core** = what a multi-account manager must get right: telling accounts apart,
  reaching the right window, keeping each profile one account, signing in, and using
  each account in Claude Code. Build these first.
- **High** = most value for the work after Core.
- **Mid** = useful, more work or a decision needed.
- **Low** = polish and distribution.
**Effort:** S = a day or less, M = a few days, L = a week or more, or needs a prototype.

**Rules every feature must keep** (from the README, "What it will not do"):
no automatic switching, no pooled or "next available" launching, no copying or
exporting sign-ins, and no reading files inside a profile beyond what already
happens (`config.json` setting names, `plan-usage-history.json` percentages).

## How to build each feature: analyse first, then build

No feature starts with code. Every feature goes through these steps, in order:

1. **Read the spec** for the feature below.
2. **Study every reference link.** Read the README or docs, and for open-source repos
   read the code that does this feature (search the repo for it). Note how they do it,
   what the user sees, and the edge cases they handle.
3. **Read their issues.** Search each reference repo's Issues for the feature: bugs,
   complaints and requests show what went wrong and what users really want.
4. **Answer the feature's "Analyse first" questions** (listed under each feature).
5. **Compare the ideas** in a short table: each reference's approach, pros, cons, and
   whether it fits the rules below.
6. **Take the better idea.** Pick the best approach, or combine the best parts, and
   note anything Multi-Claude can do better than all of them.
7. **Write the decision** into the feature's **Analysis notes** (approach chosen, why,
   what was rejected), set its status to **Analysed**, and get it agreed.
8. **Then build it**, with tests, and set the status to **Building**.
9. **Verify it is really done.** Run every "Done when" check in the real app on the PC
   (and on a Mac where the feature touches the Mac), not only the unit tests. Write
   what was checked and the result into the feature's **Verification** notes.
10. **Update the status in the table**: **Done** only when every check passed;
    otherwise keep **Building** and name what is still open (for example
    "Done (Mac untested)").

**Learn ideas, don't copy code.** Write Multi-Claude's own code. Code from MIT-licensed
repos may be reused only with its licence notice kept; never copy from AGPL, unlicensed
or closed-source projects (several references have no clear licence).

**Status values:** To do → Analysed → Building → Done. A feature is never marked Done
without step 9.

Template for each feature's **Analysis notes**:

```
Analysed on: <date>
References read: <links, plus issues looked at>
| Reference | How they do it | Pros | Cons | Fits rules? |
|---|---|---|---|---|
Chosen approach: <what we will build>
Why it's better: <reason>
Rejected: <ideas not taken, and why>
```

## Feature list

| # | Feature | Priority | Effort | Status |
|---|---|---|---|---|
| 1 | Bring a running account to the front | Core | S | Done (Mac untested) |
| 2 | Per-account colour | Core | M | To do |
| 3 | Own taskbar group per account (Windows) | Core | L | Needs prototype |
| 4 | Same-account and wrong-account warning | Core | S | Needs decision |
| 5 | Folder-to-account link for VS Code | Core | M | To do |
| 6 | Guided Google sign-in (Mac) | Core | M | To do |
| 7 | Tray / menu-bar icon | High | M | To do |
| 8 | Limit alerts | High | S | To do |
| 9 | Usage history chart | High | M | To do |
| 10 | Claude status (outage) badge | High | S | To do |
| 11 | Memory per account and idle sleep | Mid | M | To do |
| 12 | Pace, burn rate and offline cache | Mid | S | To do |
| 13 | Start with the computer | Mid | S | To do |
| 14 | Settings backup, export and import | Mid | S | To do |
| 15 | More languages (Bangla first) | Low | M | To do |
| 16 | PIN lock | Low | S | To do |
| 17 | `multi-claude://` links and launcher support | Low | S | To do |
| 18 | Command-line status (`--status --json`) | Low | S | To do |
| 19 | winget, Homebrew and code signing | Low | M | To do |

---

## Core priority

### 1. Bring a running account to the front

**What:** When an account is already running, the Launch button becomes "Show" and
brings its window to the front instead of doing nothing.

**References**
- KeyboardCowboy/multi-claude — "Focus instead of duplicate":
  https://github.com/KeyboardCowboy/multi-claude

**Analyse first**
- How does KeyboardCowboy pick the right window when several Claude instances share
  one app name on a Mac?
- On Windows, which works under the focus-stealing rules: `AppActivate`,
  `SetForegroundWindow`, or restoring a minimised window first? Test each.
- Does the main Claude process own the window, or a child process?

**Analysis notes**

```
Analysed on: 2026-11-13
References read: KeyboardCowboy/multi-claude — main.js (launch handler), lib/instances.js,
  issues #1–#9 (none about focusing; #5 is about telling instances apart, see feature 3).
  Licence: none stated, so ideas only, no code.
Tested on this PC (Claude Store build 5.11492.2.0): profile "m" running with its window
  hidden in the tray, then minimised; the default account via the Store app.
```

Answers to the questions:
- **How KeyboardCowboy does it:** it has no focus code. It runs the same
  `open -n -a Claude --args --user-data-dir=<dir>` again and relies on Chromium's
  single-instance lock (keyed on the data folder): the new process hands off to the
  running one and exits, and Claude shows its own window.
- **Which process owns the window:** the main Claude process (no `--type=` flag) owns
  the `Chrome_WidgetWin_1` window titled "Claude". When Claude is closed to the tray the
  window still exists but is hidden, and `MainWindowHandle` reads 0.
- **Windows test results:** running Multi-Claude's normal launch again for "m"
  (`claude.exe --user-data-dir=...\ClaudeProfiles\m`) handed off to the running copy:
  no new process; the hidden window became visible and foreground. Same result
  when the window was minimised: restored and foreground.
- **Default account:** the Store build's default Claude uses
  `%LOCALAPPDATA%\Claude-Data\claude_<family>`. Opening the Store app
  (`explorer.exe shell:AppsFolder\Claude_pzs8sxrjxfjjc!Claude`, the same as the Start
  menu) handed off to it: no new process, Claude in front.

| Approach | How | Pros | Cons | Fits rules? |
|---|---|---|---|---|
| A. Launch again (Claude's own hand-off) | Existing `launcher.launch()` | No new code path; tested: tray-hidden and minimised windows come back and take focus; Claude decides what to show | Relies on Claude keeping its single-instance behaviour | ✅ |
| B. `WScript.Shell.AppActivate(pid)` | PowerShell | Simple | Can't show a window hidden in the tray; PowerShell start-up delay; focus rules may only flash the taskbar | ✅ |
| C. Win32 `ShowWindow` + `SetForegroundWindow` | PowerShell `Add-Type` or a native module | Full control | Focus-stealing rules; shows the window behind Claude's back; native code to maintain | ✅ |
| D. Store activation `shell:AppsFolder\<AUMID>` | `explorer.exe` | Tested for the default account; same as the Start menu | Only for the Store build's default account | ✅ |
| E. Mac `osascript` System Events, by unix id | `osascript` | Picks the exact process | Needs Accessibility permission; untested | ✅ |

**Chosen approach:** A, plus D for the default account on the Store build. On a Mac, A as
well (KeyboardCowboy relies on the same hand-off), with E kept only as a fallback if a
real-Mac test shows A doesn't bring the window forward.

**Why it's better:** it is the only tested option that brings back a window hidden in
the tray, it needs no focus hacks or native code, and Claude itself decides how to show
its window. Multi-Claude does better than KeyboardCowboy by saying what will happen:
a running account gets a clear **Show** button next to **Close**, instead of a Launch
button that silently focuses.

**Rejected:** B (can't show tray-hidden windows), C (fights Windows focus rules and
needs native code), E as the main path (needs an extra macOS permission).

**Where in Multi-Claude**
- `src/main/service.js`: add `show({ id })`. For the Store build's default account,
  open `shell:AppsFolder\<package family>!Claude`; for every other account, call the
  existing `launcher.launch()`. No activity record: showing is not a new session.
- `src/main/claude-locator.js`: expose the package family it already resolves
  (used for the Claude-Data path), so the AUMID isn't hard-coded.
- `src/main/ipc.js`, `src/preload/preload.js`, `src/renderer/lib/api.js`: wire `show`.
- `AccountRow.jsx`, `Dashboard.jsx`, `AccountDetail.jsx`: when running, show
  **Show** (primary) and **Close**; when not running, **Launch** as today. When the
  scan failed, keep today's Launch (it hands off anyway).
- Tests: `service.show` picks Store activation for the default account and the
  launcher for the others.

**Done when:** on this PC, Show brings forward each account's window from hidden in
the tray, minimised, and behind other windows, never another account's; the default
account works through the Store app; no second Claude process is ever started.
Real-Mac check stays open until someone tests it on a Mac.

**Verification** (2026-11-13, branch `feat/show-window`, test copy of Multi-Claude on
this PC, Claude Store build 5.11492.2.0; the Show button was clicked in the app)

| Check | Result |
|---|---|
| Unit tests (8 new: Store app id, which account goes which way, Mac path, errors, no history) | ✅ 338 pass, 1 skipped |
| Show appears next to Close on running accounts; Launch stays on stopped ones | ✅ Default and m show Show + Close; Anika shows Launch |
| m hidden (as when closed to the tray) → Show | ✅ window visible, in front |
| m minimised → Show | ✅ restored, in front |
| m behind Multi-Claude → Show | ✅ m in front |
| Default → Show (through the Store app) | ✅ the default Claude in front |
| No second Claude process started | ✅ m stayed one process (3232); Default's processes unchanged |
| Never another account's window | ✅ each Show put only its own account in front |
| Real Mac | ⬜ not tested (no Mac available) |

---

### 2. Per-account colour

**What:** Pick a colour per account. Shown on its card, row and page, and as a coloured
badge (first letter) on its desktop shortcut icon, so shortcuts are told apart.

**References**
- KeyboardCowboy/multi-claude — name and colour per profile:
  https://github.com/KeyboardCowboy/multi-claude
- Claude Sessions Pro — coloured letter on each account's Dock icon:
  https://alternativeto.net/software/claude-sessions-pro/about/
- Ferdium — icon per service: https://ferdium.org/

**Analyse first**
- How does KeyboardCowboy store and show colours, and which palette does it offer?
- How does Claude Sessions Pro design its lettered Dock icons (letter, badge, or tint)?
- How can Multi-Claude make a `.ico` / `.icns` at runtime without adding a heavy
  dependency (Electron `nativeImage`, an offscreen canvas)?

**Analysis notes:** _Not analysed yet._

**Where in Multi-Claude:** add `color` to the account record in `src/main/store.js`
(bump `SCHEMA_VERSION`, migrate old stores); colour picker in the rename dialog;
generate a per-account `.ico` (Windows) / `.icns` (Mac) for `src/main/shortcuts.js`
and `createMacShortcut` in `src/main/mac.js`.

**Done when:** the colour shows everywhere the account appears; new shortcuts get a
coloured icon; old stores load without a colour (default colour).

---

### 3. Own taskbar group per account (Windows)

**What:** Today every account's window groups under one Claude taskbar icon. Give each
account's window its own taskbar group, name and icon.

**References**
- Parall — separate Dock icon and name per copy (Mac):
  https://apps.apple.com/app/parall/id6754065114
- Claude Sessions Pro — separate Dock app per account:
  https://alternativeto.net/software/claude-sessions-pro/about/
- Windows: per-window AppUserModelID —
  https://learn.microsoft.com/en-us/windows/win32/shell/appids and
  https://learn.microsoft.com/en-us/windows/win32/api/shellapi/nf-shellapi-shgetpropertystoreforwindow

**Analyse first**
- How do Parall and Claude Sessions Pro give each copy its own Dock identity, and what
  breaks for them when Claude updates?
- Search GitHub for open-source Windows tools that set `PKEY_AppUserModel_ID` on
  another app's window; how reliable are they?
- Does Claude reset the property, or open new windows that lose it?

**Analysis notes:** _Not analysed yet._

**Where in Multi-Claude:** prototype first in a scratch script: after launch, find the
account's top-level windows and set `PKEY_AppUserModel_ID` (plus relaunch icon/name) on
them from outside. If that works reliably, add it to `src/main/launcher.js`.

**Decision first:** this is the riskiest item. Claude may reset the property, and on a
Mac it would need copying and re-signing Claude.app, which the README avoids. Build
only if the Windows prototype holds up across a Claude update.

**Done when:** two running accounts show as two taskbar icons with their own names.

---

### 4. Same-account and wrong-account warning

**What:** Warn when two profiles are signed in to the same Claude account ("Work and
Work 2 are the same account"), and when a profile is now signed in to a different
account than the one it was set up with ("Work is signed in to another account").
Each profile must stay one account, or the whole side-by-side setup breaks.

**References**
- KeyboardCowboy/multi-claude — account warnings and duplicate-account protection:
  https://github.com/KeyboardCowboy/multi-claude

**Analyse first**
- Exactly which value does KeyboardCowboy compare, and how does it map an account ID
  to an email?
- What choices does it offer on a mismatch (switch back, keep, remove duplicate)?
- Is there a way to detect duplicates without reading the ID's value?

**Analysis notes:** _Not analysed yet._

**Where in Multi-Claude:** `src/main/desktop-signin.js` reads only setting *names* from
`config.json` today. This needs the *value* of `lastKnownAccountUuid` (an account ID,
not a token). Compare a hash of it across accounts in `service.list()`; never store or
show the raw ID. Save the hash when the account is first signed in; a different hash
later means it changed accounts.

**Decision first:** this widens what Multi-Claude reads from a profile. Update the
README's "How it works" if you build it.

**Done when:** a warning pill shows on both accounts when they match, and on an account
whose sign-in changed, with a choice to accept the new account.

---

### 5. Folder-to-account link for VS Code

**What:** "Use this account for this project": writes the setting into that project's
`.vscode/settings.json` instead of the global one, so different repositories use
different accounts you own.

**References**
- claude-swap — `map` / `unmap` folders to accounts: https://github.com/realiti4/claude-swap
- cux — projects bound to accounts: https://github.com/inulute/cux

**Analyse first**
- How do claude-swap's `map` (subfolders inherit) and cux's projects decide which
  account a folder uses?
- Which VS Code setting wins when both user and workspace settings set the account?
- Should the workspace file be committed by the user's team, or kept out of git?

**Analysis notes:** _Not analysed yet._

**Where in Multi-Claude:** reuse the managed-block writer in
`src/main/vscode-settings.js` with a workspace path; UI on the account page.

**Done when:** two projects open in VS Code with two different accounts; removing the
link restores the file.

---

### 6. Guided Google sign-in (Mac)

**What:** On a Mac, if only one Claude window is open, the `claude://` sign-in link
goes to it. So: close the other Claude windows (with permission), open only this
account, sign in with Google, then offer to reopen what was closed.
This does not help on Windows, where the Store version always sends the link to the
default Claude.

**References**
- KeyboardCowboy/multi-claude — "Guided sign-in":
  https://github.com/KeyboardCowboy/multi-claude

**Analyse first**
- Walk through KeyboardCowboy's guided sign-in step by step: what it closes, what it
  tells the user, how it reopens.
- Does it also handle connector (MCP) sign-ins the same way?
- Check its issues for cases where the link still went to the wrong window.

**Analysis notes:** _Not analysed yet._

**Where in Multi-Claude:** `src/renderer/components/ClaudeSignInGuide.jsx` (Mac branch
using `isMac` from `src/renderer/lib/api.js`); close/reopen through `service.js`.

**Done when:** tested on a real Mac — a new account signs in with Google and stays
signed in on the next launch.

---

## High priority

### 7. Tray / menu-bar icon

**What:** A tray icon (Windows) or menu-bar item (Mac). Its menu lists each account
with its Session and Weekly figures, a running dot, and Launch / Close / Bring to
front. Plus Open Multi-Claude, Check for updates, Quit. Closing the main window
keeps the app in the tray (optional setting).

**References**
- CodexBar — two-bar meter icon (session on top, weekly below):
  https://github.com/steipete/CodexBar · docs: https://www.mintlify.com/steipete/codexbar/features/menu-bar
- claude-swap — menu bar app, README section "Menu Bar":
  https://github.com/realiti4/claude-swap
- cc-switch — one tray row per tool with its quota:
  https://github.com/farion1231/cc-switch
- Electron Tray API: https://www.electronjs.org/docs/latest/api/tray

**Analyse first**
- How does CodexBar draw a readable two-bar meter at tray size, in light and dark
  mode (Mac template images vs Windows 16/32 px icons)?
- Compare the menus of CodexBar, claude-swap and cc-switch: what sits at the top level,
  what goes in submenus, how many accounts fit before it gets long?
- How does each handle "close window" vs "quit"? What do their issues say about it?

**Analysis notes:** _Not analysed yet._

**Where in Multi-Claude:** new `src/main/tray.js`, created from `src/main/main.js`;
menu built from `service.list()` and `service.limits()`; rebuild the menu when
either changes.

**Done when:** the tray menu shows every account with its figures and running state;
Launch/Close work from it; Quit really quits; works on Windows and Mac.

---

### 8. Limit alerts

**What:** A system notification when an account crosses a threshold, for example
"Work: Weekly at 80%". Thresholds set per account (default 80% and 95%, Session and
Weekly). Each threshold fires once per window, not on every refresh. Information only:
it never switches or launches anything.

**References**
- Claude-Code-Usage-Monitor — warnings near the limit:
  https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor
- CodexBar — limit display and reset countdowns:
  https://github.com/steipete/CodexBar
- Electron Notification API: https://www.electronjs.org/docs/latest/api/notification

**Analyse first**
- How does Claude-Code-Usage-Monitor decide "near limit", and how does it avoid
  repeating the same warning?
- What thresholds do the references use by default? Does any offer snooze or quiet hours?
- Search their issues for "notification" / "spam" / "too many alerts".

**Analysis notes:** _Not analysed yet._

**Where in Multi-Claude:** new `src/main/alerts.js` (pure: previous figures + new
figures + thresholds → alerts to show), called after each limits refresh; thresholds
saved per account in `src/main/store.js`; settings on the account page
(`src/renderer/views/AccountDetail.jsx`).

**Done when:** crossing a threshold shows one notification; it doesn't repeat until
usage drops below and crosses again; unit tests cover the crossing logic.

---

### 9. Usage history chart

**What:** On each account page, a line chart of Session and Weekly usage over the
last 7 / 30 days, from every sample in Claude's own `plan-usage-history.json`. Today
only the newest sample is used. No new data and no extra sign-in needed.

**References**
- cc-switch — trend charts and a yearly heatmap:
  https://github.com/farion1231/cc-switch
- Claude-Code-Usage-Monitor — daily and monthly views:
  https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor
- CodexBar — usage history and cost scan:
  https://github.com/steipete/CodexBar

**Analyse first**
- Which of cc-switch's views (trend line, heatmap) reads best for percentages that
  reset every 5 hours and every week?
- How does Claude-Code-Usage-Monitor group by day and month?
- How far apart are the samples in real `plan-usage-history.json` files, and how far
  back do they go? (Decides 7 vs 30 days and how to draw gaps.)

**Analysis notes:** _Not analysed yet._

**Where in Multi-Claude:** add `readDesktopUsageHistory(dir, { since })` next to
`readDesktopUsage` in `src/main/desktop-usage.js` (same parsing and `pct()` clamping);
expose through `service.js` / `ipc.js` / preload; draw it as a hand-made SVG in a new
`src/renderer/components/UsageChart.jsx` (the app has no chart library), styled with
the existing glass look.

**Done when:** the chart shows real samples for 7 and 30 days; gaps where Claude wasn't
running show as gaps, not zero; empty state for a new account; unit tests for the
history reader.

---

### 10. Claude status (outage) badge

**What:** A small badge in the app header (and later the tray) when Claude reports an
outage: green / amber / red with the description, click to open the status page.
Checked every few minutes, only while the app is open.

**References**
- CodexBar — outage light on the menu-bar icon:
  https://github.com/steipete/CodexBar
- clauth — Status tab with the incident feed: https://github.com/uwuclxdy/clauth
- Claude's public status API (Atlassian Statuspage):
  https://status.claude.com/api/v2/status.json (overall) and
  https://status.claude.com/api/v2/summary.json (components and incidents)

**Analyse first**
- Which endpoint and how often do CodexBar and clauth poll?
- Do they show only the overall state, or affected components (Claude.ai, Claude Code,
  API) and incident titles?
- What do they show when the status page itself can't be reached?

**Analysis notes:** _Not analysed yet._

**Where in Multi-Claude:** new `src/main/claude-status.js` (fetch + parse, using the
same HTTP helper style as `src/main/update-http.js`); badge in the header of
`src/renderer/App.jsx`.

**Done when:** the badge matches `status.indicator` (`none` / `minor` / `major` /
`critical`); no network error ever shows as an outage; unit tests for the parser.

---

## Mid priority

### 11. Memory per account and idle sleep

**What:** Show each running account's memory use. Optional: close an account that
hasn't been in front for X minutes (off by default, per account).

**References**
- Ferdium — hibernation of unused services: https://ferdium.org/
- claude-desktop-multi — notes that each instance is a full app and RAM grows:
  https://github.com/sypnose-cloud/claude-desktop-multi

**Analyse first**
- What counts as idle in Ferdium's hibernation, which services are excluded, and how
  does it wake them?
- Read Ferdium's issues about hibernation losing work or waking badly.
- Which memory figure is honest for an Electron app's whole process tree (working set,
  private bytes, RSS)?

**Analysis notes:** _Not analysed yet._

**Where in Multi-Claude:** extend the scan in `src/main/scanner.js` (Windows:
WorkingSet of the process tree) and `src/main/mac.js` (`ps -o rss`); sum per account.
Idle: poll the foreground window's process every minute; close through the existing
closer (`src/main/closer.js`), which already asks Claude to close politely.

**Done when:** memory shows on running accounts; idle close never closes the window in
front and is off unless turned on.

---

### 12. Pace, burn rate and offline cache

**What:** Next to each limit: "on pace" / "ahead of pace" compared with spending evenly
to the reset, and how fast it's rising. Keep the last good figures when offline,
labelled with their age, and label every figure as live or recorded.

**References**
- CodexBar — pace tracking: https://github.com/steipete/CodexBar
- Claude-Code-Usage-Monitor — burn rate, predictions, labels showing where each figure comes from:
  https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor
- clauth — cached usage bars when offline: https://github.com/uwuclxdy/clauth

**Analyse first**
- What formula does CodexBar use for pace, and how does it word "ahead" / "behind"?
- How do Claude-Code-Usage-Monitor's burn rate and P90 prediction work, and how
  accurate do users say they are?
- How does clauth cache figures, and how does it show that they're old?

**Analysis notes:** _Not analysed yet._

**Where in Multi-Claude:** pure helpers in `src/main/limits.js` (pace needs reset
times, so live limits only; burn rate can use the history from feature 9); display in
`src/renderer/components/AccountLimits.jsx`.

**Done when:** pace shows only when reset times are known; offline shows the last
figures with their age instead of an error.

---

### 13. Start with the computer

**What:** Setting "Start Multi-Claude when I sign in", opening quietly in the tray.
It does not launch any Claude accounts by itself.

**References**
- cc-switch — auto-launch: https://github.com/farion1231/cc-switch
- claude-swap — menu bar runs at login: https://github.com/realiti4/claude-swap
- Electron: `app.setLoginItemSettings` —
  https://www.electronjs.org/docs/latest/api/app#appsetloginitemsettingssettings-macos-windows

**Analyse first**
- How do cc-switch and claude-swap start hidden, and how do they avoid starting twice?
- Does `app.setLoginItemSettings` behave the same for the installer build and the
  portable build? (The portable exe's path can move.)
- What do their issues say about slow sign-in or the app not starting?

**Analysis notes:** _Not analysed yet._

**Where in Multi-Claude:** settings toggle; `src/main/main.js` reads a `--hidden`
argument (`src/main/argv.js`) to start without the window. Needs feature 7.

**Done when:** after signing in to the computer, Multi-Claude is in the tray with no
window and no Claude launched.

---

### 14. Settings backup, export and import

**What:** Automatic daily backup of Multi-Claude's own store (account names, colours,
folder paths, thresholds), keeping the last 10; Export / Import to move to a new PC.
Never anything inside a profile, never a sign-in.

**References**
- cc-switch — backups every 24 hours, keeps 10:
  https://github.com/farion1231/cc-switch
- claude-swap `export` — for contrast: it exports credentials, which Multi-Claude must
  not do: https://github.com/realiti4/claude-swap

**Analyse first**
- How does cc-switch rotate backups and restore one? What does the restore screen show?
- Exactly what does claude-swap's `export` contain, so Multi-Claude's export clearly
  leaves sign-ins out?
- How should an import handle profile folders that don't exist on the new PC?

**Analysis notes:** _Not analysed yet._

**Where in Multi-Claude:** `src/main/store.js` (`save` writes a dated copy to a
`backups` folder; import runs `validate`); buttons on the Storage view.

**Done when:** a bad store can be restored from a backup; import refuses invalid files.

---

## Low priority

### 15. More languages (Bangla first)

**What:** Translate the interface; Bangla and English first, then others. Language
setting, defaulting to the system language.

**References**
- cc-switch — 8 languages: https://github.com/farion1231/cc-switch
- react-i18next: https://react.i18next.com/

**Analyse first**
- Which library and file layout does cc-switch use, and how does it pick the language
  on first run?
- How do they handle numbers, dates and plurals per language?
- Does Bangla text fit the current button widths and font?

**Analysis notes:** _Not analysed yet._

**Where in Multi-Claude:** move strings from `src/renderer/**` into
`src/renderer/locales/<lang>.json`.

**Done when:** every visible string comes from a locale file; switching language needs
no restart.

---

### 16. PIN lock

**What:** Optional PIN to open Multi-Claude, for shared PCs. Hashed with a salt, never
stored plainly. It locks only Multi-Claude, not the Claude windows.

**References**
- Ferdium (inherited from Franz/Ferdi) — app lock: https://ferdium.org/

**Analyse first**
- When does Ferdium lock (on start, after a timeout, on sleep), and how does a user
  recover a forgotten password?
- Read Ferdium's issues about the lock being bypassed or annoying.

**Analysis notes:** _Not analysed yet._

**Where in Multi-Claude:** lock screen in `src/renderer/App.jsx`; hash with Node
`crypto.scrypt` in the main process; tray actions also check the lock.

**Done when:** the app opens to the lock screen; a wrong PIN shows nothing else.

---

### 17. `multi-claude://` links and launcher support

**What:** `multi-claude://launch/<account>` and `multi-claude://show/<account>`, so
Raycast, Alfred, PowerToys Run or a browser bookmark can open an account.

**References**
- cc-switch — `ccswitch://` links: https://github.com/farion1231/cc-switch
- Parall — works with Alfred and Raycast:
  https://talk.macpowerusers.com/t/parall-run-the-same-mac-app-separately-with-its-own-data-and-dock-icon/45561
- Electron: `app.setAsDefaultProtocolClient` —
  https://www.electronjs.org/docs/latest/api/app#appsetasdefaultprotocolclientprotocol-path-args

**Analyse first**
- What link format does cc-switch use, and does it ask before acting on a link?
- How is the protocol registered for the NSIS installer, the portable build and the
  Mac app's Info.plist?
- Which actions are safe to run from a link a web page could open? (Launch and Show
  only; never delete or change settings.)

**Analysis notes:** _Not analysed yet._

**Where in Multi-Claude:** register in `src/main/main.js`; parse in `src/main/argv.js`
next to the existing `--launch <id>`.

**Done when:** opening the link launches or shows the account, including when
Multi-Claude was not running.

---

### 18. Command-line status (`--status --json`)

**What:** `Multi-Claude.exe --status --json` prints each account's running state and
latest figures, then exits — for scripts and status bars.

**References**
- claude-swap — `--json` with a `schemaVersion`: https://github.com/realiti4/claude-swap
- clauth — writes `status.json` for other tools: https://github.com/uwuclxdy/clauth
- Claude-Code-Usage-Monitor — `--once` with exit codes:
  https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor

**Analyse first**
- Compare claude-swap's JSON fields and `schemaVersion` with clauth's `status.json`
  and Claude-Code-Usage-Monitor's exit codes; which shape is easiest for scripts?
- A Windows GUI exe has no console: how do Electron apps print to the terminal that
  started them (attach to the parent console, or a small separate CLI)?

**Analysis notes:** _Not analysed yet._

**Where in Multi-Claude:** `src/main/argv.js` + an early exit in `src/main/main.js`
before any window opens (must work while the single-instance app is already running).

**Done when:** output is stable JSON with a `schemaVersion`; documented in the README.

---

### 19. winget, Homebrew and code signing

**What:** Install with `winget install` and `brew install --cask`; sign the Windows
installer (no SmartScreen warning) and sign + notarise the Mac app (no right-click →
Open step).

**References**
- winget package repository: https://github.com/microsoft/winget-pkgs
- Homebrew Cask Cookbook: https://docs.brew.sh/Cask-Cookbook
- CodexBar and cc-switch both ship Homebrew casks:
  https://github.com/steipete/CodexBar · https://github.com/farion1231/cc-switch

**Analyse first**
- How do CodexBar and cc-switch update their Homebrew casks on each release (by hand
  or a GitHub Action)?
- Which tool automates winget manifests on release (wingetcreate, komac)?
- What do Windows code signing and an Apple Developer ID cost per year, and is there
  a free option for open-source projects?

**Analysis notes:** _Not analysed yet._

**Where in Multi-Claude:** `package.json` build config and
`.github/workflows/mac.yml`; signing needs paid certificates (Windows code signing,
Apple Developer ID).

**Done when:** both installs work from a clean machine with no security warnings.

---

## Not doing (breaks the rules above)

| Feature | Seen in | Why not |
|---|---|---|
| Automatic switching at a limit, "next available", failover | claude-swap, cux, clauth, cc-switch | Gets around usage limits |
| Pooling accounts, carrying a conversation to another account, handing work to another account | cux, clauth | Same |
| Exporting or backing up sign-ins | claude-swap | Handles credentials |
| Session browser, syncing MCP servers or history between profiles | cc-switch, clauth, KeyboardCowboy | Reads or moves files inside a profile |
