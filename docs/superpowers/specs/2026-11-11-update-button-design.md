# In-app updates — Design

**Status:** approved 2026-11-11.

**Goal:** when a newer Multi-Claude has been published, the app says so the
moment it opens, shows what changed, and installs it with one click. When there
is nothing new, it says everything is up to date and offers no button.

## 1. How it behaves

Updates come from **GitHub Releases** on `moshiuzzaman/multi-claude`, which is
public. Multi-Claude checks once each time it opens. It never downloads or
installs without a click.

The line under "Not affiliated with, or endorsed by, Anthropic." in the sidebar
footer shows the state:

| State | Footer line |
|---|---|
| Just opened | `Checking for updates…` |
| Nothing newer published | `v1.1.0 · Everything is up to date` — no button |
| Newer version published | `v1.3.0 available` · **What's new** · **Update** |
| Downloading | `Downloading v1.3.0… 42%` |
| Installing | `Installing — Multi-Claude will restart` |
| Check failed | `v1.1.0 · Couldn't check for updates` · **Retry**, reason on hover |
| Download or install failed | `Update failed` · **Retry**, reason on hover |

**Update** downloads the installer, verifies it, runs it silently and quits.
The installer replaces the app and starts the new version. Accounts, sign-ins
and settings live in `%APPDATA%` and are kept.

**What's new** opens a dialog listing every published version newer than the
running one, newest first, each with its date and its GitHub release notes. The
dialog has its own **Update** button. Notes are rendered as plain text, with
headings and bullet points kept by simple line rules; nothing in a release note
is ever rendered as HTML. If the notes cannot be loaded, the dialog says so and
links to the releases page; updating still works.

Two ways of running cannot install over themselves:

- **From source** (`start.cmd`, `npm start`): the check still runs, and an
  available update reads `v1.3.0 available — update with git pull`. No Update
  button, since installing would replace the installed copy, not this one.
- **Portable build**: **Update** opens the release page so the new portable
  file can be downloaded. A running portable executable cannot replace itself.

## 2. Where the facts come from

**The update check** reads one small file. electron-builder writes `latest.yml`
next to the installer on every build once `build.publish` is set, holding the
version, the installer's file name, its size and its SHA-512. GitHub serves the
newest release's copy at a fixed address:

```
https://github.com/<owner>/<repo>/releases/latest/download/latest.yml
```

No API, no token, no rate limit. The installer is then
`https://github.com/<owner>/<repo>/releases/download/v<version>/<path>`.

**The changelog** comes from GitHub's releases list, fetched only once an
update has been found:

```
https://api.github.com/repos/<owner>/<repo>/releases?per_page=30
```

Drafts and prereleases are dropped, and so is anything not newer than the
running version. Unauthenticated requests allow 60 an hour per IP; this makes at
most one per launch. Requests carry a generic `User-Agent: Multi-Claude-updater`
and nothing about the user.

`<owner>` and `<repo>` are read from `build.publish` in `package.json` — the
same entry electron-builder publishes to, so they cannot drift apart.

## 3. Architecture

### 3.1 `src/main/updater.js` (new)

Pure logic with injected I/O, so it tests under `node --test` with no Electron
and no network.

- `parseLatestYml(text) -> { version, path, sha512, size } | null` — reads those
  four keys line by line. Not a general YAML parser; tolerates CRLF and quoted
  values; `null` when any is missing.
- `isNewer(a, b) -> boolean` — numeric `major.minor.patch` comparison, leading
  `v` ignored, so `1.10.0` is newer than `1.9.2`. A prerelease suffix never
  counts as newer.
