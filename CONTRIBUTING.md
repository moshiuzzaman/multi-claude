# Contributing to Multi-Claude

Thanks for being here! Bug reports, ideas, fixes, translations and real-world testing are all
welcome, and you don't need to write code to help.

## Contents

- [Ways to help](#ways-to-help)
- [Project rules](#project-rules)
- [How features get built](#how-features-get-built)
- [Development](#development)
- [Project structure](#project-structure)
- [Debugging](#debugging)
- [Building](#building)
- [Pull request checklist](#pull-request-checklist)
- [Publishing a release (maintainers)](#publishing-a-release-maintainers)
- [Licence](#licence)

---

## Ways to help

| You can… | How |
|---|---|
| 🐞 **Report a bug** | In the app: **? → Report a bug**. Or [open a bug report](https://github.com/moshiuzzaman/multi-claude/issues/new?template=bug_report.yml). A sentence or two is enough. |
| 💡 **Suggest an idea** | In the app: **? → Suggest an idea**. Or [open an idea](https://github.com/moshiuzzaman/multi-claude/issues/new?template=feature_request.yml). |
| 🍎 **Try it on a Mac** | The Mac build has never run on real hardware. See [macOS](docs/GUIDE.md#macos) for what to check first. **The most useful thing anyone can do right now.** |
| 🖼️ **Add screenshots** | The README has none yet. [`MULTI_CLAUDE_SHOT`](#debugging) captures every view. |
| 🛠️ **Build a feature** | Pick an [open idea](https://github.com/moshiuzzaman/multi-claude/issues?q=is%3Aissue+is%3Aopen+label%3Aenhancement). Comment on its issue first so we can agree the approach. |
| 📝 **Improve the docs** | Anything in the README, [guide](docs/GUIDE.md) or a dialog that didn't explain itself is a bug. |

> [!TIP]
> New here? Start with a bug report, a doc fix or a Mac test. They need no setup.

---

## Project rules

These are **permanent product decisions**, not missing features. A pull request that breaks
one will be declined, however well it's built.

| # | Rule | Why |
|---|---|---|
| 1 | **No automatic switching** when an account hits a limit | It would get around usage limits |
| 2 | **No pooling, "next available account" or failover** | Same |
| 3 | **No parallel or batched launching** to multiply quota | Same |
| 4 | **No moving a conversation to another account to keep working past a limit** | Same (one narrow exception below) |
| 5 | **No handling of credentials:** no reading, copying, exporting or backing up sign-ins | Anthropic's terms forbid it |
| 6 | **No reading files inside a profile** beyond setting *names* in `config.json`, the account id kept as a one-way fingerprint, and the percentages in `plan-usage-history.json` | Privacy |
| 7 | **Never modify, patch or repack Claude Desktop** | It must stay Anthropic's own app |

Owning several Claude accounts is fine. Using them to get around usage limits is not, and
that is exactly what Anthropic's enforcement targets. These rules keep Multi-Claude on the
right side of that line.

> [!NOTE]
> **The one exception: copying a chat started in the wrong account** ([Copy a chat to another account](docs/FEATURES.md#-claude-code)).
> A Claude Code chat may be copied **by hand, one at a time**, to another account the user
> owns. For that feature only, Multi-Claude may:
> - list chats (title, folder, date, size) and copy a chat's own files inside its own `cc`
>   folders, and for the Default account from `~/.claude`. Copies always land in a `cc` folder,
>   or in `~/.claude` for the Code tab;
> - add **one** chat-list entry to the target profile's `claude-code-sessions` folder, so the
>   copy shows in Claude Desktop's Code tab, and only while that account's window is closed.
>
> It must **never** show usage figures, suggest an account by usage, or be offered when a
> limit is reached.

---

## How features get built

Every new feature follows the same path, and pull requests should too:

1. **Start from an issue.** Pick an [open idea](https://github.com/moshiuzzaman/multi-claude/issues?q=is%3Aissue+is%3Aopen+label%3Aenhancement), or open one describing the
   feature.
2. **Study similar tools** that already do it: their docs, their code, and their issues, which
   show what went wrong for them.
3. **Compare the approaches** in a short table: pros, cons, and whether each fits the
   [rules](#project-rules).
4. **Agree the approach** in the issue before building.
5. **Build it, with tests.**
6. **Check it in the real app**, not only in unit tests, and say what you checked in the pull
   request.

> [!IMPORTANT]
> **Learn ideas, don't copy code.** Write Multi-Claude's own code. Code from MIT-licensed
> projects may be reused only with its licence notice kept. Never copy from AGPL, unlicensed
> or closed-source projects.

---

## Development

**You need:** [Node.js 22+](https://nodejs.org) and Claude Desktop.

```bash
git clone https://github.com/moshiuzzaman/multi-claude.git
cd multi-claude
npm install
```

| Command | What it does |
|---|---|
| `npm test` | Runs the unit tests (no Electron needed) |
| `npm run build:renderer` | Builds the window's UI |
| `npm start` | Builds the UI and opens the app |

> [!WARNING]
> Only one copy of Multi-Claude can run at a time. **Quit the installed one from its tray
> icon** before `npm start`, or it just brings the installed app to the front.

## Project structure

| Folder | What's in it |
|---|---|
| `src/main/` | The main process: every file path, finding `claude.exe`, process scans, launching, closing, deleting, updates |
| `src/preload/` | The bridge between the window and the main process |
| `src/renderer/` | The window: React + Vite |
| `test/` | Unit tests (`node --test`) |
| `docs/` | The user [guide](docs/GUIDE.md) and the [feature list](docs/FEATURES.md) |
| `.github/` | Issue forms and the Mac build workflow |

**Security model:** the window runs sandboxed with `contextIsolation` on. It talks to the main
process only through the preload bridge, which passes account **ids**, never file paths. The
UI is served over a custom `app://` protocol, so the Content-Security-Policy stays at `'self'`.

> [!NOTE]
> `src/main/usage-reader.js`, `usage-aggregate.js` and `account-info.js` (and their tests) are
> no longer used by the UI. They powered removed views that merged usage across accounts, and
> are safe to delete together with their IPC channels.

## Debugging

Set these environment variables before `npm start`:

| Variable | What it does |
|---|---|
| `MULTI_CLAUDE_DEBUG=1` | Writes the window's console and load events to `%TEMP%\multi-claude-debug.log` (a packaged Windows app has no console) |
| `MULTI_CLAUDE_SHOT=C:\path\shot.png` | Screenshots every view, one account page and the Add dialog |
| `MULTI_CLAUDE_SHOT_WAIT=12000` | How long to wait on each view before capturing, in ms (default 1400) |
| `MULTI_CLAUDE_SHOT_SIGNIN=1` | Also walks the sign-in dialog with a deliberately invalid code |
| `MULTI_CLAUDE_SHOT_CHATS=<account name>` | Also opens **Copy to…** on the first chat, picks that account and captures the dialog. Never presses Copy |

**Trying the update screens** with a pretend update. Nothing is downloaded or installed:

| Variable | Shows |
|---|---|
| `MULTI_CLAUDE_UPDATE_DEMO=1` | A minor update: download, install, restart |
| `MULTI_CLAUDE_UPDATE_DEMO=major` | The same, as a required (major) update |
| `MULTI_CLAUDE_UPDATE_DEMO=fail` | A download that fails at 60% |

These work only when running from source; the installed app ignores them.

## Building

```bash
npm run dist          # Windows installer + portable .exe
npm run dist:mac      # on a Mac
```

> [!WARNING]
> **Build from an ordinary PowerShell or Windows Terminal**, not from a shell running inside the
> Store version of Claude Desktop (such as Claude Code in its Code tab). That shell is
> packaged, so Windows redirects `%LOCALAPPDATA%` into Claude's own package folder, and a build
> that works there can fail in your own terminal.

<details>
<summary><strong>Build fails with "Cannot create symbolic link … libcrypto.dylib"?</strong></summary>
<br>

On a Windows account without Developer Mode, electron-builder can't unpack its code-signing
toolkit, because the archive contains macOS symlinks:

```
ERROR: Cannot create symbolic link ... winCodeSign\<id>\darwin\10.12\lib\libcrypto.dylib
```

Nothing in that `darwin/` folder is used on Windows. Unpack the archive once without it, and
later builds reuse the result:

```bash
node_modules/7zip-bin/win/x64/7za.exe x -y "$LOCALAPPDATA/electron-builder/Cache/winCodeSign/<id>.7z" "-o$LOCALAPPDATA/electron-builder/Cache/winCodeSign/winCodeSign-2.6.0" "-xr!darwin"
```

Or turn on Windows **Developer Mode**, which fixes it for good.

</details>

---

## Pull request checklist

Before you open a pull request:

- [ ] It keeps every [project rule](#project-rules).
- [ ] `npm test` passes, and new behaviour has tests.
- [ ] You tried it in the real app (`npm start`) and say what you checked in the PR.
- [ ] User-facing changes are in the [guide](docs/GUIDE.md), and new features are listed in [FEATURES.md](docs/FEATURES.md).
- [ ] No code copied from AGPL, unlicensed or closed-source projects.
- [ ] No emails, account names or personal paths in screenshots, logs or test data.

---

## Publishing a release (maintainers)

From an ordinary terminal (see [Building](#building)):

1. **Bump the version:** `npm version minor` (or `patch`). This commits and tags it.
   Use `npm version major` only for a release every user must install: it keeps the update
   dialog open until they do.
2. **Push:** `git push origin main --follow-tags`
3. **Build and upload:** with a GitHub token that can create releases, in that terminal only:
   ```powershell
   $env:GH_TOKEN = "<token>"
   npm run release
   ```
   This builds and uploads to a **draft** release.
4. **Publish:** on GitHub, write the release notes (or **Generate release notes**) and click
   **Publish**. Installed copies see it the next time they open.

No token? Run `npm run dist` and upload `Multi-Claude-Setup-<version>.exe`, `latest.yml` and
the portable `.exe` to a new release by hand.

The Mac `.dmg` files are built by GitHub Actions (`.github/workflows/mac.yml`) for every pushed
version tag, and attached to that release automatically.

---

## Licence

By contributing, you agree that your work is licensed under the [MIT Licence](LICENSE).
