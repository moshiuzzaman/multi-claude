# Contributing to Multi-Claude

Thanks for being here. Issues, fixes, translations and real-world testing are all welcome.

## Good first contributions

- **Try it on a real Mac** and report what breaks. The Mac build has never run on real
  hardware — see [macOS](docs/GUIDE.md#macos) for what to check first. This is the single
  most useful thing anyone could do right now.
- **Screenshots** for the README — the repo has none yet. `MULTI_CLAUDE_SHOT` (below)
  captures every view.
- **Pick a feature from the roadmap.** [`docs/FEATURE-ROADMAP.md`](docs/FEATURE-ROADMAP.md)
  lists 20 researched features with priority, effort, status and reference implementations.
- **Report what confused you.** A README or dialog that didn't explain itself is a bug.

## Rules a contribution must keep

These are permanent product decisions, not missing features. A PR that breaks one will be
declined:

- **No automatic switching** when an account hits a limit.
- **No pooling, "next available account" or failover.**
- **No parallel or batched launching** to multiply quota.
- **No handling of credentials** — no reading, copying, exporting or backing up sign-ins.
- **No reading files inside a profile** beyond what already happens: setting *names* in
  `config.json`, the account id used for the one-way fingerprint, and the percentages in
  `plan-usage-history.json`.
- **No moving a conversation to another account to keep working past a limit.** One
  narrow exception: a Claude Code chat started in the wrong account may be copied, by
  hand and one at a time, to another account the user owns (roadmap feature 20). That
  feature may list chats and copy their files inside Multi-Claude's own `cc` folders
  (and, for the Default account, from `~/.claude`; copies always land in a `cc` folder),
  and, so the copy shows in Claude Desktop's Code tab, add one chat-list entry to the
  target profile's `claude-code-sessions` folder while that account's window is closed,
  and must never show usage figures, suggest an account by usage, or be offered when a
  limit is reached.
- **Never modify, patch or repack Claude Desktop.**

Owning several Claude accounts is fine. Using them to get around usage limits is not, and
Anthropic's enforcement targets exactly that. The rules exist so this tool stays on the
right side of that line.

## How features get built here

Every feature in the roadmap follows the same path, and PRs are expected to do the same:

1. **Read the feature's spec** in [`docs/FEATURE-ROADMAP.md`](docs/FEATURE-ROADMAP.md).
2. **Study the reference implementations** linked with it — their docs, their code, and
   their issues, which show what went wrong for them.
3. **Compare the approaches** in a short table: pros, cons, and whether each fits the rules
   above.
4. **Take the better idea**, write the decision into the feature's *Analysis notes*, and set
   its status to **Analysed**.
5. **Build it with tests.**
6. **Verify it in the real app**, not just in unit tests, record what you checked, and only
   then mark it **Done**.

**Learn ideas, don't copy code.** Write Multi-Claude's own code. Code from MIT-licensed
repos may be reused only with its licence notice kept; never copy from AGPL, unlicensed or
closed-source projects.

## Development

Needs [Node.js 22+](https://nodejs.org) and Claude Desktop installed.

```bash
npm install
npm test              # 427 unit tests, no Electron needed
npm run build:renderer
npm start
```

### Architecture

The main process (`src/main/`) owns every path, the `claude.exe` lookup, process scanning
and deletion. The renderer (`src/renderer/`, React + Vite) is sandboxed with
`contextIsolation` on and talks to the main process through a preload bridge that only ever
passes account **ids** — never filesystem paths. The UI is served over a custom `app://`
protocol so the Content-Security-Policy can stay at `'self'`.

`src/main/usage-reader.js`, `usage-aggregate.js` and `account-info.js` (with their tests)
still exist, but nothing in the UI uses them any more: they powered the removed views that
merged usage across all accounts. They are safe to delete along with their IPC channels.

### Debugging the window

```bash
MULTI_CLAUDE_DEBUG=1                      # renderer console + load events -> %TEMP%\multi-claude-debug.log
MULTI_CLAUDE_SHOT=C:\path\shot.png        # screenshot every view, one account page and the Add dialog
MULTI_CLAUDE_SHOT_WAIT=12000              # ms to wait on each view before capturing (default 1400)
MULTI_CLAUDE_SHOT_SIGNIN=1                # also drive the sign-in dialog with an invalid code
MULTI_CLAUDE_SHOT_CHATS=<account name>    # also open "Copy to…" on the first chat and press Copy & open for that
                                          # account (skipped if it can't be selected); name one that is NOT signed
                                          # in to Claude Code unless you want a real copy
```

`MULTI_CLAUDE_DEBUG` exists because a packaged Windows GUI app has no console to print to.
`MULTI_CLAUDE_SHOT` fronts the window before capturing — an occluded Electron window is not
recomposited, so a naive `capturePage()` returns a stale frame.

### Trying the update screens

Run from source with a pretend update (`src/main/update-demo.js`; ignored by the installed
app). Nothing is downloaded or installed: the download and install are timed stand-ins, then
Multi-Claude restarts.

```bash
MULTI_CLAUDE_UPDATE_DEMO=1        # a minor update: download, install, restart
MULTI_CLAUDE_UPDATE_DEMO=major    # the same, as a required (major) update
MULTI_CLAUDE_UPDATE_DEMO=fail     # the download fails at 60%
```

## Building

```bash
npm run dist          # Windows installer + portable
npm run dist:mac      # on a Mac
```

Run it from an ordinary PowerShell or Windows Terminal — **not** from a shell running inside
the Store version of Claude Desktop, such as an agent's shell in Claude Code's Code tab. That
shell is packaged, so Windows redirects its `%LOCALAPPDATA%` into
`%LOCALAPPDATA%\Packages\Claude_<id>\LocalCache\Local\` and reads that store layered over the
real folder. electron-builder's download cache then exists in two places at once, and a build
that succeeds in the packaged shell can fail in your own terminal.

### If the build fails on symbolic links

On a standard Windows account without Developer Mode, electron-builder cannot unpack its
code-signing toolkit, because that archive contains macOS symlinks and creating symlinks
needs a privilege the account does not hold:

```
ERROR: Cannot create symbolic link ... winCodeSign\<id>\darwin\10.12\lib\libcrypto.dylib
```

Nothing in that `darwin/` folder is used on Windows. Unpack the archive yourself without it,
once, and every later build reuses the result:

```bash
node_modules/7zip-bin/win/x64/7za.exe x -y "$LOCALAPPDATA/electron-builder/Cache/winCodeSign/<id>.7z" "-o$LOCALAPPDATA/electron-builder/Cache/winCodeSign/winCodeSign-2.6.0" "-xr!darwin"
```

Enabling Windows Developer Mode fixes it permanently instead, if you would rather do that.

## Publishing a release (maintainers)

From an ordinary terminal — not from inside Claude Desktop, see [Building](#building):

1. `npm version minor` (or `patch`) — bumps the version, commits, and tags it. Use
   `npm version major` only for a release every user must install: it locks the update
   dialog open until they do.
2. `git push origin main --follow-tags`
3. With a GitHub token that can create releases, in that terminal only:
   `$env:GH_TOKEN = "<token>"`, then `npm run release`. It builds and uploads to a draft
   release.
4. On GitHub, write the release notes (or use **Generate release notes**) and **Publish** the
   draft. Installed copies see it the next time they open.

Without a token, run `npm run dist` and upload `Multi-Claude-Setup-<version>.exe`,
`latest.yml` and the portable `.exe` to a new release by hand.

The Mac `.dmg` files are built by GitHub Actions (`.github/workflows/mac.yml`) for every
pushed version tag and attached to that release.

## Licence

By contributing you agree that your work is licensed under the [MIT Licence](LICENSE).