- `safeAssetName(name) -> boolean` — rejects anything containing `/`, `\` or
  `..`; the file name from `latest.yml` is the only part of the download URL
  not built from configuration.
- `parseReleases(json, currentVersion) -> [{ version, date, notes, url }]` —
  newer, non-draft, non-prerelease releases, newest first.
- `createUpdater({ fetchText, fetchJson, download, spawn, quit, openExternal,
  currentVersion, mode, repo, tmpDir }) -> { check(), install(), status(),
  changelog() }` — a small state machine:
  `idle → checking → (current | available | check-failed)`,
  `available → downloading → installing`, any step `→ failed`.
  A second `install()` while one is running is ignored.

`mode` is `'source'` when Electron reports the app is not packaged,
`'portable'` when `PORTABLE_EXECUTABLE_FILE` is set, otherwise `'installed'`.

### 3.2 Download

Node `https`, following up to five redirects (GitHub hands assets off to its
CDN). Streams to a fresh file in `%TEMP%\multi-claude-update\`, hashing as it
writes and reporting progress from `content-length`. Size and SHA-512 must both
match `latest.yml`; on any mismatch the file is deleted and never run. A stall
of 60 seconds aborts. Installers left in that folder are deleted on the next
start.

### 3.3 Install

```
spawn(installer, ['/S', '--updated', '--force-run'], { detached: true, stdio: 'ignore' }).unref()
quit()
```

Launched directly, never through a shell. These are the flags electron-builder's
own updater uses: its NSIS script (`installSection.nsh`) installs silently and,
on `--force-run` with `/S`, starts the app again afterwards.

### 3.4 Wiring

`main.js` creates the updater and calls `check()` once the window is ready.
Four IPC channels, following the existing `loginStatus` pattern:

- `updateStatus` — the current state; the footer polls it while checking or
  downloading.
- `updateCheck` — check again, for the Retry link.
- `updateInstall` — start the download and install.
- `updateChangelog` — the release notes for the dialog.

The preload bridge passes no paths or URLs, only these calls.

### 3.5 UI

A `UpdateFoot` component in the sidebar footer, and a `WhatsNew` dialog using
the app's existing dialog styling. No new dependency.

## 4. Publishing a release

One-time `package.json` changes:

- `build.publish`: `{ "provider": "github", "owner": "moshiuzzaman", "repo": "multi-claude" }`.
- Space-free artifact names, because GitHub rewrites spaces in asset names and
  they would stop matching `latest.yml`: installer
  `Multi-Claude-Setup-${version}.${ext}`, portable
  `Multi-Claude-${version}-portable.${ext}`.
- A `release` script: `npm run build:renderer && electron-builder --publish always`,
  which uploads to a draft release.

Each new version, from an ordinary terminal (not Claude Desktop, per the README):

1. `npm version minor` — bumps, commits and tags `v1.3.0`.
2. `git push origin main --follow-tags`.
3. With `GH_TOKEN` set in that terminal only, `npm run release`.
4. On GitHub, write or generate the release notes and **Publish** the draft.

Without a token: `npm run dist`, then upload the Setup `.exe`, `latest.yml` and
the portable `.exe` to a new release by hand.

**The first update cannot come through the button**: 1.1.0 has no updater. The
version that adds it is installed by hand once; every later one arrives through
the button.

## 5. Error handling

| Case | Behaviour |
|---|---|
| Offline, or no answer in 15 s | `Couldn't check for updates` · Retry |
| `latest.yml` not found (nothing published yet) | `Everything is up to date`; hover says no release is published yet |
| `latest.yml` malformed or unsafe file name | Check fails: "The latest release has no valid update file." |
| Download stalls 60 s, or the disk is full | `Update failed`; the partial file is deleted |
| Size or SHA-512 mismatch | File deleted, never run: "The download was damaged; nothing was installed." |
| Installer will not start | `Update failed`; Multi-Claude stays open |
| Changelog cannot be loaded | Dialog says so and links to the releases page; Update still works |
| Latest is older than or equal to the running version | Treated as up to date — never a downgrade |

To be confirmed while planning: closing Multi-Claude for an update must not
close any Claude window it launched. If it would, the Update button warns first.

## 6. Testing

`node --test`, no Electron, no internet.

- `parseLatestYml` — a real electron-builder sample, CRLF, quoted values, each
  missing field.
- `isNewer` — `1.10.0` vs `1.9.2`, equal versions, leading `v`, prerelease.
- `safeAssetName` — slashes, backslashes, `..`.
- `parseReleases` — filters drafts, prereleases and older versions; orders
  newest first.
- `createUpdater` with fakes — up to date; available; no release published;
  check failure; download progress; checksum mismatch deletes and fails;
  install spawns exactly `/S --updated --force-run` without a shell, then
  quits; source mode never installs; portable mode opens the release page;
  a second install while busy is ignored.
- The downloader against a local HTTP server on `127.0.0.1`, including a
  redirect.

By hand, the only end-to-end proof: publish 1.2.0 and install it manually,
publish a small 1.2.1, then click Update and watch 1.2.1 install and reopen.
Also confirm then whether SmartScreen warns on the silent install — it likely
does not, since the app downloads the file itself and no browser marks it.

## 7. Out of scope

- Background or scheduled checks after launch.
- Automatic download without a click.
- Code signing.
- Differential (block-map) downloads.
- Release channels or prereleases.
