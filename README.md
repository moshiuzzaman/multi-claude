# Multi-Claude

A Windows and macOS app for keeping several Claude Desktop accounts side by side — add a profile,
launch or close it, give it a desktop shortcut, delete it when you are done — and see each
account's own real Session and Weekly usage limits, launch history and disk usage.

Replaces hand-edited `.bat` files like `Claude-Account2.bat`.

> Not affiliated with, or endorsed by, Anthropic.

## Views

Everything is per account. Nothing is summed or merged across accounts.

| View | What it shows |
|---|---|
| **Dashboard** | One card per account: its own Session and Weekly limits, whether it is running, Launch/Close. Click a card to open the account. |
| **Account page** | Everything about that one account: its usage limits, its actions (Launch/Show/Close, shortcut, rename, delete), its disk usage, and its launch history. |
| **Accounts** | The list of accounts with their actions; click one to open its page |
| **History** | Which account was open, when, and for how long |
| **Storage** | Per-profile disk usage split by category, with a cache purge |

## Usage limits per account

Each account's Dashboard card and its own page show that account's **Session (5hr)** and
**Weekly** limits, and an account needs only **one sign-in**: its own Claude window.

**From Claude itself (the default).** Claude Desktop records its own usage in the profile
(`plan-usage-history.json`): a sample a few times a day while it runs, as percentages.
Multi-Claude shows the newest sample with its age ("From Claude · 2 hours ago"); there is no
reset time in it. Only that file's numbers are read, and nothing is sent anywhere. See
`desktop-usage.js`.

**Live limits (optional).** For up-to-the-minute figures with reset times, **Live limits**
on a card or the account's page connects that account to Anthropic's Claude Code through
a browser sign-in, once. The rest of this section describes that route.

**Why the app can't just read them like VS Code does.** VS Code, the Claude Code CLI and
Claude Desktop are Anthropic's own apps. When you sign in, Anthropic's login hands *that
app* a token, and it shows your limits by calling Anthropic with that token. You sign in
to Claude Desktop, not to Multi-Claude. To do the same, Multi-Claude would have to take
one of those tokens off disk and use it — and Anthropic's Claude Code terms say developers
"may not collect, store, or intermediate Claude.ai credentials or session tokens", and
reserve the right to enforce that without notice. On accounts you rely on, that is not a
risk worth taking. So the app never does it.

**What it does instead.** It asks Anthropic's own Claude Code, which is allowed to.
Every account gets its own Claude Code config folder
(`%APPDATA%\multi-claude\cc\<account id>`, via `CLAUDE_CONFIG_DIR`):

1. **Connect** — once per account — runs Anthropic's `claude auth login` inside
   Multi-Claude with no terminal window. Your browser opens; click **Authorize** with that
   account and the dialog finishes by itself. If the browser shows a code instead, paste it
   into the dialog: it goes straight to the Claude Code process, exactly like typing it
   into a terminal, and is never stored or logged. Nothing asks for this: it only happens
   when you choose **Live limits**.
2. **Fetching** — Multi-Claude then runs `claude -p "/usage"` for each signed-in account,
   hidden. `/usage` is a built-in command: Claude Code answers it from Anthropic's usage
   service and returns a structured report, **without calling a model**. Measured on this
   machine with Claude Code 2.1.319: cost $0, zero turns. Each account shows every meter the
   server reports — session, weekly, any per-model weekly limit — with reset times and the
   server's own severity, plus extra-usage status.
3. Results are cached for 90 seconds; **Refresh** fetches immediately.

Safety nets, because getting this wrong would spend your usage silently:

- The CLI is launched directly, never through a shell. During development Git Bash
  rewrote `/usage` into `C:/Program Files/Git/usage`, which Claude Code then sent to the
  model as an ordinary prompt.
- The fetch also passes the cheapest model, a one-word system prompt and no tools, so if a
  future Claude Code ever routed `/usage` to a model it would cost a fraction of a cent.
- Every result's turn count is checked. A fetch that reached a model is shown as such, and
  automatic refresh stops for that account; only a manual Refresh tries again.

If `/usage` is ever unavailable, the account falls back to what Claude Code's status line last
recorded for that account (see `limits.js`). The newest Claude Code installed on the PC is
used automatically; `/usage` reports need Claude Code 2.1.273 or later.

