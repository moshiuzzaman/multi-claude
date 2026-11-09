# Multi-Claude

A Windows app for keeping several Claude Desktop accounts side by side — add a profile,
launch it, give it a desktop shortcut, delete it when you are done — plus dashboards for
token usage, launch history and disk storage.

Replaces hand-edited `.bat` files like `Claude-Account2.bat`.

> Not affiliated with, or endorsed by, Anthropic.

## The five views

| View | What it shows |
|---|---|
| **Dashboard** | Headline token counts, tokens-per-day chart, model split, account shortcuts |
| **Accounts** | Launch, open folder, make a shortcut, rename, delete |
| **Usage** | Input/output/cache tokens and cost over time, by model, by project, by account |
| **Account** | Rolling 5-hour / 7-day token volume, what's driving it (skills, plugins, MCP), and the Claude Code account card |
| **History** | Which account was open, when, and for how long |
| **Storage** | Per-profile disk usage split by category, with a cache purge |

## Where the usage numbers come from — and what they are not

The Usage and Dashboard views read Claude Code's own session logs in
`~/.claude/projects`. Three things are worth being precise about:

1. **It is Claude Code usage, not Claude.ai chat usage.** Your subscription's
   "messages used / limit remaining" is not exposed locally or through any API a
   third-party app can call. This app does not show it and does not estimate it.
   The Session (5hr) and Weekly (7 day) percentages in Claude Desktop's own
   Account & Usage panel come from an authenticated request made with your session
   token; the only file on disk matching those terms is your credential store, which
   this app never opens. The Account view says so and points you at the real panel.
2. **Metadata only.** The reader extracts token counts, timestamps, model names, project
   folder paths and recorded cost. It never reads, stores or displays message text,
   prompts, replies or tool arguments. There is a test that asserts this.
3. **Attribution is partial, and labelled as such.** Those logs live in your home folder
   and are shared by every profile. Only sessions carrying an `organizationUuid` can be
   attributed to an account — roughly a third — and the rest are grouped under
   "Unattributed" rather than guessed at. Cost is recorded by a minority of sessions, so
   it is shown as a partial figure with the session count beside it.

History is different: Multi-Claude observes it directly, so it is exact per account. The
limit there is that it can only see what runs while the manager itself is open.

### The rolling gauges

The Account view's two bars are shaped like Claude's Session and Weekly meters, but a bar
needs a denominator and there is no real allowance to use. The denominator is therefore
**your own busiest comparable window in the last 30 days** — a number this app can
actually compute — and every label says exactly that. They are token counts, never a
percentage of a plan limit.

Skills and plugins are measured in tokens, read straight off the assistant turns carrying
`attributionSkill` / `attributionPlugin`. MCP servers are measured in **tool calls**
instead: one turn can call several servers, so dividing its tokens between them would be
an invented figure.

### The account card

`~/.claude.json` describes exactly one account — whichever Claude Code is signed in as —
because it lives in your home folder and is shared by every profile. It can and does
differ from the account a given Claude Desktop profile is logged into. There is no
per-profile equivalent: that identity lives inside each profile's Chromium credential
storage, which this app does not read.

### Performance

The first usage scan parses tens of thousands of records and takes a few seconds; the
first storage walk adds up every file across profiles that can run to tens of gigabytes.
Both results are cached in `%APPDATA%\multi-claude\`, so every later launch is instant.
Storage is re-measured on demand with the **Recalculate** button, and after any delete or
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

## Install

```
npm install
npm start
```

To build an installer:

```
npm run dist
```

That produces `dist/Multi-Claude Setup 1.0.0.exe` and a portable executable. The build
is **unsigned**, so Windows SmartScreen will warn the first time you run it — choose
**More info → Run anyway**. Sign the build with a code-signing certificate if you want
that warning gone.

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

## Where things live

| What | Where |
|---|---|
| New profiles | `%USERPROFILE%\ClaudeProfiles\<name>` |
| Imported `Claude_Work` | left exactly where it is |
| Default account | `%LOCALAPPDATA%\Claude-Data\<package family>` |
| App config | `%APPDATA%\multi-claude\accounts.json` |
| Usage cache | `%APPDATA%\multi-claude\usage-cache.json` |
| Storage cache | `%APPDATA%\multi-claude\storage-cache.json` |
| Launch history | `%APPDATA%\multi-claude\activity.jsonl` |

`accounts.json` holds names, folder paths and ids. No credentials, ever. Deleting any of
the cache files is safe — they are rebuilt on next launch.

On first run the app registers your existing default account and, if you have one, the
`Claude_Work` folder — in place, so any old `.bat` files keep working.

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

- Windows only.
- Launching the Store build's executable directly means the second instance runs without
  package identity, so `claude://` deep links and some notification routing still go to
  the default instance. This applies equally to the `.bat` approach.
- Shortcut icons use the Multi-Claude icon, not Claude's.

## Development

```
npm test              # unit tests, no Electron needed
npm run build:renderer
npm start
```

Two environment variables help when the window itself misbehaves:

```bash
MULTI_CLAUDE_DEBUG=1                      # renderer console + load events -> %TEMP%\multi-claude-debug.log
MULTI_CLAUDE_SHOT=C:\path\shot.png        # screenshot every view, then keep running
```

`MULTI_CLAUDE_DEBUG` exists because a packaged Windows GUI app has no console to print
to. `MULTI_CLAUDE_SHOT` fronts the window before capturing — an occluded Electron window
is not recomposited, so a naive `capturePage()` returns a stale frame.

The main process (`src/main/`) owns every path, the `claude.exe` lookup, process
scanning and deletion. The renderer (`src/renderer/`, React + Vite) is sandboxed with
`contextIsolation` on and talks to the main process through a preload bridge that only
ever passes account **ids** — never filesystem paths. The UI is served over a custom
`app://` protocol so the Content-Security-Policy can stay at `'self'`.
