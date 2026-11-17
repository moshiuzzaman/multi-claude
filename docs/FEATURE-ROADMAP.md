# Multi-Claude feature roadmap

What's built, what's next, and why. Every feature here comes from something seen in a
similar tool (researched November 2026), with links to that tool's code or docs.

## At a glance

| ✅ Done | 🔨 Building | 🟡 Analysed | ⬜ To do | Total |
|:---:|:---:|:---:|:---:|:---:|
| 7 | 1 | 1 | 11 | 20 |

**Status:** ⬜ To do → 🟡 Analysed (approach chosen and agreed) → 🔨 Building → ✅ Done
(every "Done when" check passed in the real app). "Still open" names what hasn't been checked yet.

**Priority:** **Core** = what a multi-account manager must get right (telling accounts apart,
reaching the right window, one account per profile, signing in, Claude Code per account).
**High** = most value after Core. **Mid** = useful, more work or a decision needed.
**Low** = polish and distribution.
**Effort:** **S** = a day or less · **M** = a few days · **L** = a week or more, or needs a prototype.

## Feature list

| # | Feature | Priority | Effort | Status | Still open |
|---|---|:---:|:---:|---|---|
| 1 | [Bring a running account to the front](#1-bring-a-running-account-to-the-front) | Core | S | ✅ Done | Mac untested |
| 2 | [Per-account colour](#2-per-account-colour) | Core | M | ✅ Done | Mac and installed build untested |
| 3 | [Own taskbar group per account (Windows)](#3-own-taskbar-group-per-account-windows) | Core | L | ✅ Done | Installed build and pinning untested |
| 4 | [Same-account and wrong-account warning](#4-same-account-and-wrong-account-warning) | Core | S | ✅ Done | Warning not yet seen on a real duplicate |
| 5 | [Folder-to-account link for VS Code](#5-folder-to-account-link-for-vs-code) | Core | M | 🟡 Analysed | Your decision: the planned approach doesn't work |
| 6 | [Guided Google sign-in (Mac)](#6-guided-google-sign-in-mac) | Core | M | ⬜ To do | — |
| 7 | [Tray / menu-bar icon](#7-tray--menu-bar-icon) | High | M | ✅ Done | Mac untested |
| 8 | [Limit alerts](#8-limit-alerts) | High | S | ✅ Done | Click-to-open and Mac untested |
| 9 | [Usage history chart](#9-usage-history-chart) | High | M | ✅ Done | 30-day view and Mac untested |
| 10 | [Claude status (outage) badge](#10-claude-status-outage-badge) | High | S | ⬜ To do | — |
| 11 | [Memory per account and idle sleep](#11-memory-per-account-and-idle-sleep) | Mid | M | ⬜ To do | — |
| 12 | [Pace, burn rate and offline cache](#12-pace-burn-rate-and-offline-cache) | Mid | S | ⬜ To do | — |
| 13 | [Start with the computer](#13-start-with-the-computer) | Mid | S | ⬜ To do | — |
| 14 | [Settings backup, export and import](#14-settings-backup-export-and-import) | Mid | S | ⬜ To do | — |
| 20 | [Copy a chat started in the wrong account](#20-copy-a-chat-started-in-the-wrong-account) | Mid | L | 🔨 Building | Code-tab copy not yet confirmed in Claude Desktop |
| 15 | [More languages (Bangla first)](#15-more-languages-bangla-first) | Low | M | ⬜ To do | — |
| 16 | [PIN lock](#16-pin-lock) | Low | S | ⬜ To do | — |
| 17 | [`multi-claude://` links and launcher support](#17-multi-claude-links-and-launcher-support) | Low | S | ⬜ To do | — |
| 18 | [Command-line status (`--status --json`)](#18-command-line-status---status---json) | Low | S | ⬜ To do | — |
| 19 | [winget, Homebrew and code signing](#19-winget-homebrew-and-code-signing) | Low | M | ⬜ To do | — |

Click a feature to jump to it. Each one shows **what** it is and **when it's done**; open
**Research, decisions and checks** under it for the full analysis.

## Rules every feature must keep

The full list, with the reason for each, is in
[CONTRIBUTING.md → Project rules](../CONTRIBUTING.md#project-rules). In short: no automatic
switching, no pooled or "next available" launching, no moving work to get around a limit,
no copying or exporting sign-ins, and no reading files inside a profile beyond what's listed
there. The one narrow exception is [feature 20](#20-copy-a-chat-started-in-the-wrong-account): copying, by hand, a chat
started in the wrong account. See also [Not doing](#not-doing-breaks-the-rules).

## How to build each feature

No feature starts with code.

1. **Read the spec** for the feature below.
2. **Study every reference.** Read its README or docs; for open-source projects, read the
   code that does this feature. Note how they do it, what the user sees, and the edge cases.
3. **Read their issues:** bugs, complaints and requests show what went wrong and what users want.
4. **Answer the feature's "Analyse first" questions.**
5. **Compare the ideas** in a short table: each reference's approach, pros, cons, and whether
   it fits the rules.
6. **Take the better idea**, or combine the best parts, and note what Multi-Claude can do better.
7. **Write the decision** into the feature's **Analysis notes** (approach, why, what was
   rejected), set it to 🟡 **Analysed**, and get it agreed.
8. **Build it**, with tests, and set it to 🔨 **Building**.
9. **Verify it in the real app** on the PC (and a Mac where it touches the Mac), not only in
   unit tests. Write what was checked into its **Verification** notes.
10. **Update the table:** ✅ **Done** only when every check passed; otherwise keep 🔨 Building
    and name what's still open.

> [!IMPORTANT]
> **Learn ideas, don't copy code.** Code from MIT-licensed projects may be reused only with its
> licence notice kept. Never copy from AGPL, unlicensed or closed-source projects (several
> references have no clear licence).

<details>
<summary>Template for a feature's Analysis notes</summary>

```
Analysed on: <date>
References read: <links, plus issues looked at>
| Reference | How they do it | Pros | Cons | Fits rules? |
|---|---|---|---|---|
Chosen approach: <what we will build>
Why it's better: <reason>
Rejected: <ideas not taken, and why>
```

</details>

---

## Core priority

### 1. Bring a running account to the front

> **Status:** ✅ Done · Mac untested · **Priority:** Core · **Effort:** S

**What:** When an account is already running, the Launch button becomes "Show" and
brings its window to the front instead of doing nothing.

**Done when:** on this PC, Show brings forward each account's window from hidden in
the tray, minimised, and behind other windows, never another account's; the default
account works through the Store app; no second Claude process is ever started.
Real-Mac check stays open until someone tests it on a Mac.

<details>
<summary><strong>Research, decisions and checks</strong></summary>
<br>

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

</details>

[↑ Feature list](#feature-list)

---

### 2. Per-account colour

> **Status:** ✅ Done · Mac and installed build untested · **Priority:** Core · **Effort:** M

**What:** Pick a colour per account. Shown on its card, row and page, and as a coloured
badge (first letter) on its desktop shortcut icon, so shortcuts are told apart.

**Done when:** the colour shows everywhere the account appears; new shortcuts get a
coloured icon; changing the colour updates an existing shortcut; old stores load and
get a colour; an older version can still read the store.

<details>
<summary><strong>Research, decisions and checks</strong></summary>
<br>

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

**Analysis notes**

```
Analysed on: 2026-11-13
References read: KeyboardCowboy/multi-claude — renderer/app.js (SWATCHES, renderSwatches,
  openEdit), renderer/styles.css (.plate, .badge, .swatch), main.js (COLOR_RE, profile
  validation); issue #5 "Tell instances apart in the Dock and app switcher" (open).
  Licence: none stated, so ideas only, no code.
  Claude Sessions Pro: closed source; its listing only (coloured letter on each Dock icon).
  Ferdium: per-service icons (its own service logos, no colour picker), nothing to borrow.
```

Answers to the questions:
- **KeyboardCowboy:** 8 named swatches (Indigo, Teal, Berry, Violet, Green, Rust, Gold,
  Graphite). The colour is chosen in the add/edit dialog as accessible radio buttons; a
  new profile gets the first colour no other profile uses. Saved as a hex string and
  checked with `/^#[0-9a-fA-F]{6}$/`, falling back to the first swatch. Shown as a CSS
  variable on the tile: an outline round the icon and a small coloured badge. Colours
  exist only inside the app (its issue #5 is still open about the Dock).
- **Claude Sessions Pro:** a coloured letter on each account's Dock icon, so accounts are
  told apart outside the app. It can do this because each account is a separate app copy.
- **Making icons without a heavy dependency:** both formats can hold a PNG directly. An
  `.ico` is a 6-byte header, one 16-byte entry and the PNG (Windows Vista and later);
  an `.icns` is an 8-byte header and one `ic08` (256×256 PNG) entry. The PNG is drawn on
  a `<canvas>` in the renderer, which can already draw text; the main process checks it
  and wraps it. No new package.

| Reference | How they do it | Pros | Cons | Fits rules? |
|---|---|---|---|---|
| KeyboardCowboy | 8 swatches, auto-pick first unused, outline + badge on tile | Simple, accessible, never two of the same by default | Only inside the app | ✅ |
| Claude Sessions Pro | Coloured letter on a separate app's Dock icon | Visible outside the app | Needs a copy of Claude per account (re-signing, breaks on updates) | ⚠️ copy approach no; letter icon yes |
| Ferdium | Service logo icons | Recognisable | No per-account colour | ✅ |

**Chosen approach**
- **Palette:** 8 named colours tuned for the dark glass UI (Terracotta, Blue, Teal,
  Violet, Rose, Green, Amber, Slate). A free hex picker is not offered: a fixed palette
  stays readable and distinct.
- **Auto colour:** a new account gets the first colour no other account uses (as
  KeyboardCowboy); existing accounts get one the first time this version starts.
- **Where it shows:** a round letter avatar in the account's colour on its card, its row
  and its page header, with the running dot on the avatar's corner. Change it on the
  account page under **Colour**.
- **Shortcut icon:** a rounded tile in the account's colour with its first letter
  (Claude Sessions Pro's idea, without copying Claude), drawn on a canvas and saved as
  `.ico` / `.icns` in Multi-Claude's own data folder. Changing the colour rewrites an
  existing desktop shortcut so its icon follows.
- **Store format:** `color` is an optional field, so the schema version stays at 1.
  Bumping it (as first planned) would make an older Multi-Claude set the account list
  aside as unreadable after a downgrade.

**Why it's better:** it combines KeyboardCowboy's simple in-app colours with Claude
Sessions Pro's letter icons outside the app, without copying or re-signing Claude, and
with no new dependency.

**Rejected:** a free colour picker (clashing, unreadable colours); colour only as an
outline (too subtle on the dark UI); copying Claude per account for its own Dock icon.

**Where in Multi-Claude**
- `src/main/colors.js` (new): palette, `isPaletteColor`, `pickColor(accounts)`.
- `src/main/icons.js` (new): `readPngSize`, `pngToIco`, `pngToIcns`.
- `src/main/store.js`: accept an optional `color` (palette hex) on accounts.
- `src/main/service.js`: colour on init/add, `setColor({ id, color, iconPng })`,
  `createShortcut({ id, iconPng })` writing the icon file; `src/main/shortcuts.js` and
  `createMacShortcut` take the icon file.
- Renderer: `lib/colors.js` (palette, letter, text colour), `lib/accountIcon.js` (canvas
  drawing), an `Avatar` component, the Colour picker on the account page.

**Verification** (2026-11-13, branch `feat/account-colour`, test copy of Multi-Claude on
this PC, buttons clicked in the app)

| Check | Result |
|---|---|
| Unit tests (17 new: palette, picking, icon formats, store, service, shortcut icon) | ✅ 355 pass, 1 skipped |
| Existing accounts get a colour on first start | ✅ Default Terracotta, Anika Blue, m Teal |
| Colour shows on cards, rows and the account page, with the running dot on the avatar | ✅ Dashboard, Accounts and m's page |
| Picker changes the colour and saves it | ✅ m → Violet → Blue → Teal, saved in `accounts.json` |
| Shortcut gets a coloured letter icon | ✅ `Claude - m.lnk` points at `icons\<id>-….ico` (Teal "M" tile) |
| Changing the colour updates an existing shortcut, old icon removed | ✅ new `.ico` each time, one file left, toast "colour and desktop shortcut updated" |
| Released 2.6.0 can still read the saved account list | ✅ 2.6.0's `validate()` accepts it; schema version still 1 |
| New account gets an unused colour | ✅ unit test only (not added in the app, to avoid creating a profile folder) |
| Swatch under the mouse | ❌ → ✅ turned black (global button hover style); fixed and re-checked |
| Multi-Claude's own taskbar button keeps its real logo | ❌ → ✅ found by the user: with an account shortcut on the desktop, Windows showed that shortcut's coloured "M" on Multi-Claude's taskbar button (no app id set, so Windows borrowed the icon of a shortcut to the same .exe). Fixed: Multi-Claude sets its app id (`dev.multiclaude.app`, the build's appId) and each account shortcut gets its own (`dev.multiclaude.app.shortcut.<id>`). Re-checked with m's shortcut on the desktop: the taskbar shows the Multi-Claude logo |
| Same check in the installed build (installer's Start menu shortcut and app id) | ⬜ not yet: needs an installer build |
| Mac `.icns` shortcut icon | ⬜ not tested (no Mac available) |

One colour change during testing (m set to Terracotta at 23:51:56) didn't come from a
scripted click and didn't happen again in three repeats of the same steps; most likely
a click on the visible test window.

</details>

[↑ Feature list](#feature-list)

---

### 3. Own taskbar group per account (Windows)

> **Status:** ✅ Done · Installed build and pinning untested · **Priority:** Core · **Effort:** L

**What:** Today every account's window groups under one Claude taskbar icon. Give each
account's window its own taskbar group, name and icon.

**Must keep:** Multi-Claude's own taskbar button always shows its real app icon (the
Multi-Claude logo). This feature changes only the Claude windows of each account, never
Multi-Claude's own window or its installed app icon.

**Done when:** two running added accounts show as two taskbar buttons with their own
coloured icons and names, next to Claude's own button for the default account; they
survive tray, Show and minimise; Multi-Claude's own button keeps its logo; turning the
setting off puts them back in Claude's group.

<details>
<summary><strong>Research, decisions and checks</strong></summary>
<br>

**Open question for the analysis:** what each account's Claude window shows in the
taskbar: Claude's icon with a small badge in the account's colour, or the account's
coloured letter tile (as on its desktop shortcut).

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

**Analysis notes**

```
Analysed on: 2026-11-14
References read: tksh164/aumid-stopgap-tools (MIT) — src/runwaumid/main.cpp, docs/usage-v0.2.0.md,
  issues #20 (icon only changes when the shortcut is pinned), #22 (timeout for slow windows),
  #6 (skip when the window already has the id). Microsoft docs: AppUserModelIDs,
  SHGetPropertyStoreForWindow, System.AppUserModel.Relaunch* properties.
  Parall / Claude Sessions Pro: closed source; they make a separate app copy per account.
Prototype on this PC: account "m" (Claude Store build), scratch PowerShell + C#, then undone.
```

Answers to the questions:
- **Parall and Claude Sessions Pro** give each account its own *app* (a copy with its
  own bundle id), which is why the Dock tells them apart. That needs copying and
  re-signing Claude.app and redoing it on every Claude update, so it stays rejected
  (Mac). On Windows no copy is needed: the taskbar groups by a per-window id.
- **Open-source tools:** aumid-stopgap-tools sets `System.AppUserModel.ID` on another
  app's window from outside (built for Electron apps like Obsidian and VS Code). Its
  issues show the icon only changes with a matching pinned shortcut, which is why the
  prototype also tried the window's relaunch properties.
- **Prototype results** on m's window, step by step:

| Step | Result |
|---|---|
| Set the window's id to m's shortcut id (`dev.multiclaude.app.shortcut.<id>`) | ✅ m left Claude's group and got its own taskbar button (Claude's icon) |
| Set the window icon with an icon handle (`WM_SETICON`) | ⚠️ showed m's coloured tile, but reverted to Claude's icon after close-to-tray + Show (the handle dies with the process that made it) |
| Set relaunch icon (file path), name and command, then the id | ✅ m's coloured tile on its own button, no handle needed |
| Close to tray → Show, minimise → restore | ✅ own button and coloured tile kept every time |
| Multi-Claude's own taskbar button | ✅ still the real Multi-Claude logo throughout |
| Undo (clear all four properties, hide + show) | ✅ m back in Claude's group, as before |

- **Does Claude reset it?** Not in any of these steps. It lives on the window, so a new
  window (Claude restarted, or a second Claude window) starts without it and needs it
  applied again.

| Approach | How | Pros | Cons | Fits rules? |
|---|---|---|---|---|
| A. Window id + relaunch icon/name/command (file paths) | Shell property store on the account's Claude windows | Own button, own coloured icon and name; survives tray/minimise; pinning it pins a Multi-Claude `--launch` shortcut | New windows need it applied again; Claude's jump list isn't on that button | ⚠️ needs a decision (see below) |
| B. Window id + `WM_SETICON` | Icon handle | Own button | Icon lost after tray/Show unless Multi-Claude keeps native icon handles alive | ⚠️ |
| C. Separate app copy per account (Parall, Claude Sessions Pro) | Copy + re-sign Claude | Native everywhere | Breaks on updates, weakens Claude's signature | ❌ |
| D. Only pinned shortcuts with the id (aumid-stopgap-tools) | User pins each account shortcut | No window changes | Only works once pinned; still needs the window id | ⚠️ |

**Answer to the open question:** the account's letter icon (from feature 2), since the
taskbar button and its pinned shortcut then look the same. **Changed 2026-11-14 at the
user's request:** the icon is drawn on Multi-Claude's own dark rounded tile (the
background of `build/icon`), with the account's letter in the account's colour, so every
account button still reads as Multi-Claude. The Multi-Claude badge was dropped; the tile
is the brand. The desktop shortcut uses the same icon.

**Changed again (user's choice from three previews):** Multi-Claude's real Windows icon
(the M logo from `build/icon.ico`, copied to `src/renderer/assets/app-icon-*.png`) with a
round badge at the bottom right in the account's own colour, glossy like the in-app
avatar, carrying its letter. The badge is bigger in the small sizes (54% of the icon at
256 px, 66% at 32 px and below) so the letter stays readable on the taskbar.
At the user's request the in-app avatar (cards, rows, account page) uses the same design:
the Multi-Claude logo with the colour badge at the bottom right, and the running dot on
the logo's top right. Avatars grew a little (cards 46 px, rows 42 px, page 58 px) so the
logo stays readable. The small-size
badge problem is fixed as part of this: the `.ico` gets 16/24/32/48 px images with the
letter only, and the Multi-Claude badge stays on the large 256 px image.

**Chosen approach:** A, for added accounts only (the default account stays in Claude's
own group), Windows only. Multi-Claude applies the four properties to each top-level
Claude window of the account's process: after Launch and Show, and on each running scan
for windows that don't have them yet. The window's id is the same as the account's
shortcut id, so a pinned account shortcut and its running window share one button.

**Why it's better:** the only tested way to get a separate, coloured, named taskbar
button per account that survives the tray and minimise, with no copy of Claude and no
native code to keep alive.

**Rejected:** B (icon lost after tray/Show), C (copying Claude), D alone (needs pinning
and still the window id).

**Decision first (yours):** this means Multi-Claude sets taskbar properties on Claude's
windows from outside. It doesn't modify, patch or repack Claude or read anything from
it, but the README and feature 1's notes say no window is touched from outside, so
they'd be updated. Proposed safeguard: a setting **Separate taskbar button per account**
(on by default) to turn it off.

**Where in Multi-Claude**
- `src/main/taskbar.js` (new, Windows): the PowerShell + C# that applies or clears the
  four properties on a process's top-level windows; pure helpers for the values.
- `src/main/service.js`: apply after `launch` / `show` and from `scan` for running added
  accounts; needs each account's icon file to exist (drawn by the renderer on start).
- `src/renderer/lib/accountIcon.js` + `src/main/icons.js`: multi-size `.ico`.
- Setting in the UI; README "How it works" updated.

**Verification** (2026-11-14, branch `feat/taskbar-groups`, test copy of Multi-Claude on
this PC, buttons clicked in the app, taskbar captured after each step)

| Check | Result |
|---|---|
| Unit tests (19 new: taskbar values and script, multi-size icons, service apply/scan/setting) | ✅ 376 pass, 1 skipped |
| Module's PowerShell on a real window: apply, apply again, clear | ✅ ~1 s each; a second apply changes nothing |
| On start, every account's icon is saved and a running added account gets its button | ✅ m got its own button with its teal M |
| Launch a second added account from the app | ✅ Anika got its own blue A button within the retries |
| Default account | ✅ stays on Claude's own button |
| Multi-Claude's own button | ✅ real logo in every capture |
| Close to tray → Show in the app | ✅ m keeps its own button and icon |
| Setting off → windows hidden and shown again | ✅ both back on Claude's button; Show doesn't re-apply |
| Setting on | ✅ both get their own buttons again at once; `taskbarGroups` saved |
| Small icon without the badge dot | ❌ → ✅ the taskbar asked for a size larger than 48 px and shrank the 256 px badge image; added 64/96/128 px letter-only images |
| A changed icon on a running button | ⚠️ shows after the window is next shown (the taskbar keeps the button's picture until then) |
| Icon on Multi-Claude's dark tile (user's request) | ❌ user: didn't look like their icon. Replaced, see next row |
| Real Multi-Claude logo + letter badge in the account's colour, bottom right (user's choice A) | ✅ A, M and D rendered at 256/48/32/24 px; m's taskbar button shows the logo with its teal M badge next to Multi-Claude's own button |
| Same design on cards, rows, account page and desktop shortcut (user's request) | ✅ Dashboard, Accounts and m's page show the logo with the colour badge; a new `Claude - m` shortcut loads the same icon at 48 and 32 px (shortcut removed after) |
| Pinning an account's button | ⬜ not tested (would change your taskbar pins) |
| Installed build | ⬜ not yet: needs an installer build |
| Mac | ➖ not applicable (Windows only) |

Anika was started only for this test and quit again afterwards.

**Follow-up (2026-11-14): tray icons.** Your request after using 2.8.0: Claude's own
tray icons all looked the same.
- Each Claude process has one tray icon (id 3) on its `Electron_NotifyIconHostWindow`.
  `Shell_NotifyIcon(NIM_MODIFY)` from outside changes its icon (tested on your PC).
  **Icon only:** setting the hover text too replaced Claude's own usage text (you spotted
  it), so only `NIF_ICON` is sent. Claude updating its text sends only `NIF_TIP`, so it
  doesn't undo the icon.
- Applied with the taskbar run: on launch, on Show, when a running account is found, and
  on every 5-minute check, because Claude or an Explorer restart can reset it.
- The default account gets a tray icon too; its taskbar button is unchanged.
- Turning the setting off puts Claude's own icon back (taken from its exe).
- The default Claude is found as the `claude.exe` that has windows or a tray icon, because
  Claude Code's command-line `claude.exe` has the same name.

| Check | Result |
|---|---|
| Unit tests: tray item, script parts, default account, refresh on the background check | ✅ 420 pass |
| Real run on your PC: Default and Anika tray icons changed (tray 1 each) | ✅ (please confirm by eye) |

</details>

[↑ Feature list](#feature-list)

---

### 4. Same-account and wrong-account warning

> **Status:** ✅ Done · Warning not yet seen on a real duplicate · **Priority:** Core · **Effort:** S

**What:** Warn when two profiles are signed in to the same Claude account ("Work and
Work 2 are the same account"), and when a profile is now signed in to a different
account than the one it was set up with ("Work is signed in to another account").
Each profile must stay one account, or the whole side-by-side setup breaks.

**Done when:** a warning pill shows on both accounts when they match, and on an account
whose sign-in changed, with a choice to accept the new account.

<details>
<summary><strong>Research, decisions and checks</strong></summary>
<br>

**References**
- KeyboardCowboy/multi-claude — account warnings and duplicate-account protection:
  https://github.com/KeyboardCowboy/multi-claude

**Analyse first**
- Exactly which value does KeyboardCowboy compare, and how does it map an account ID
  to an email?
- What choices does it offer on a mismatch (switch back, keep, remove duplicate)?
- Is there a way to detect duplicates without reading the ID's value?

**Analysis notes (2026-11-14):**
- *KeyboardCowboy* (`lib/accounts.js`) reads `lastKnownAccountUuid` and checks that it's
  shaped like a UUID. There is no email in the file, so it asks the user for one as a
  label.
  - `bindNewAccounts`: the first account seen is remembered for each profile, unless
    another profile already uses it.
  - `accountStates`: `none` / `ok` / `mismatch`, plus `sharedWith`.
  - On a mismatch it offers switch back, keep, or remove the duplicate, and it refuses to
    open one account in two profiles.
- *Take:* the bind-first rule, the states and the "keep the new account" choice.
- *Do differently:*
  - Store a salted SHA-256 fingerprint (24 hex characters), never the id, and don't ask for
    emails.
  - Warn, don't block launching. Blocking would be a behaviour change the README doesn't
    promise.
- *Without reading the value?* No. Setting names can't tell two accounts apart.
- *Decision:* you OK'd reading the id (2026-11-14) after being told it is an id, not a
  token.

**Built (2026-11-14):**
- `readDesktopAccountKey()` in `desktop-signin.js`.
- `src/main/account-check.js` holds the rules.
- `service.list()` adds `accountCheck`; the fingerprint is kept out of what the screen gets.
- `acceptAccount()` is the "keep this account" action.
- The pill (card, row, page) and the explanation banner come from `AccountCheck.jsx`.
- README updated: "One account per profile", and the sign-in note on what is read.

**Verification**

| Check | Result |
|---|---|
| Unit tests: fingerprint (never the id, case-insensitive, odd values), bind-first, shared, mismatch, keep, not shown to the screen | ✅ 417 pass |
| Your 3 accounts: all get a fingerprint, no false warning | ✅ |
| A real duplicate or changed account showing the warning | ⏳ only seen if it happens |

**Where in Multi-Claude:** `src/main/desktop-signin.js` reads only setting *names* from
`config.json` today. This needs the *value* of `lastKnownAccountUuid` (an account ID,
not a token). Compare a hash of it across accounts in `service.list()`; never store or
show the raw ID. Save the hash when the account is first signed in; a different hash
later means it changed accounts.

**Decision first:** this widens what Multi-Claude reads from a profile. Update the
README's "How it works" if you build it.

</details>

[↑ Feature list](#feature-list)

---

### 5. Folder-to-account link for VS Code

> **Status:** 🟡 Analysed · Your decision: the planned approach doesn't work · **Priority:** Core · **Effort:** M

**What:** "Use this account for this project": writes the setting into that project's
`.vscode/settings.json` instead of the global one, so different repositories use
different accounts you own.

**Done when (E):** linking a folder shows it under the account; **Open project** opens
it in VS Code with that account's Claude Code; a subfolder of a linked folder opens with
the same account; unlinking removes it; deleting the account removes its links.

<details>
<summary><strong>Research, decisions and checks</strong></summary>
<br>

**References**
- claude-swap — `map` / `unmap` folders to accounts: https://github.com/realiti4/claude-swap
- cux — projects bound to accounts: https://github.com/inulute/cux

**Analyse first**
- How do claude-swap's `map` (subfolders inherit) and cux's projects decide which
  account a folder uses?
- Which VS Code setting wins when both user and workspace settings set the account?
- Should the workspace file be committed by the user's team, or kept out of git?

**Analysis notes**

```
Analysed on: 2026-11-14
References read: claude-swap (MIT) README "map / unmap"; cux (GPL-3.0, ideas only) README
  "Projects". The installed Claude Code extension's package.json
  (anthropic.claude-code 2.1.323). VS Code docs: command line (environment of new
  instances), setting scopes.
```

Answers to the questions:
- **claude-swap** maps a folder to an account (`cswap map 2 ~/work/client-app`);
  subfolders inherit the nearest mapped ancestor; mappings are per machine, not
  exported, and removed with their account. It applies only when Claude Code is started
  through `cswap run`, as an environment variable for that process.
- **cux** binds a folder to a set of accounts (a pool); the longest path-boundary-aware
  match wins, so nested projects work; a choice the user makes explicitly overrides the
  project. The pool part breaks this project's rules; the matching rule is the useful idea.
- **Which setting wins?** Neither: the Claude Code extension declares
  `claudeCode.environmentVariables` with **scope `machine`** (checked in the installed
  extension, 2.1.323). VS Code reads machine-scoped settings only from **user** settings
  and ignores them in a project's `.vscode/settings.json`. So the planned approach
  (write the account into the project's workspace settings) **does not work**, and the
  git question doesn't arise.
- **Per-window environment instead?** VS Code's docs: "If this is not the first VS Code
  instance, environment variables are inherited from the already running VS Code
  instance." Opening a project in a new window with the account's `CLAUDE_CONFIG_DIR`
  therefore doesn't work while VS Code is open either. The docs' only isolation is a
  separate `--user-data-dir` per instance, which also means separate extensions and
  settings.

| Approach | How | Pros | Cons | Fits rules? |
|---|---|---|---|---|
| A. Project's `.vscode/settings.json` (the plan) | Workspace setting | Per project, travels with the folder | **Ignored by VS Code** (machine scope) | — |
| B. New window with the account's environment | `code -n <folder>` with `CLAUDE_CONFIG_DIR` | No settings edit | **Inherits the running VS Code's environment** (VS Code docs) | — |
| C. Separate VS Code per account | `--user-data-dir` per account | Truly separate | A second VS Code with no extensions, settings or sign-ins; heavy | ✅ |
| D. VS Code profile per account | Profiles | VS Code remembers the profile per folder | Profiles start empty (Claude Code not installed, settings not copied); Multi-Claude would have to edit VS Code's internal profile list | ⚠️ fragile |
| E. Project list on the account page | Link folders to an account (nearest ancestor wins, as claude-swap); **Open project** switches VS Code to that account (the existing Use in VS Code) and opens the folder | Works today with one click per project; no new VS Code mechanism | Still one account at a time: opening a project switches every open VS Code window | ✅ |

**Deeper look at the two references' code (2026-11-14, at the user's request)**

| | claude-swap (MIT) | cux (GPL-3.0, ideas only) |
|---|---|---|
| Where the link is stored | `mappings.py`: `mappings.json`, key = resolved path + `os.path.normcase` (case-folded on Windows), value = account identity (email + organization id, not the slot number, since slots get reused) | `store/projects.go`: named projects `{ name, dir, slots[] }` in its state file; the folder is stored cleaned and absolute |
| How a folder finds its account | `resolve()`: the longest mapped folder that equals the folder or is one of its parents | `ProjectFor()`: longest match, path-boundary aware (`/a/b` claims `/a/b/c`, never `/a/bc`) |
| How the account is applied | Only through `cswap run` in a terminal: starts `claude` with `CLAUDE_CONFIG_DIR` = that account's own profile folder (`session.py`) | Only inside its own wrapper around `claude` in a terminal; the project limits which accounts the wrapper may switch to |
| VS Code | Not per folder. The extension follows the default login, which `cswap switch` changes by **swapping the stored sign-in** in `~/.claude` for everything at once | Not supported; it also switches by writing sign-ins (`switcher.go`) |
| Cleanup | Links are removed with their account | Removing an account removes it from every project |
| Explicit choice | — | A user naming an account always overrides the project |

Neither does per-project accounts in VS Code. Their terminal-only approach is the same as
Multi-Claude's existing **Terminal** button, and their way of switching VS Code (swapping
sign-ins) breaks this project's rules.

**What VS Code itself allows (read from the installed VS Code 1.146 and extension 2.1.323)**
- `claudeCode.environmentVariables`: scope `machine`, ignored in a project (as above).
- `claudeCode.useTerminal` ("Launch Claude in the terminal instead of the native UI"):
  scope `window`, **allowed in a project's settings**.
- `terminal.integrated.env.windows`: no scope given, so `window`, **allowed in a
  project's settings**; marked `restricted`, so it only applies once the folder is trusted.

That opens one more approach:

| Approach | How | Pros | Cons | Fits rules? |
|---|---|---|---|---|
| F. Project's terminal carries the account | The project's `.vscode/settings.json` gets `terminal.integrated.env.windows.CLAUDE_CONFIG_DIR` = the account's folder and `claudeCode.useTerminal: true` | A real per-project account inside VS Code; each window keeps its own account; travels with the folder | Claude Code runs in the terminal panel rather than the sidebar UI for that project; only in trusted folders; the machine-wide **Use in VS Code** setting would override it, so the two can't be on at once; **untested** | ✅ one account per project, never rotated |
| T. Terminal opens in the project | The existing **Terminal** button can open in a linked project's folder | Works today; the same as `cswap run` + `map` | Outside VS Code | ✅ |

**Updated recommendation:** first prototype F on one project (does the extension's
terminal pick up the project's environment, and is the machine setting really the only
thing that overrides it?). If it works, F is the best answer: true per-project accounts
in VS Code. If it doesn't, build E + T. Matching follows both references: the deepest
linked folder wins, path-boundary aware, case-insensitive on Windows; links go with
their account.

**Prototype F (2026-11-14): doesn't work.** Two test projects (linked to Anika and m)
with the two settings, opened in the user's own VS Code, trusted, Claude Code opened in
each; the environment of each Claude Code process was read directly:

| Test | proj-anika | proj-m | Meaning |
|---|---|---|---|
| Global **Use in VS Code** block on | Default's folder | Default's folder | The machine setting is passed in by the extension and wins |
| Global block removed (backed up, restored after) | not set | not set | The project's terminal setting never reaches Claude Code |

The process tree explains it: the extension starts `claude.exe` (its bundled
`resources/native-binary/claude.exe`, with `--output-format stream-json`) **directly
from VS Code's extension host**, not through a VS Code terminal, so
`terminal.integrated.env.*` doesn't apply. The user's VS Code settings were restored
byte-for-byte.

**New option W, found in the extension's own code (`extension.js`, 2.1.323):**
`claudeCode.claudeProcessWrapper` (machine scope, so set once in user settings) names a
program the extension runs **instead of** `claude.exe`, as
`<wrapper> <path to claude.exe> <claude's arguments>`, with the same environment it
would give Claude (`process.env` + `claudeCode.environmentVariables`).

| Approach | How | Pros | Cons | Fits rules? |
|---|---|---|---|---|
| W. Multi-Claude wrapper picks the account by folder | One user setting points `claudeProcessWrapper` at a tiny Multi-Claude wrapper. It looks up the project folder in Multi-Claude's links (deepest linked folder wins, as claude-swap/cux), sets `CLAUDE_CONFIG_DIR` to that account's folder, then starts the real `claude.exe` with the same arguments and passes input/output through. Unlinked folders keep today's account | **Same VS Code, same extensions, same settings; only the Claude account changes per project**, several windows at once; no project files written; nothing to trust | Known extension bug [anthropics/claude-code#98209](https://github.com/anthropics/claude-code/issues/98209): the sidebar's past-sessions list keeps reading `~/.claude` (sessions aren't lost, just not listed); with a wrapper set the extension doesn't track the process itself (`onProcessSpawned` is skipped) and starts sessions in the default permission mode; needs a small .exe (a `.cmd` can't be spawned directly); **untested** | ✅ one account per project, only an environment variable, never a sign-in |

The issue's own reporter uses exactly this (a wrapper that sets `CLAUDE_CONFIG_DIR`) to
run two accounts in VS Code, which confirms the account part works.

**Updated recommendation:** prototype W on the same two test projects: a throwaway
wrapper, set in the user's settings for the test only, then checked by reading each
Claude Code process's `CLAUDE_CONFIG_DIR` again.

**Decision (yours):** prototype W, build E + T, or skip feature 5 for now.

</details>

[↑ Feature list](#feature-list)

---

### 6. Guided Google sign-in (Mac)

> **Status:** ⬜ To do · **Priority:** Core · **Effort:** M

**What:** On a Mac, if only one Claude window is open, the `claude://` sign-in link
goes to it. So: close the other Claude windows (with permission), open only this
account, sign in with Google, then offer to reopen what was closed.
This does not help on Windows, where the Store version always sends the link to the
default Claude.

**Done when:** tested on a real Mac — a new account signs in with Google and stays
signed in on the next launch.

<details>
<summary><strong>Research, decisions and checks</strong></summary>
<br>

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

</details>

[↑ Feature list](#feature-list)

---

## High priority

### 7. Tray / menu-bar icon

> **Status:** ✅ Done · Mac untested · **Priority:** High · **Effort:** M

**What:** A tray icon (Windows) or menu-bar item (Mac). Its menu lists each account
with its Session and Weekly figures, a running dot, and Launch / Close / Bring to
front. Plus Open Multi-Claude, Check for updates, Quit. Closing the main window
keeps the app in the tray (optional setting).

**Done when:** the tray menu shows every account with its figures and running state;
Launch/Close work from it; Quit really quits; works on Windows and Mac.

<details>
<summary><strong>Research, decisions and checks</strong></summary>
<br>

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

**Analysis notes (2026-11-14):**
- *cc-switch* (`src-tauri/src/tray.rs`):
  - Three layers: read a snapshot, `build_menu_model` turns it into plain data (unit
    tested), then attach it to the native menu. Take this.
  - On Windows, left-click opens the main window and right-click shows the menu. On a
    Mac, a click shows the menu. Take this.
  - Usage is refreshed when the mouse hovers the icon. Take this (as a running-state scan).
  - `minimize_to_tray_on_close` is on by default. Take this.
- *claude-swap:* a Mac menu bar app with every account's 5h/7d usage, and "Quit" in the
  menu really stops it. Take the clear Quit.
- *CodexBar:* a two-bar meter drawn as the icon itself. **Not now:** a 16 px Windows icon
  can't show two readable bars for several accounts. The tooltip carries the figures
  instead.
- *Multi-Claude specifics:*
  - The renderer stops scanning while hidden, so the 5-minute background check now scans
    which accounts are running (this also keeps the activity history right).
  - Close from the tray asks first, with the same words as the window's own Close.

**Built (2026-11-14):**
- `src/main/tray.js` holds the model, tooltip and template.
- `main.js`:
  - creates the tray (`src/main/assets/tray.ico` / `tray.png`, `tray@2x.png`);
  - close keeps it in the tray (setting, on by default) and shows a one-time "still
    running" notification;
  - any quit really quits;
  - on a Mac, `activate` shows the window again.
- `service`: `trayData()`, `setCloseToTray()`, `trayNoticeOnce()`; `backgroundTick`
  scans.
- Setting on the Accounts page.

**Verification**

| Check | Result |
|---|---|
| Unit tests: menu model, figures, tooltip length, actions, settings, snapshot, background scan | ✅ 412 pass |
| Tray icon, right-click menu, close-to-tray, Quit on your PC | ✅ (checked by you) |
| Mac menu bar | ⏳ untested |

**Where in Multi-Claude (as planned):** new `src/main/tray.js`, created from `src/main/main.js`;
menu built from `service.list()` and `service.limits()`; rebuild the menu when
either changes.

</details>

[↑ Feature list](#feature-list)

---

### 8. Limit alerts

> **Status:** ✅ Done · Click-to-open and Mac untested · **Priority:** High · **Effort:** S

**What:** A system notification when an account crosses a threshold, for example
"Work: Weekly at 80%". Thresholds set per account (default 80% and 95%, Session and
Weekly). Each threshold fires once per window, not on every refresh. Information only:
it never switches or launches anything.

**Done when:** crossing a threshold shows one notification; it doesn't repeat until
usage drops below and crosses again; unit tests cover the crossing logic.

<details>
<summary><strong>Research, decisions and checks</strong></summary>
<br>

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

**Analysis notes (2026-11-14):**
- *Claude-Code-Usage-Monitor:* no notifications at all. It only colours its bars and
  gives exit codes (10 near limit, 11 limit hit) for scripts. Nothing to take.
- *CodexBar* (`UsageStore+QuotaWarnings.swift`, `SessionQuotaNotifications.swift`) is
  the model to follow:
  - State is kept **per account and per window** (Session, Weekly): last figure plus the
    set of thresholds already fired.
  - A threshold fires only on an **upward crossing** (last figure below, new figure at
    or above).
  - If one refresh jumps past several thresholds, it shows **one** notification for the
    highest and marks the lower ones as fired too.
  - A fired threshold is cleared when usage drops back below it (after a reset), so it
    can fire again next window.
  - Separate optional alerts for "limit reached" and "limit reset".
- *Take:* the crossing, one-for-the-highest and clear-on-drop rules.
- *Do differently:*
  - Save the fired state to disk, so restarting Multi-Claude doesn't repeat alerts.
  - Ignore stale figures. The Claude window's own record can be hours old: a Session
    figure older than 5 hours has already reset.
  - Multi-Claude quits when its window closes, so alerts only work while it's open
    (minimised is fine). Feature 7 (tray) lets it keep running.
- *Today's refresh:* the screen refreshes limits every 20 s, but only while the window
  has focus. Alerts need their own check in the main process, every 5 minutes.

**Where in Multi-Claude:** new `src/main/alerts.js` (pure: previous figures + new
figures + thresholds → alerts to show), called after each limits refresh; thresholds
saved per account in `src/main/store.js`; settings on the account page
(`src/renderer/views/AccountDetail.jsx`).

**Built (2026-11-14):**
- `src/main/alerts.js` holds the rules.
- `service.limits()` checks every real fetch.
- `alertTick()` runs every 5 minutes from `main.js`, skipped when alerts are off or the
  screen fetched limits in the last 4 minutes.
- What was shown is kept in `alert-state.json`.
- Settings:
  - On the Accounts page: on/off, levels 50–95% (default 80 and 95; 100% always on), the
    reset alert (off by default), and Send a test alert.
  - On each account's page: Mute limit alerts.
- Clicking an alert opens the account's page.

**Verification**

| Check | Result |
|---|---|
| Unit tests: crossing, one alert for the highest, re-arm on drop, stale figure ignored, reset alert, mute, off, restart (`test/alerts.test.js`, service tests) | ✅ 395 pass |
| Test copy on Windows: Anika at Weekly 100% gave exactly one "Anika: Weekly limit reached · Resets in 5h 19m" | ✅ (read back from Windows' notification list) |
| Test alert reaches Windows, grouped under Multi-Claude with its logo | ✅ (Do not disturb was on, so it went straight to the notification centre) |
| Settings and mute look right on the Accounts and account pages | ✅ |
| Clicking an alert opens that account's page | ⏳ needs you to click one |
| Installed build shows the pop-up | ⏳ after the next release |
| Mac | ⏳ untested |

</details>

[↑ Feature list](#feature-list)

---

### 9. Usage history chart

> **Status:** ✅ Done · 30-day view and Mac untested · **Priority:** High · **Effort:** M

**What:** On each account page, a line chart of Session and Weekly usage over the
last 7 / 30 days, from every sample in Claude's own `plan-usage-history.json`. Today
only the newest sample is used. No new data and no extra sign-in needed.

**Done when:** the chart shows real samples for 7 and 30 days; gaps where Claude wasn't
running show as gaps, not zero; empty state for a new account; unit tests for the
history reader.

<details>
<summary><strong>Research, decisions and checks</strong></summary>
<br>

**Analysis notes (2026-11-14):**
- *What Claude records is sparse.* It writes a sample only while its window runs, a few
  times a day. On this PC:
  - Default: 36 samples over 26 days, median gap 11 hours.
  - Anika: 20 samples over 11 days.
  - m: 4 samples.
- *So a Session line is misleading:* the window is 5 hours, and readings are hours apart.
  Show Session as **one bar per day, the highest reading that day**, with 100% marked
  red. Weekly works as a line of readings; its resets show as drops.
- *CodexBar / cc-switch:* charts grouped by day, with hover details. Days with no data are
  shown as missing, not as zero. Take that.
- *Fill the gaps:* Multi-Claude can keep its own readings. The alert check already reads
  each account every 5 minutes while it's open. Store percentages only, in
  `usage-history.jsonl`, for 90 days, and merge them with Claude's samples.
- *Where:* a "Usage history" panel on each account's page, under Usage limits, with
  7 days / 30 days. Three tiles: Limit reached (count), Busiest day, Weekly now.

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

**Analysis notes:** see the dated notes at the top of this section.

**Built (2026-11-14):**
- `readDesktopSamples()` in `desktop-usage.js` reads every sample.
- `src/main/usage-history.js` has two parts:
  - the readings log (`usage-history.jsonl`): repeats within 30 minutes are skipped,
    readings are kept 90 days, and a deleted account's readings are removed;
  - `buildHistory()`: day buckets, limit-reached episodes and busiest day.
- `service.usageHistory()`; every live fetch is recorded. The 5-minute background check
  now runs with alerts off too (`backgroundTick`), so history keeps filling.
- `src/renderer/components/UsageHistory.jsx` on the account page, under Usage limits:
  - 7 / 30 days;
  - three tiles;
  - a Weekly line, dashed across gaps longer than a day and a half;
  - Session daily-peak bars;
  - red at 100%, hover tooltips, and an empty state.

**Verification**

| Check | Result |
|---|---|
| Unit tests: sample reader, day buckets, empty days stay empty, range edges, limit-reached episodes, log repeats, 90-day prune, restart, delete | ✅ 405 pass |
| Test copy, Anika: 13 readings from Claude plus 1 of Multi-Claude's own. Session 100% on Mon 9 (red), 9% Tue 10, 30% Sat 14. Weekly line dashed across 10→14 Nov. Limit reached 3 times. | ✅ |
| 30-day view and hover tooltips checked by eye | ⏳ please try |
| Mac | ⏳ untested |

**Where in Multi-Claude (as planned):** add `readDesktopUsageHistory(dir, { since })` next to
`readDesktopUsage` in `src/main/desktop-usage.js` (same parsing and `pct()` clamping);
expose through `service.js` / `ipc.js` / preload; draw it as a hand-made SVG in a new
`src/renderer/components/UsageChart.jsx` (the app has no chart library), styled with
the existing glass look.

</details>

[↑ Feature list](#feature-list)

---

### 10. Claude status (outage) badge

> **Status:** ⬜ To do · **Priority:** High · **Effort:** S

**What:** A small badge in the app header (and later the tray) when Claude reports an
outage: green / amber / red with the description, click to open the status page.
Checked every few minutes, only while the app is open.

**Done when:** the badge matches `status.indicator` (`none` / `minor` / `major` /
`critical`); no network error ever shows as an outage; unit tests for the parser.

<details>
<summary><strong>Research, decisions and checks</strong></summary>
<br>

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

</details>

[↑ Feature list](#feature-list)

---

## Mid priority

### 11. Memory per account and idle sleep

> **Status:** ⬜ To do · **Priority:** Mid · **Effort:** M

**What:** Show each running account's memory use. Optional: close an account that
hasn't been in front for X minutes (off by default, per account).

**Done when:** memory shows on running accounts; idle close never closes the window in
front and is off unless turned on.

<details>
<summary><strong>Research, decisions and checks</strong></summary>
<br>

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

</details>

[↑ Feature list](#feature-list)

---

### 12. Pace, burn rate and offline cache

> **Status:** ⬜ To do · **Priority:** Mid · **Effort:** S

**What:** Next to each limit: "on pace" / "ahead of pace" compared with spending evenly
to the reset, and how fast it's rising. Keep the last good figures when offline,
labelled with their age, and label every figure as live or recorded.

**Done when:** pace shows only when reset times are known; offline shows the last
figures with their age instead of an error.

<details>
<summary><strong>Research, decisions and checks</strong></summary>
<br>

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

</details>

[↑ Feature list](#feature-list)

---

### 13. Start with the computer

> **Status:** ⬜ To do · **Priority:** Mid · **Effort:** S

**What:** Setting "Start Multi-Claude when I sign in", opening quietly in the tray.
It does not launch any Claude accounts by itself.

**Done when:** after signing in to the computer, Multi-Claude is in the tray with no
window and no Claude launched.

<details>
<summary><strong>Research, decisions and checks</strong></summary>
<br>

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

</details>

[↑ Feature list](#feature-list)

---

### 14. Settings backup, export and import

> **Status:** ⬜ To do · **Priority:** Mid · **Effort:** S

**What:** Automatic daily backup of Multi-Claude's own store (account names, colours,
folder paths, thresholds), keeping the last 10; Export / Import to move to a new PC.
Never anything inside a profile, never a sign-in.

**Done when:** a bad store can be restored from a backup; import refuses invalid files.

<details>
<summary><strong>Research, decisions and checks</strong></summary>
<br>

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

</details>

[↑ Feature list](#feature-list)

---

### 20. Copy a chat started in the wrong account

> **Status:** 🔨 Building · Code-tab copy not yet confirmed in Claude Desktop · **Priority:** Mid · **Effort:** L

**What:** On an account's page, a **Chats** section lists that account's Claude Code
chats (Terminal and VS Code). A chat that was started in the wrong account (for
example work started in a personal account) can be copied to another account the user
owns, then continued there in a Terminal opened in the same project folder. The
original stays where it was unless the user picks **Move**, which removes it only after
the copy is checked.

**Purpose and limits (agreed 2026-11-17):** this is for putting work in the right
account (billing, data, employer policy), never for working past a usage limit.
- The account picker shows names, colours and emails only. **No Session or Weekly
  figures**, no sorting by usage, no "account with room" hint.
- Never offered automatically: no prompt, toast or button when a limit is reached.
- The dialog says: "For a chat started in the wrong account. Only move chats between
  accounts you own."
- One chat at a time, by hand. No bulk copy, no "copy all", no syncing.

**Done when:** a real chat copied from one account resumes in the other with its
history; Move removes the source only after a good copy; a failed copy leaves no
partial files; running chats are refused; the dialog shows no usage figures; unit
tests for listing, copying, rollback and the guards.

<details>
<summary><strong>Research, decisions and checks</strong></summary>
<br>

**User journey**
1. Account page → **Chats** section: title, project folder, last used, size, a
   running dot, and a **Copy to…** button per chat.
2. **Copy to…** opens a dialog: pick the account; Copy (default) or Move; notes that
   the first message re-reads the whole chat on the new account, that earlier
   reasoning steps don't carry over, and that the new account's skills, MCP servers
   and settings apply.
3. **Copy & open** → copied, checked, and a Terminal opens as the new account in the
   chat's project folder, running `claude --resume <id>`.
4. The new account lists the chat with a "from <account>" tag.

| Situation | What the user sees |
|---|---|
| Chat is running | Copy disabled; **Close** (after a confirm) ends that chat's Claude Code process, only if its process id still names Claude Code |
| Project folder not on this PC | Copy blocked: "Folder … not found" |
| Target already has this chat | **Open that copy** / **Copy again** |
| Target not signed in to Claude Code | "Sign in to Claude Code first", with the existing sign-in flow |
| Copy fails partway | Everything copied is removed; the original is untouched |
| Unknown chat format | "This chat format isn't supported yet. Nothing was changed." |

**Phase 2 (built 2026-11-17, user's go-ahead):** "Show it in: Claude Desktop's Code tab"
in the Copy dialog. Found on this PC: each profile lists Code-tab chats in
`claude-code-sessions\<a>\<b>\local_<uuid>.json` (<a>/<b> are Claude Desktop's own ids,
not the transcript's account ids); 72 entries on Default had 51 different key sets, and only
10 keys are in every entry. So Multi-Claude writes a minimal entry (those 10 keys plus
`cliSessionId` and `completedTurns`), in the folder of, and with `model`, `permissionMode`
and `remoteMcpServersConfig` from, the profile's own newest entry. The transcript is copied
inside `~\.claude` under a new id (two profiles never share one file). Refused while that
account's Claude window is open, when it has never used its Code tab, or when its newest
entry doesn't look like one; if writing the entry fails, the copied transcript is removed.
Original note: Desktop app Code-tab chats. Their
transcripts are already shared in `~/.claude\projects`; only the per-profile list in
`<profile>\claude-code-sessions` differs, so copying means writing a list entry inside a
profile. Not covered by the exception above.

**References**
- STRML/move-claude-session (MIT): https://github.com/STRML/move-claude-session
- yaroslavvb/claude-session-mover (MIT): https://github.com/yaroslavvb/claude-session-mover
- azahran007/claude-session-switcher (MIT, Windows, Desktop list entries):
  https://github.com/azahran007/claude-session-switcher
- TomSOhm/claude-session-port: https://github.com/TomSOhm/claude-session-port
- Feature request, open, no staff reply: https://github.com/anthropics/claude-code/issues/73639

**Analysis notes**

```
Analysed on: 2026-11-17
References read: the four repos above (READMEs), anthropics/claude-code#73639 and #47926,
Claude Code docs "Work with sessions".
On this PC: each account's chats are <cc>\projects\<encoded folder>\<id>.jsonl, plus a
<id>\ folder (subagents, saved tool output) and <id>-named entries in file-history\,
session-env\. Transcripts now carry `session-owner` records with accountUuid and
organizationUuid (older tools say transcripts have no account identity: no longer true),
and signed thinking blocks.
```

| Reference | How they do it | Pros | Cons | Fits rules? |
|---|---|---|---|---|
| STRML | Copy transcript + sibling folder + `*<id>*` side files, rewrite old paths, delete source only after success, refuse running chats | Safe copy with rollback | mac/Linux CLI | ✅ copy logic |
| yaroslavvb | Copy, pre-answer the target's trust prompts, add a hidden "moved" note, resume | Note keeps the model from trusting stale paths | tmux only; has an automatic "--to auto" by quota | ⚠️ note yes, auto no |
| azahran007 | Copy transcript; clone a Desktop list entry into the target profile | Only one covering the Desktop app; Windows | Desktop must restart; internal format | ⚠️ Phase 2 only |
| claude-swap | Share one `projects\` folder across all accounts | Simple | Every chat in every account; changes all accounts | ❌ |

Chosen approach: STRML-style copy (copy → check sizes → only then remove the source on
Move; roll back on any failure), limited to Multi-Claude's own `cc\<id>` folders, plus
yaroslavvb's hidden "copied from <account>" note. Resume through the existing Terminal
action with `claude --resume <id>`.
Why it's better: one click from the account page, Windows-first, and none of the
references' quota-driven picking.
Rejected: shared `projects\` folder (changes every account); automatic or quota-based
target picking (breaks the rules); Desktop Code tab in phase 1 (writes inside a profile).
Prototype (2026-11-17, Claude Code 2.1.224 and 2.1.325, haiku, test chats deleted after):
- A transcript copied under a new chat id (id replaced throughout the file) resumes with
  `claude -p --resume <new id>` and remembers the conversation (code words recalled).
- With 2.1.325 the copy's four `session-owner` records were rewritten to made-up account
  and organisation ids: resume still worked. Claude Code does not check the owner; it
  copies the existing owner into the records it adds. So a copied chat keeps naming the
  source account inside its file. Harmless for resuming; Multi-Claude will not re-stamp
  it (that would need the target's account id, which comes from its sign-in).
- 2.1.224 writes no `session-owner` records at all; the format differs between versions.
- Not tested: a real second organisation (no second account owned by the user is signed
  in to Claude Code here). yaroslavvb reports thinking blocks are dropped across
  organisations and the chat still resumes.
- Found on the way: `~/.claude` and Default's `cc\547425b2` sign-ins are expired ("OAuth
  session expired and could not be refreshed") even though `auth status` says signed in.

**Build notes (2026-11-17):**
- No hidden "copied from" note in the transcript after all: adding a record means
  guessing Claude Code's message chain (`parentUuid`), and a wrong guess could stop the
  chat resuming. Same machine and same folder, so no stale paths for the model to trip on.
- Copied with the chat: `projects\<folder>\<id>.jsonl`, its `<id>\` folder, and
  `<id>`-named entries in `file-history`, `todos` and `tasks` (never `session-env`,
  sign-ins or settings). Paths to the old Claude Code folder are rewritten.
- "Copy as a new chat" (when the target already has it) gives every piece a new id.
- Simplified on the user's request (2026-11-17): the dialog is now account + two checkboxes
  (**Terminal & VS Code**, **Claude Desktop's Code tab**, one or both) + one **Copy** button.
  Copy only: no terminal opens and no Move in the dialog (the service still supports both).
  A Terminal & VS Code copy that already exists counts as done.
- Running = a `sessions\<pid>.json` naming the chat whose process is alive.
- The target must be signed in to Claude Code (`auth status`), checked before copying.

**Verification (2026-11-17, dev build on the PC, `MULTI_CLAUDE_SHOT_CHATS`):**

| Check | Result |
|---|---|
| Chats panel on an account page lists a chat (title, folder, age, size) | ✅ with a test chat in Default's folder (removed after) |
| Account with no chats shows the empty note | ✅ Default has none of its own |
| Copy dialog: wording, no usage figures, Copy / Move, cost note | ✅ (first build drew it under the panels below; fixed by rendering at page level) |
| Target not signed in to Claude Code is refused, nothing copied | ✅ and since the fix, no folder is created for it either |
| Target account is never pre-selected | ✅ (changed after the first run picked the only other account) |
| A real chat copied to another account resumes there (Terminal & VS Code) | ✅ the user copied 3 chats from Default to Anika: all listed in Anika's Chats panel, and each opened in a terminal as Anika (2026-11-17) |
| Move removes the original; failed copy leaves nothing | ✅ unit tests only |
| Default lists the real `~/.claude` chats, tagged, with open ones marked and their buttons off | ✅ 92 chats; the 4 open Desktop Code-tab chats (this one included) shown running |
| Titles: Desktop's "New session" placeholder and interrupt markers skipped | ✅ falls back to the first real prompt |
| Phase 2: copy shows in the target's Claude Desktop Code tab and opens there | ⏳ unit tests pass; not yet confirmed in Claude Desktop |
| Open chat shows **Close** (user's request): confirm, end its Claude Code process, then Continue / Copy unlock | ✅ unit tests; the name check returns `claude` for real open chats; not clicked on a real chat |

Decided (2026-11-17): the user's everyday chats are in plain `~/.claude`, which no
account pointed at, so the Default account's Chats panel now also lists them, tagged
`~/.claude`. Continue runs Claude Code on `~/.claude` itself and never adds Multi-Claude's
status line there; Copy to… lands in the target's own folder. `~/.claude` also holds
Claude Desktop Code-tab chats from every profile (they all write there), so these rows
are "this PC's chats", not strictly the Default account's.

**Where in Multi-Claude:** new `src/main/chats.js` (list + copy, pure functions with
injected fs for tests); `service.listChats` / `service.copyChat`; IPC in `src/main/ipc.js`
and `src/preload/preload.js`; resume through the Terminal launcher; a Chats panel and
`CopyChatDialog.jsx` on `src/renderer/views/AccountDetail.jsx`.

</details>

[↑ Feature list](#feature-list)

---

## Low priority

### 15. More languages (Bangla first)

> **Status:** ⬜ To do · **Priority:** Low · **Effort:** M

**What:** Translate the interface; Bangla and English first, then others. Language
setting, defaulting to the system language.

**Done when:** every visible string comes from a locale file; switching language needs
no restart.

<details>
<summary><strong>Research, decisions and checks</strong></summary>
<br>

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

</details>

[↑ Feature list](#feature-list)

---

### 16. PIN lock

> **Status:** ⬜ To do · **Priority:** Low · **Effort:** S

**What:** Optional PIN to open Multi-Claude, for shared PCs. Hashed with a salt, never
stored plainly. It locks only Multi-Claude, not the Claude windows.

**Done when:** the app opens to the lock screen; a wrong PIN shows nothing else.

<details>
<summary><strong>Research, decisions and checks</strong></summary>
<br>

**References**
- Ferdium (inherited from Franz/Ferdi) — app lock: https://ferdium.org/

**Analyse first**
- When does Ferdium lock (on start, after a timeout, on sleep), and how does a user
  recover a forgotten password?
- Read Ferdium's issues about the lock being bypassed or annoying.

**Analysis notes:** _Not analysed yet._

**Where in Multi-Claude:** lock screen in `src/renderer/App.jsx`; hash with Node
`crypto.scrypt` in the main process; tray actions also check the lock.

</details>

[↑ Feature list](#feature-list)

---

### 17. `multi-claude://` links and launcher support

> **Status:** ⬜ To do · **Priority:** Low · **Effort:** S

**What:** `multi-claude://launch/<account>` and `multi-claude://show/<account>`, so
Raycast, Alfred, PowerToys Run or a browser bookmark can open an account.

**Done when:** opening the link launches or shows the account, including when
Multi-Claude was not running.

<details>
<summary><strong>Research, decisions and checks</strong></summary>
<br>

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

</details>

[↑ Feature list](#feature-list)

---

### 18. Command-line status (`--status --json`)

> **Status:** ⬜ To do · **Priority:** Low · **Effort:** S

**What:** `Multi-Claude.exe --status --json` prints each account's running state and
latest figures, then exits — for scripts and status bars.

**Done when:** output is stable JSON with a `schemaVersion`; documented in the README.

<details>
<summary><strong>Research, decisions and checks</strong></summary>
<br>

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

</details>

[↑ Feature list](#feature-list)

---

### 19. winget, Homebrew and code signing

> **Status:** ⬜ To do · **Priority:** Low · **Effort:** M

**What:** Install with `winget install` and `brew install --cask`; sign the Windows
installer (no SmartScreen warning) and sign + notarise the Mac app (no right-click →
Open step).

**Done when:** both installs work from a clean machine with no security warnings.

<details>
<summary><strong>Research, decisions and checks</strong></summary>
<br>

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

</details>

[↑ Feature list](#feature-list)

---

## Not doing (breaks the rules)

| Feature | Seen in | Why not |
|---|---|---|
| Automatic switching at a limit, "next available", failover | claude-swap, cux, clauth, cc-switch | Gets around usage limits |
| Pooling accounts, carrying a conversation to another account to keep working past a limit, handing work to another account | cux, clauth | Same. (Copying a chat started in the wrong account, by hand, is allowed: feature 20.) |
| Exporting or backing up sign-ins | claude-swap | Handles credentials |
| Session browser, syncing MCP servers or history between profiles | cc-switch, clauth, KeyboardCowboy | Reads or moves files inside a profile |