**Free plans.** Claude Code only signs in Pro, Max and Ultra plans (and Team or
Enterprise); for a free account the browser shows *Claude Max, Ultra, or Pro is required*
and no code. Such an account works in Multi-Claude as usual and shows the usage its Claude
window records, but can't have live limits.
Choose **It's a free plan, stop asking** in the sign-in dialog, or **Free plan?** on its
card, and it stops asking to connect; Multi-Claude then never starts Claude Code for it.
**Upgraded? Connect for usage limits** on its page undoes that.

**A PC without Claude Code.** Claude Desktop downloads its own copy into the profile
folder the first time its Code tab is opened, and Multi-Claude finds that copy. If there
is none at all, choosing **Live limits** shows **Set up usage limits** on the account's page. One click
downloads Anthropic's official Claude Code (about 350 MB) the same way Anthropic's own
install script does: it asks `downloads.claude.ai` for the newest version, reads that
version's manifest, downloads `claude.exe`, and keeps it only if its size and SHA-256 match
the manifest. A progress line shows while it runs; the limits load by themselves when it
finishes. It goes into `%APPDATA%\multi-claude\claude-code\<version>` and nowhere else:
unlike the install script, Multi-Claude never runs `claude install`, so your PATH and home
folder are not changed. Claude Code is not bundled with Multi-Claude; it only ever comes
from Anthropic's server, and only when you click.

### Limit alerts

Multi-Claude shows a notification when an account's **Session** or **Weekly** usage passes
a level you pick, for example *Work: Weekly at 82% · Resets Mon 09:00*, and when it reaches
its limit. Clicking it opens that account's page. Information only: it never switches,
launches or closes anything.

- **Levels:** 80% and 95% by default; pick any of 50–95% under **Limit alerts** on the
  **Accounts** page. 100% ("limit reached") is always on while alerts are on.
- **Once per window:** each level alerts once, then again only after usage drops back
  below it (the limit reset) and climbs past it again. A jump past several levels shows one
  alert, for the highest. What was already shown is saved (`alert-state.json`), so
  restarting Multi-Claude doesn't repeat it.
- **When it checks:** whenever the screen refreshes limits, and every 5 minutes in the
  background while Multi-Claude is open, even minimised. **Closing the window quits
  Multi-Claude, and then there are no alerts.**
- **Which figures:** live limits where the account is connected; otherwise what its Claude
  window recorded, if recent enough (a Session figure older than 5 hours has already reset,
  so it is ignored; a Weekly one is used for a day).
- **Optional:** *Also tell me when a limit resets after it was reached* (off by default),
  **Mute limit alerts** on one account's page, and **Send a test alert**.
- Windows' **Do not disturb** hides the pop-up; the alert still lands in the notification
  centre.

### Usage history

Each account's page has a **Usage history** panel for the last **7 or 30 days**:

- **Limit reached:** how many times Session or Weekly hit 100%, and when.
- **Busiest day:** the day Session went highest.
- **Weekly, last reading:** where Weekly stood most recently.
- **Weekly line:** every reading. Resets show as drops, and stretches with no readings
  are dashed.
- **Session bars:** the highest reading each day. Claude records usage only a few times a
  day, hours apart, so a Session line would be misleading. A day with no readings stays
  empty instead of showing 0%. Red means the limit was reached.

The figures come from two places:

- what the account's own Claude window recorded (`plan-usage-history.json`);
- Multi-Claude's own readings: every live figure it fetches, about every 5 minutes while
  it's open, for accounts with live limits.

Multi-Claude keeps its readings in `usage-history.jsonl`: percentages and times only, for
90 days. Deleting an account deletes its readings.

## Activity and storage

**History** is observed by Multi-Claude itself, so it is exact per account. The limit is
that it can only see what runs while the manager is open: a profile started from a desktop
shortcut with the manager closed is recorded from the moment the manager next opens.

