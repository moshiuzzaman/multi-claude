# Multi-Claude user guide

Multi-Claude lets you keep several Claude accounts on one computer, each in its own Claude
window, and see all their usage limits in one place. This guide explains every feature in
plain steps. For a short overview, see the [README](../README.md).

> [!TIP]
> In the app, the **?** button at the top-right of every page opens this guide, the release
> notes, and forms to report a bug or suggest an idea.

## Contents

**Getting started**
- [Quick start](#quick-start)
- [Adding and signing in to an account](#adding-and-signing-in-to-an-account)
- [Opening and closing accounts](#opening-and-closing-accounts)

**Everyday use**
- [Usage limits](#usage-limits)
- [Limit alerts](#limit-alerts)
- [Usage history](#usage-history)
- [Claude Code chats](#claude-code-chats)
- [Using an account in VS Code or a terminal](#using-an-account-in-vs-code-or-a-terminal)
- [Tray icon and menu](#tray-icon-and-menu)
- [Taskbar and tray icons per account (Windows)](#taskbar-and-tray-icons-per-account-windows)

**Managing accounts**
- [Rename, colour and desktop shortcut](#rename-colour-and-desktop-shortcut)
- [One account per profile](#one-account-per-profile)
- [Deleting an account](#deleting-an-account)
- [History and Storage pages](#history-and-storage-pages)

**More**
- [Updates](#updates)
- [Help and feedback](#help-and-feedback)
- [Privacy: what Multi-Claude reads and never does](#privacy-what-multi-claude-reads-and-never-does)
- [Where things live on disk](#where-things-live-on-disk)
- [macOS](#macos)
- [Troubleshooting](#troubleshooting)
- [Known limitations](#known-limitations)
- [FAQ](#faq)

---

## Quick start

1. **Install and open Multi-Claude.** It finds Claude Desktop and adds your current Claude as
   the **Default** account. If you have a `Claude_Work` folder, it is added too, in place.
2. **Add an account:** **+ Add account** on the Dashboard, then give it a name such as
   *Work* or *Client A*.
3. **Sign in** inside the new Claude window that opens. Use your **email and the emailed code**,
   not *Continue with Google* (see [why](#adding-and-signing-in-to-an-account)).
4. **Launch** any account from its card. Each one opens in its own Claude window, signed in.
5. **Watch the Dashboard:** every card shows that account's Session and Weekly usage.

That's it. Everything below is optional.

---

## Adding and signing in to an account

1. Click **+ Add account** and type a name.
2. Multi-Claude creates a separate Claude profile for it and opens its window, with a short
   guide to the one-time sign-in.
3. In that window, enter the account's **email**, then type the **code** Claude emails you.
   **Open Gmail** in the guide opens your inbox to find it.
4. Done. From now on, **Launch** opens that account already signed in.

> [!IMPORTANT]
> **Sign in with the email code, not with Google.** A Google sign-in finishes in your browser,
> and Claude hands it to the *Default* window instead of the new one, so the new account
> stays signed out. An account created with Google works too: enter that Google email and
> use the code.

An account whose window isn't signed in shows a **Not signed in** label. **Launch** then
shows the sign-in steps again, and they are also under **Sign-in help** on the account's page.

## Opening and closing accounts

Each account has one main button that follows its state:

| The account is… | You see | What it does |
|---|---|---|
| Not running | **Launch** | Opens its Claude window |
| Running | **Show** | Brings its window to the front |
| Running | **Close** | Quits that account's Claude (asks first) |

- A green dot on an account means its window is open.
- **Close** stops anything running in that window, such as an active chat. You stay signed
  in and nothing is deleted.
- If Multi-Claude can't tell whether an account is running, it shows **Launch**. Launching
  an account that is already open just brings its window forward.

<details>
<summary>How it works: why Close is a force-quit</summary>

Claude Desktop lives in the system tray: closing its window only hides it, and a polite
`taskkill` (without `/F`) cannot make it quit. Both were tested on a throwaway profile and
the process survived each time; only `taskkill /T /F` ended it. So **Close** ends that one
account's process tree.

Finding the right process takes care, because `--user-data-dir` is not on every process: the
Default account's main process doesn't carry it, only its children do. Multi-Claude matches
any process carrying the profile's folder and walks up through `claude.exe` parents to the
root, so only that one account's Claude is ended. Afterwards it waits until a fresh process
scan agrees the account is gone, and says so if it isn't. A failed scan is never treated
as "gone".

</details>

---

## Usage limits

Every account's Dashboard card and its own page show its **Session (5 hr)** and **Weekly**
limits. You choose how fresh they are:

| Source | Set-up | Freshness | Reset times |
|---|---|---|---|
| **From Claude** (default) | Nothing: works once the account's window is signed in | A few readings a day, shown with their age (e.g. "2 hours ago") | No |
| **Live limits** (optional) | One browser sign-in per account | Up to the minute; **Refresh** for now | Yes |

### Turning on live limits

1. Click **Live limits** on an account's card or page.
2. Your browser opens. Click **Authorize** with that same account. The dialog finishes by itself.
3. If the browser shows a code instead, paste it into the dialog.

Live figures are reused for 90 seconds; **Refresh** fetches them straight away.

> [!NOTE]
> **Free plans can't have live limits.** Claude Code only signs in Pro, Max, Ultra, Team and
> Enterprise plans. Choose **It's a free plan, stop asking** (or **Free plan?** on the card),
> and Multi-Claude stops offering it. If you upgrade later, **Connect for usage limits** on the
> account's page turns it back on.

**No Claude Code on your PC?** Claude Desktop downloads its own copy the first time you open
its Code tab, and Multi-Claude uses that. If there is none, **Set up usage limits** on the
account's page downloads Anthropic's official Claude Code (about 350 MB) into Multi-Claude's
own folder. It never changes your PATH or your home folder, and it only happens when you click.

<details>
<summary>How it works: why Multi-Claude asks Claude Code instead of reading your sign-in</summary>

Claude Desktop, VS Code and the Claude Code CLI are Anthropic's own apps: when you sign in,
Anthropic hands *that app* a token. Multi-Claude could only read limits directly by taking
one of those tokens off disk, and Anthropic's Claude Code terms say developers "may not
collect, store, or intermediate Claude.ai credentials or session tokens". So it never does.

Instead, each account gets its own Claude Code folder (`%APPDATA%\multi-claude\cc\<account id>`,
passed as `CLAUDE_CONFIG_DIR`):

1. **Connect** runs Anthropic's `claude auth login` for that account, with no terminal
   window. A pasted code goes straight to Claude Code and is never stored or logged.
2. **Fetching** runs `claude -p "/usage"` hidden. `/usage` is a built-in command answered by
   Anthropic's usage service **without calling a model** (measured: $0, zero turns). Every
   meter the server reports is shown, with reset times and severity.

Safety nets, so it can never quietly spend your usage:

- Claude Code is started directly, never through a shell (Git Bash once rewrote `/usage`
  into a file path that was then sent to the model as a prompt).
- The fetch also asks for the cheapest model, a one-word system prompt and no tools.
- Every result's turn count is checked. If a fetch ever reached a model, automatic refresh
  stops for that account; only a manual **Refresh** tries again.

If `/usage` is unavailable, Multi-Claude falls back to the figures Claude Code's status line
last recorded. The newest Claude Code on the PC is used; `/usage` needs version 2.1.273 or later.

</details>

---

## Limit alerts

Multi-Claude can show a notification when an account's usage passes a level you choose,
for example *Work: Weekly at 82% · Resets Mon 09:00*. Clicking it opens that account's page.

> [!NOTE]
> Alerts only inform you. Multi-Claude never switches, launches or closes anything because
> of a limit.

**Set them up** under **Limit alerts** on the **Accounts** page:

| Setting | Default |
|---|---|
| Alert levels (any of 50–95%) | 80% and 95% |
| "Limit reached" at 100% | Always on while alerts are on |
| Also tell me when a limit resets after it was reached | Off |
| **Mute limit alerts** for one account (on its page) | Off |
| **Send a test alert** | — |

How they behave:

- **Once per level.** Each level alerts once, and again only after the limit resets and
  usage climbs past it again. A jump past several levels shows one alert, for the highest.
- **When it checks:** whenever limits refresh on screen, and every 5 minutes in the
  background while Multi-Claude runs (also from the tray). Quitting Multi-Claude stops alerts.
- **Which figures:** live limits if connected; otherwise the account's own Claude readings,
  if recent (a Session reading older than 5 hours is ignored; a Weekly one is used for a day).
- Windows **Do not disturb** hides the pop-up, but the alert still goes to the notification
  centre.

## Usage history

Each account's page has a **Usage history** panel for the last **7 or 30 days**:

- **Limit reached:** how many times Session or Weekly hit 100%, and when.
- **Busiest day:** the day Session went highest.
- **Weekly line:** every reading. Resets show as drops, and gaps without readings are dashed.
- **Session bars:** the highest reading each day (red when the limit was reached). Days
  without readings stay empty rather than showing 0%.

The readings come from the account's own Claude window and from Multi-Claude's live checks.
Multi-Claude keeps percentages and times only, for 90 days, and removes them when you delete
the account.

---

## Claude Code chats

Each account's page lists its **Claude Code chats**: the ones from its Terminal and VS Code.
The **Default** account also lists the chats in `~/.claude`, which is where plain `claude`
and Claude Desktop's **Code tab** keep theirs (tagged `~/.claude`).

Each chat shows its title, project folder, when it was last used and its size. A **green
dot** means it is open right now.

| Button | What it does |
|---|---|
| **Continue** | Opens a terminal as this account, in the chat's folder, carrying on the chat |
| **Close** (open chats only) | Ends that chat's Claude Code, after asking. The conversation so far is kept |
| **Copy to…** | Copies the chat to another account (below) |

### Copying a chat to another account

For a chat you started **in the wrong account**, for example work started in your personal
account.

1. Click **Copy to…** on the chat. (Close it first if it has a green dot.)
2. **Which account should get it?** Pick the account.
3. **Where should it show?** Tick one or both:
   - **Claude Desktop's Code tab** (ticked by default): the chat appears in that account's
     Code tab sidebar the next time its Claude window opens. That window must be **closed**
     while copying; the dialog offers a **Close** button if it is open.
   - **Terminal & VS Code**: for `claude --resume` in that account's terminal, and VS Code.
4. Click **Copy to …**. The original stays where it was.

> [!NOTE]
> - The first message in the other account re-reads the whole chat, so it uses that
>   account's usage. Earlier reasoning steps don't carry over; the conversation does.
> - The other account's own skills, MCP servers and settings apply from then on.
> - The chat's project folder must still exist on this PC.

> [!WARNING]
> Only copy chats between accounts **you own**. Copying is a manual, one-chat-at-a-time tool
> for putting work in the right account. It is not a way to keep working past a usage limit,
> and Multi-Claude never offers it for that. The copy dialog shows no usage figures for that
> reason.

When a copy is refused, the dialog says why:

| Message | What to do |
|---|---|
| *Close this chat first* | Use **Close** on the chat, or close it where it is open |
| *Close Anika's Claude window first* | Close that account's window (the dialog has a button) |
| *That account's Claude window has no Code-tab chats yet* | Open its Code tab once, then copy again |
| *… isn't signed in to Claude Code yet* | Sign it in from its page (**Live limits**), then copy again |
| *The chat's project folder … is not on this PC* | The chat can only continue in its own folder |
| *This chat's format isn't supported yet* | Claude Code changed its format; nothing was changed |

<details>
<summary>How it works</summary>

- A **Terminal & VS Code** copy goes into the account's own Claude Code folder
  (`%APPDATA%\multi-claude\cc\<account id>`): the chat file, its sub-folder, and its
  file-history, todos and tasks. Paths inside it are updated. Everything is copied first and
  the chat file lands last, so Claude Code never sees half a chat; any failure removes what
  was written.
- A **Code tab** copy is saved in `~/.claude` under a new chat id (two Claude windows never
  share one file), and one small entry is added to that account's Code-tab list in its
  Claude profile (`claude-code-sessions`). Its format is taken from that profile's own
  newest entry, and the copy is refused if that entry doesn't look as expected.
- **Close** checks that the chat's process is still Claude Code before ending it, so a stale
  record can never close something else.

</details>

---

## Using an account in VS Code or a terminal

- **Use in VS Code** switches the Claude Code extension in your normal VS Code to that
  account. No second window, no new sign-in. Every open VS Code window follows it, so
  **one account at a time**.
- **Terminal** opens a console running Claude Code as that account, without touching VS Code.

If VS Code isn't running, **Use in VS Code** starts it. Deleting the account VS Code is using
puts VS Code back on your plain `~/.claude`.

<details>
<summary>How it works</summary>

**Use in VS Code** writes that account's `CLAUDE_CONFIG_DIR` into your own
`%APPDATA%\Code\User\settings.json`, as `claudeCode.environmentVariables`, between comment
markers. The extension watches that setting and switches in place.

- Only the text between the markers is ever replaced, and a timestamped `.bak` is saved
  first (the newest three are kept).
- If `settings.json` is a symlink (a dotfiles setup), the real file is changed and the link kept.
- If you set `claudeCode.environmentVariables` yourself outside the markers, yours wins and
  the button tells you.

**Terminal** passes the account to that one process only, so it never changes the setting.

</details>

## Tray icon and menu

Multi-Claude has an icon in the Windows tray (the Mac menu bar).

- **Closing the window keeps it running in the tray**, so alerts and history keep working.
  To make closing quit instead, turn off *Keep running in the tray when the window is closed*
  on the **Accounts** page.
- **Windows:** click the icon to open the window; right-click for the menu.
  **Mac:** click for the menu.
- **The menu** lists every account with its figures, for example `● Work  S 37% · W 66%`, and
  **Launch**, **Show**, **Close** and **Open its page** for each. Then **Open Multi-Claude**,
  **Check for updates** and **Quit Multi-Claude**.

> [!TIP]
> A new tray icon starts in Windows' hidden icons (**^**). Drag it onto the taskbar to keep it
> in view.

## Taskbar and tray icons per account (Windows)

Normally every Claude window shares one taskbar button, so accounts look the same. Multi-Claude
gives each **added** account:

- **its own taskbar button**, in the account's colour with its first letter, named
  *Claude - Work*, and pinnable;
- **its own tray icon** with that letter (the Default account's too).

Turn this off on the **Accounts** page (**Account icons on the taskbar and in the tray**).
Not available on a Mac.

<details>
<summary>How it works</summary>

Multi-Claude sets four standard Windows shell properties on the account's Claude windows from
outside (`System.AppUserModel.ID` and the relaunch icon, name and command), and changes the
tray icon with the shell's own `Shell_NotifyIcon` call. Nothing inside Claude is changed or
read. Claude or a restart of Explorer can reset the tray icons, so the 5-minute background
check puts them back. Right-clicking such a taskbar button shows Multi-Claude's pin rather
than Claude's own menu.

</details>

---

## Rename, colour and desktop shortcut

On an account's page:

- **Rename** changes its name in Multi-Claude. The folder on disk keeps its original name.
- **Colour** sets the colour of its card, letter icon and taskbar button.
- **Shortcut** puts *Claude - Work* on your Desktop. It opens that account directly, without
  the Multi-Claude window, and keeps working after Claude updates.

## One account per profile

Each profile should be signed in to a different Claude account. Multi-Claude warns you when
that isn't so:

- **Same account as Work:** two profiles are signed in to the same Claude account. Sign out
  in one of them and sign in with another account, or delete the extra profile.
- **Different account:** a profile is now signed in to a different account than before.
  Choose **Keep this account** if that's on purpose; otherwise sign back in with the old one.

<details>
<summary>How it knows</summary>

Claude records the signed-in account's id in the profile's `config.json`
(`lastKnownAccountUuid`: an id, not a token or password). Multi-Claude reads that one value
and keeps only a one-way fingerprint of it (`accountKey` in `accounts.json`). The id itself
is never saved, shown or sent anywhere.

</details>

## Deleting an account

**Delete** on an account's page erases the **profile folder on this PC**: its local login and
cached data. You type the account's name to confirm.

> [!NOTE]
> Your Anthropic account is **not** deleted. Cancel a subscription or close an account with
> Anthropic directly.

Delete is refused for the Default account, while the account's window is open, for a folder
that is a junction or symbolic link, for a path too close to a drive root, and for a folder
outside `%USERPROFILE%\ClaudeProfiles` unless you tick the unlock box.

**Folder already gone?** If you removed a profile folder by hand, the account shows *folder
missing*. Use **Remove from list** (on its card) or **Forget** (in the Accounts list). Nothing
on disk is touched.

## History and Storage pages

- **History** shows when each account was open and for how long, as seen by Multi-Claude.
  An account opened while Multi-Claude was closed is counted from when Multi-Claude next opens.
- **Storage** shows how much disk each profile uses. The first measurement takes a few
  seconds; results are reused for 10 minutes. **Recalculate** measures again. An account's
  page can also **Clear cache**, which is safe: Claude rebuilds it on its next launch.

---

## Updates

Multi-Claude checks for new versions when it starts, every 4 hours, when its window is
reopened from the tray, and when you click ↻ at the bottom of the sidebar or **Check for
updates** in the tray menu.

When a new version is out, a dialog shows what's new.

| Update type | Example | What you can do |
|---|---|---|
| **Minor** | 1.2.0 → 1.3.0 | **Update**, or **Later** (it asks again next time the window opens) |
| **Major** | 1.x → 2.0.0 | **Update** or **Quit Multi-Claude**; the dialog can't be dismissed |

**Update** downloads the new installer, checks it against the release's published size and
SHA-512, installs it silently and restarts Multi-Claude. A download that doesn't match is
deleted and never run. Your accounts and settings are kept, and Claude windows you opened
keep running.

- Nothing is ever downloaded without your click.
- **Portable build:** **Update** opens the download page instead.
- **Run from source:** update with `git pull`.

## Help and feedback

The **?** button at the top-right of every page opens:

| Item | Opens |
|---|---|
| **Report a bug** | A short GitHub form, with your version and computer already filled in |
| **Suggest an idea** | A short GitHub form, with your version filled in |
| **Guide** | This page |
| **What's new** | The release notes, inside the app |

> [!TIP]
> GitHub issues are public. Hide emails and account names in screenshots before you attach
> them.

---

## Privacy: what Multi-Claude reads and never does

**It never:**
- handles a password, sign-in token or API key;
- copies or exports a sign-in;
- switches accounts automatically, pools accounts or picks the "next available" one;
- sends your data anywhere. The only network calls are update checks to GitHub, and
  Anthropic's own Claude Code when you turn on live limits.

**It reads only:**
- the *names* of settings in a profile's `config.json` (to tell whether it's signed in), and
  the account id there, kept only as a one-way fingerprint;
- the usage percentages in a profile's `plan-usage-history.json`;
- for **Claude Code chats**: each chat's title, folder, date and size, and a chat's own files
  when you copy it.

## Where things live on disk

| What | Where |
|---|---|
| New profiles | `%USERPROFILE%\ClaudeProfiles\<name>` |
| Imported `Claude_Work` | Left where it is |
| Default account | `%LOCALAPPDATA%\Claude-Data\<package family>` |
| Account list and settings | `%APPDATA%\multi-claude\accounts.json` |
| Each account's Claude Code (sign-in, chats) | `%APPDATA%\multi-claude\cc\<account id>` |
| Plain `claude` and Code-tab chats | `%USERPROFILE%\.claude` |
| Launch history | `%APPDATA%\multi-claude\activity.jsonl` |
| Usage history (percentages and times, 90 days) | `%APPDATA%\multi-claude\usage-history.jsonl` |
| Alerts already shown | `%APPDATA%\multi-claude\alert-state.json` |
| Storage cache | `%APPDATA%\multi-claude\storage-cache.json` |
| VS Code's active account | `%APPDATA%\Code\User\settings.json` (a marked block) |
| Claude Code downloaded by Multi-Claude (only if you clicked) | `%APPDATA%\multi-claude\claude-code\<version>\claude.exe` |
| Status-line recorder (live-limits fallback) | `%APPDATA%\multi-claude\limits-recorder.ps1` |
| A downloaded update, until the next launch | `%TEMP%\multi-claude-update` |

`accounts.json` holds names, folder paths and ids, never credentials. The cache files are
safe to delete; they are rebuilt. The `cc\<account id>` folders belong to Anthropic's Claude
Code: Multi-Claude creates them and deletes them with the account, but never reads the
sign-in inside.

---

## macOS

Download `Multi-Claude-<version>-arm64.dmg` (Apple Silicon) or `-x64.dmg` (Intel) from the
[releases page](https://github.com/moshiuzzaman/multi-claude/releases), or build it on a Mac
with `npm run dist:mac`.

> [!IMPORTANT]
> The app isn't signed with an Apple Developer ID, so macOS blocks it the first time.
> **Right-click the app → Open → Open.** On recent macOS: **System Settings → Privacy &
> Security → Open Anyway.**

| | Windows | Mac |
|---|---|---|
| Claude | `claude.exe` (Store or classic) | `Claude.app` |
| Open an account | `claude.exe --user-data-dir=…` | `open -n -a Claude.app --args --user-data-dir=…` |
| Close | Ends that account's process tree | Asks it to quit, then ends what's left |
| Default profile | `%LOCALAPPDATA%\Claude-Data\…` | `~/Library/Application Support/Claude` |
| Desktop shortcut | `.lnk` | A small `.app` |
| Updating | In-app installer | **Update** opens the release page |
| Taskbar icons per account | Yes | No |

> [!WARNING]
> **The Mac version hasn't been tried on a real Mac yet.** Its parts are covered by tests, but
> the first thing to check is whether Claude for Mac keeps a separate profile per
> `--user-data-dir`. If you have a Mac, trying it is the most useful contribution you could make.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| A new account shows **Get started** every time it opens | It was signed in with Google. Sign in with the **email code** instead ([why](#adding-and-signing-in-to-an-account)) |
| An account shows **Not signed in** | Click **Launch** and follow the steps, or **Sign-in help** on its page |
| Two cards show the same usage | Both profiles use the same Claude account. See [One account per profile](#one-account-per-profile) |
| Usage says "2 hours ago" | That's the newest reading Claude recorded. Turn on [live limits](#turning-on-live-limits) for up-to-the-minute figures |
| **Live limits** isn't offered | The account is marked as a free plan. Use **Connect for usage limits** on its page if you upgraded |
| No limit alerts | Check **Limit alerts** is on (Accounts page), the account isn't muted, and Windows **Do not disturb** is off |
| The tray icon is missing | Look under Windows' hidden icons (**^**) and drag it onto the taskbar |
| A copied chat isn't in the other account's Code tab | Restart that account's Claude window; the list is read when it opens |
| **Close** says the account is still running | Wait a few seconds and try again; Claude may be finishing something |
| Accounts or settings look empty after starting Multi-Claude from inside Claude | Start Multi-Claude from the Start Menu or Explorer instead ([why](#known-limitations)) |

Still stuck? Use **? → Report a bug**. For a detailed log, start Multi-Claude with
`MULTI_CLAUDE_DEBUG=1` set; it writes `%TEMP%\multi-claude-debug.log`.

## Known limitations

- **Windows and macOS only**, and the Mac version is untested on a real Mac.
- **Sign in to added accounts with the email code, not Google.** Claude Desktop registers its
  `claude://` sign-in link without a profile folder, so a sign-in that finishes in the browser
  goes to the Default window. Multi-Claude doesn't reroute that link, because it carries a
  sign-in code and Multi-Claude never handles credentials.
- **Links open in the Default window.** `claude://` links and some notifications reach the
  Default account, because added accounts run without the Store app's package identity.
- **Start Multi-Claude yourself, not from inside Claude Desktop.** If it is started by
  something running inside the Store version of Claude (for example Claude Code in the Code
  tab), Windows redirects its `%APPDATA%` into Claude's package folder
  (`%LOCALAPPDATA%\Packages\Claude_<id>\LocalCache\Roaming\`). Its accounts and history then
  live there, and **Use in VS Code** writes a file your VS Code never reads.
- **Desktop shortcuts** use the Multi-Claude icon, not Claude's.
- An account on an employer's email domain may be managed by that organisation's admin;
  Multi-Claude doesn't change that.

If Anthropic ships multi-account support in Claude Desktop itself, use that instead.

## FAQ

**Is this against Anthropic's terms?**
Owning more than one Claude account is allowed; using several to get around usage limits is
not. Multi-Claude opens Anthropic's own app with a standard Electron option, never handles a
credential, and leaves out every feature that would pool or multiply usage. Use it for
accounts you own.

**Does it need my password or an API key?**
No. You sign in inside Claude's own window, exactly as without Multi-Claude.

**Will it slow my computer down?**
Each account is a full Claude Desktop, so three open accounts cost about what three Claudes
cost. Open only what you need; **Close** frees an account's memory.

**Does deleting an account delete my Claude account?**
No. It deletes the profile folder on this PC only.

**Can I use it with Claude Code or VS Code?**
Yes. [Use in VS Code](#using-an-account-in-vs-code-or-a-terminal) switches the editor to one
account, **Terminal** opens Claude Code as an account, and
[Claude Code chats](#claude-code-chats) lists, continues and copies chats.

**Can I move a chat to another account?**
A Claude Code chat, yes: see [Copying a chat](#copying-a-chat-to-another-account). Normal
claude.ai chats live on Anthropic's servers and can't be moved.

**Something broke. What do I do?**
Use **? → Report a bug** in the app. A sentence or two is enough.
