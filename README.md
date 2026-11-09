# Multi-Claude

A small Windows app for keeping several Claude Desktop accounts side by side — add a
profile, launch it, give it a desktop shortcut, delete it when you are done.

Replaces hand-edited `.bat` files like `Claude-Account2.bat`.

> Not affiliated with, or endorsed by, Anthropic.

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

`accounts.json` holds names, folder paths and ids. No credentials, ever.

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

The main process (`src/main/`) owns every path, the `claude.exe` lookup, process
scanning and deletion. The renderer (`src/renderer/`, React + Vite) is sandboxed with
`contextIsolation` on and talks to the main process through a preload bridge that only
ever passes account **ids** — never filesystem paths. The UI is served over a custom
`app://` protocol so the Content-Security-Policy can stay at `'self'`.