**Storage** adds up every file in each profile, which can run to tens of gigabytes, so the
first measurement takes a few seconds. Results are cached in `%APPDATA%\multi-claude\` and
reused for 10 minutes; they are re-measured with **Recalculate**, and after any delete or
cache purge.

## How it works

Claude Desktop is an Electron app, so it accepts Chromium's standard `--user-data-dir`
flag. Point it at a different folder and you get a completely separate login, exactly
like Chrome profiles. Multi-Claude manages those folders and launches Claude against
them.

That is the whole mechanism. Multi-Claude does **not**:

- modify, patch or repack Claude Desktop
- read, copy or back up your tokens, cookies or any file inside a profile
- touch rate limits, quotas or device identity

You sign in to each account yourself, inside Claude's own window.

### One taskbar button per account (Windows)

Normally every Claude window shares Claude's one taskbar button, so accounts look
identical there. Multi-Claude gives each **added** account's Claude window a taskbar
button of its own, with the account's colour and first letter, its name
("Claude - Work") in the tooltip, and a pin that opens that account. The default
account stays on Claude's own button, and Multi-Claude's own button always shows its
own logo.

It does this with four standard Windows shell properties set on the account's Claude
windows from outside (the taskbar id `System.AppUserModel.ID` and the relaunch icon,
name and command), after Launch or Show and when it sees an account running that
doesn't have them yet. Nothing in Claude is changed or read. Right-clicking such a
button shows Multi-Claude's pin rather than Claude's own menu.

Turn it off on the **Accounts** page (**Separate taskbar button for each added
account**); the windows go back onto Claude's button the next time each is shown.
Not available on a Mac, where the Dock can't be split per window without copying
Claude.

## What it will not do, on purpose

Having several accounts you legitimately own is fine. Using them to get around usage
limits is not — Anthropic's enforcement targets account sharing, reselling access, and
circumventing limits. So this app deliberately has no:

- automatic switching when an account hits a limit
- parallel or pooled launching to multiply quota
- "next available account" failover
- profile cloning or export

If you want those, this is the wrong tool.

Two other things worth knowing. An account on an employer's email domain may be linked
to that organisation's enterprise account, where an admin can manage it — nothing here
changes that. And Claude Desktop has an internal `multiAccount` feature flag, currently
switched off; if Anthropic ships native multi-account support, retire this app rather
than working around it.

VS Code uses one account at a time. **Use in VS Code** moves the editor from one
account you own to another — different clients, different organisations. It does
not run the same work across several accounts at once, which is the thing
Anthropic's enforcement is actually aimed at.

## Install

```
npm install
npm start
```

To build an installer:

```
npm run dist
```

That produces `dist/Multi-Claude-Setup-<version>.exe` and `dist/Multi-Claude-<version>-portable.exe`. The build
is **unsigned**, so Windows SmartScreen will warn the first time you run it — choose
**More info → Run anyway**. Sign the build with a code-signing certificate if you want
that warning gone.

### macOS

The Mac app is built on a Mac by GitHub Actions (`.github/workflows/mac.yml`) for every
pushed version tag, and attached to that release as `Multi-Claude-<version>-arm64.dmg`
(Apple Silicon) and `Multi-Claude-<version>-x64.dmg` (Intel), plus `.zip` copies. On a Mac
you can also build it yourself with `npm run dist:mac`.

It is ad-hoc signed, not signed with an Apple Developer ID, so macOS stops it the first
time: **right-click the app → Open → Open**. (On recent macOS: System Settings → Privacy &
Security → **Open Anyway**.)

What differs on a Mac (see `src/main/mac.js`; `platform.js` picks the Windows or Mac parts):

| | Windows | Mac |
|---|---|---|
| Claude | `claude.exe` (Store or classic install) | `Claude.app` in Applications, or found by Spotlight |
| Open an account | `claude.exe --user-data-dir=…` | `open -n -a Claude.app --args --user-data-dir=…` |
| Which are open | PowerShell process list | `ps` |
| Close | ends that profile's process tree | asks it to quit (SIGTERM), then ends what is left |
| Default profile | `%LOCALAPPDATA%\Claude-Data\…` | `~/Library/Application Support/Claude` |
| Desktop shortcut | `.lnk` | a tiny `.app` on the Desktop |
| Updating | in-app installer | **Update** opens the release page to download the new `.dmg` |

The status-line recorder (a fallback for live limits) is a PowerShell script and isn't used
on a Mac. **The Mac version has not been tried on a real Mac yet**: the parts are covered by
tests, but whether Claude for Mac keeps a separate profile per `--user-data-dir` the way the
Windows build does is the first thing to check.

### If the build fails on symbolic links

On a standard Windows account without Developer Mode, electron-builder cannot unpack its
code-signing toolkit, because that archive contains macOS symlinks and creating symlinks
needs a privilege the account does not hold:

```
ERROR: Cannot create symbolic link ... winCodeSign\<id>\darwin\10.12\lib\libcrypto.dylib
```

Nothing in that `darwin/` folder is used on Windows. Unpack the archive yourself without
it, once, and every later build reuses the result:

```bash
node_modules/7zip-bin/win/x64/7za.exe x -y "$LOCALAPPDATA/electron-builder/Cache/winCodeSign/<id>.7z" "-o$LOCALAPPDATA/electron-builder/Cache/winCodeSign/winCodeSign-2.6.0" "-xr!darwin"
```

Enabling Windows Developer Mode fixes it permanently instead, if you would rather do
that.

### Build from your own terminal

Run `npm run dist` from an ordinary PowerShell or Windows Terminal — not from a shell
running inside the Store version of Claude Desktop, such as an agent's shell in Claude
Code's Code tab. That shell is packaged, so Windows redirects its `%LOCALAPPDATA%` into
`%LOCALAPPDATA%\Packages\Claude_<id>\LocalCache\Local\` and then reads that store layered
over the real folder. electron-builder's download cache therefore exists in two places at
once, and the unpacked `winCodeSign-2.6.0` above may sit in only one of them: the build
succeeds in the packaged shell, which can see it, and the same build fails in your own
terminal, which re-downloads the archive and hits the symlink error. Apply the fix above
from the terminal you actually build in. Same cause as **Start it yourself, not from
inside Claude Desktop** under Known limitations.

## Updates

Multi-Claude checks GitHub Releases each time it opens. If a newer version has
been published, an update dialog opens on its own with the release notes of
every version since yours, and the sidebar footer shows it with **What's new**
and **Update**. Otherwise it says everything is up to date; the ↻ button next
to it checks again.

The dialog depends on which number in the version went up:

- **Minor update** (`1.2.x` → `1.3.0` or `1.2.2`): **Later** closes it until the
  next launch, when it opens again. The footer keeps offering the update in
  the meantime.
- **Major update** (`1.x.x` → `2.0.0`): the dialog cannot be closed — no Close
  button, Escape or clicking outside. It stays up through the download, and the
  only ways out are **Update** or **Quit Multi-Claude**. Run from source, it can
  still be closed.

**Update** downloads the installer, checks its size and SHA-512 against the
release's `latest.yml`, runs it silently and closes Multi-Claude; the installer
starts the new version when it finishes. A download that does not match is
deleted and never run. Your accounts and settings are kept, and any Claude
window you launched keeps running.

From the moment **Update** is clicked, a progress screen covers the app
(Download → Install → Restart) and cannot be closed, so nothing new is started
while Multi-Claude is about to restart. If the update fails, the dialog shows
why and can be closed again.

Nothing is downloaded without a click. Run from source, the footer tells you to
`git pull` instead; the portable build's **Update** opens the download page,
since a running portable file cannot replace itself.

### Publishing a release

From an ordinary terminal — not from inside Claude Desktop, see *Build from your
own terminal*:

1. `npm version minor` (or `patch`) — bumps the version, commits, and tags it.
   Use `npm version major` only for a release every user must install: it
   locks the update dialog open until they do.
2. `git push origin main --follow-tags`
3. With a GitHub token that can create releases, in that terminal only:
   `$env:GH_TOKEN = "<token>"`, then `npm run release`. It builds and uploads
   to a draft release.
4. On GitHub, write the release notes (or use **Generate release notes**) and
   **Publish** the draft. Installed copies see it the next time they open.

Without a token, `npm run dist` and upload `Multi-Claude-Setup-<version>.exe`,
`latest.yml` and the portable `.exe` to a new release by hand.

The version that first adds updates has to be installed by hand once; every
version after it arrives through the button.

## Where things live

| What | Where |
|---|---|
| New profiles | `%USERPROFILE%\ClaudeProfiles\<name>` |
| Imported `Claude_Work` | left exactly where it is |
| Default account | `%LOCALAPPDATA%\Claude-Data\<package family>` |
| App config | `%APPDATA%\multi-claude\accounts.json` |
| Storage cache | `%APPDATA%\multi-claude\storage-cache.json` |
| Launch history | `%APPDATA%\multi-claude\activity.jsonl` |
| Limit alerts already shown (percentages and levels only) | `%APPDATA%\multi-claude\alert-state.json` |
| Usage history readings, 90 days (percentages and times only) | `%APPDATA%\multi-claude\usage-history.jsonl` |
| Each account's Claude Code sign-in (for usage limits) | `%APPDATA%\multi-claude\cc\<account id>` |
| VS Code's active account | `%APPDATA%\Code\User\settings.json` (a managed block) |
| Claude Code downloaded by Multi-Claude (only if you clicked *Set up usage limits*) | `%APPDATA%\multi-claude\claude-code\<version>\claude.exe` |
| Status-line recorder (limits fallback) | `%APPDATA%\multi-claude\limits-recorder.ps1` |
| A downloaded update, until the next launch | `%TEMP%\multi-claude-update` |

`accounts.json` holds names, folder paths and ids. No credentials, ever. Deleting any of
the cache files is safe — they are rebuilt on next launch.

The `cc\<account id>` folders belong to Anthropic's Claude Code: it keeps that account's
sign-in there. Multi-Claude creates the folder and its status-line setting, and deletes the
folder with the account, but never reads the credentials inside it.

On first run the app registers your existing default account and, if you have one, the
`Claude_Work` folder — in place, so any old `.bat` files keep working.

## Launching and closing

Each row carries one button that changes with the profile's state: **Launch** when it is
idle, **Close** when it is running. Close asks for confirmation, then quits that profile.

**Close is a force-quit, and that is deliberate.** Claude Desktop lives in the system tray:
closing its window only hides it, and a polite `taskkill` (no `/F`) cannot make it quit.
Both were tried against a throwaway profile and the process survived each time; only
`taskkill /T /F` ended it. So Close ends that one instance's process tree, which also stops
anything running inside it — an active chat, a Claude Code session. You stay signed in and
nothing is deleted. That is why it asks first.

Finding the right process takes care, because `--user-data-dir` is not on every process in
the tree: an instance started without the flag (your default profile) only has it on its
children. So the lookup matches any process carrying the profile's directory and walks up
through `claude.exe` parents to the root, which keeps it inside that one instance. Only that
root is named to `taskkill`, so no other account can be touched.

After the kill the app waits until the process scan agrees the instance is gone, and reports
what actually happened — it will say so if the profile survives, rather than claiming success.
A failed scan is never read as "gone".

When the running check itself fails, the button falls back to **Launch** rather than offering
to quit something that may not be open. Launch on an already-running profile just focuses its
existing window.

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
is between them. Before each change it saves a timestamped `.bak` beside the
file, keeping the newest three. If `settings.json` is a symlink — a dotfiles
setup — the file it points at is the one changed, and the link is kept. If you
set `claudeCode.environmentVariables` yourself, outside those markers, yours
wins and the button says so rather than fighting you.

Deleting the account VS Code is using takes the block back out, so VS Code
falls back to your plain `~/.claude` rather than pointing at a folder that no
longer exists.

If VS Code is not running, the button starts it. If it is not in one of the
usual install locations, the setting is still written and takes effect the next
time you open VS Code yourself.

**Terminal** does the same thing in a console window instead, for when you want
Claude Code without an editor. It passes the account per process, so it never
disturbs the setting.

## Deleting an account

Delete erases the **profile folder on this PC**: the local login and cached data. Your
Anthropic account is untouched and still exists; no application can delete that from
here. Cancel your subscription or close your account through Anthropic directly.

Deletion is guarded. It refuses when the account is the default one, when its Claude
window is still open, when the folder is a junction or symbolic link, when the path is a
drive root or too close to one, and when the folder sits outside
`%USERPROFILE%\ClaudeProfiles` unless you explicitly tick the unlock box. On top of all
that, you type the account's name to confirm.

## Shortcuts

`Shortcut` writes `Claude - <name>.lnk` to your Desktop. It targets Multi-Claude with
`--launch <id>` rather than `claude.exe` directly, because the Store build's executable
path contains its version number and changes on every update. Going through
Multi-Claude means the path is resolved fresh each time, so a pinned shortcut never
goes stale. Clicking one launches the profile without opening the manager window.

## Known limitations

- Windows and macOS. The Mac version is new and untested on a real Mac (see **macOS** above).
- Launching the Store build's executable directly means the second instance runs without
  package identity, so `claude://` deep links and some notification routing still go to
  the default instance. This applies equally to the `.bat` approach.
- **Sign in to an added account with the email code, not Google.** Claude Desktop registers
  its `claude://` sign-in link without a profile folder, so a sign-in that finishes in the
  browser (Continue with Google) is handed to the default Claude. The added account never
  receives it and shows "Get started" on every launch. Entering your email and typing the
  emailed code into the account's own window never leaves that window, so it sticks.
  **Create account** walks you through this once, with an **Open Gmail** button for the
  code; an account made with Google signs in the same way with that Google email. Claude
  keeps the sign-in in the profile, so from then on **Launch** opens it signed in. An
  account whose window isn't signed in shows **Not signed in**, and Launch brings the
  steps up with the window (also under **Sign-in help** on its page). Multi-Claude tells
  only from the names of the settings in the profile's `config.json`; it never reads a
  token. That one sign-in is all an account needs: its usage limits come from what its
  Claude window records. Claude Code (for optional live limits) is a separate sign-in that
  is never copied from the window's.
  Multi-Claude does not reroute the link: it carries the sign-in code, and Multi-Claude
  never handles a credential.
- Shortcut icons use the Multi-Claude icon, not Claude's.
- **Start it yourself, not from inside Claude Desktop.** If Multi-Claude is launched by a
  process running inside the Store version of Claude Desktop (for example by Claude Code
  in its Code tab), Windows redirects its `%APPDATA%` writes into Claude's package folder
  (`%LOCALAPPDATA%\Packages\Claude_<id>\LocalCache\Roaming\`). Its accounts, history and
  Claude Code sign-ins then live there instead of in your real AppData, and **Use in VS
  Code** writes a `settings.json` your real VS Code never reads. Starting it from
  `start.cmd`, Explorer or the Start Menu uses the real location.

## Development

```
npm test              # unit tests, no Electron needed
npm run build:renderer
npm start
```

Two environment variables help when the window itself misbehaves:

```bash
MULTI_CLAUDE_DEBUG=1                      # renderer console + load events -> %TEMP%\multi-claude-debug.log
MULTI_CLAUDE_SHOT=C:\path\shot.png        # screenshot every view, one account page and the Add dialog
MULTI_CLAUDE_SHOT_WAIT=12000              # ms to wait on each view before capturing (default 1400)
MULTI_CLAUDE_SHOT_SIGNIN=1                # also drive the sign-in dialog with an invalid code
```

`MULTI_CLAUDE_DEBUG` exists because a packaged Windows GUI app has no console to print
to. `MULTI_CLAUDE_SHOT` fronts the window before capturing — an occluded Electron window
is not recomposited, so a naive `capturePage()` returns a stale frame.

To try the update screens without publishing anything, run from source with a pretend
update (`src/main/update-demo.js`; ignored by the installed app). Nothing is downloaded
or installed: the download and install are timed stand-ins, then Multi-Claude restarts.

```bash
MULTI_CLAUDE_UPDATE_DEMO=1        # a minor update: download, install, restart
MULTI_CLAUDE_UPDATE_DEMO=major    # the same, as a required (major) update
MULTI_CLAUDE_UPDATE_DEMO=fail     # the download fails at 60%
```

The main process (`src/main/`) owns every path, the `claude.exe` lookup, process
scanning and deletion. The renderer (`src/renderer/`, React + Vite) is sandboxed with
`contextIsolation` on and talks to the main process through a preload bridge that only
ever passes account **ids** — never filesystem paths. The UI is served over a custom
`app://` protocol so the Content-Security-Policy can stay at `'self'`.

`src/main/usage-reader.js`, `usage-aggregate.js` and `account-info.js` (with their tests)
still exist, but nothing in the UI uses them any more: they powered the removed views that
merged usage across all accounts. They are safe to delete along with their IPC channels.
