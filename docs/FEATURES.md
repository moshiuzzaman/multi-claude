# Multi-Claude features

What Multi-Claude can do today, and what's coming next. For step-by-step help with any
feature, see the [user guide](GUIDE.md).

> [!TIP]
> Have an idea? In the app, click **?** → **Suggest an idea**, or
> [open an idea on GitHub](https://github.com/moshiuzzaman/multi-claude/issues/new?template=feature_request.yml).

## Contents

- [Available now](#available-now)
- [Coming next](#coming-next)
- [Being explored](#being-explored)
- [Not planned](#not-planned)

---

## Available now

### Accounts

| Feature | What it does | Learn more |
|---|---|---|
| **Several Claude accounts** | Each account runs in its own Claude Desktop window, side by side, signed in | [Adding an account](GUIDE.md#adding-and-signing-in-to-an-account) |
| **One smart button** | **Launch**, **Show** or **Close**, depending on whether the account is open | [Opening and closing](GUIDE.md#opening-and-closing-accounts) |
| **Colour per account** | Pick a colour for each account's card, letter icon and taskbar button | [Rename, colour, shortcut](GUIDE.md#rename-colour-and-desktop-shortcut) |
| **Desktop shortcuts** | Open an account straight from your Desktop | [Rename, colour, shortcut](GUIDE.md#rename-colour-and-desktop-shortcut) |
| **Wrong-account warning** | Tells you when two profiles are signed in to the same Claude account | [One account per profile](GUIDE.md#one-account-per-profile) |
| **Safe delete** | Removes an account's folder from this PC only, with several safety checks | [Deleting an account](GUIDE.md#deleting-an-account) |

### Usage

| Feature | What it does | Learn more |
|---|---|---|
| **Usage limits per account** | Session and Weekly usage on every card, with no extra sign-in | [Usage limits](GUIDE.md#usage-limits) |
| **Live limits** *(optional)* | Up-to-the-minute figures with reset times | [Turning on live limits](GUIDE.md#turning-on-live-limits) |
| **Limit alerts** | A notification when an account passes a level you choose | [Limit alerts](GUIDE.md#limit-alerts) |
| **Usage history** | Charts of the last 7 or 30 days, and when limits were reached | [Usage history](GUIDE.md#usage-history) |
| **History and Storage** | How long each account was open, and how much disk it uses | [History and Storage](GUIDE.md#history-and-storage-pages) |

### Claude Code

| Feature | What it does | Learn more |
|---|---|---|
| **Use in VS Code** | Switches VS Code's Claude Code to an account, with no new sign-in | [VS Code and terminal](GUIDE.md#using-an-account-in-vs-code-or-a-terminal) |
| **Terminal** | Opens Claude Code as an account | [VS Code and terminal](GUIDE.md#using-an-account-in-vs-code-or-a-terminal) |
| **Claude Code chats** 🆕 | See each account's chats; continue or close them | [Claude Code chats](GUIDE.md#claude-code-chats) |
| **Copy a chat to another account** 🆕 | Move a chat you started in the wrong account to the right one, for its terminal, VS Code or Claude Desktop's Code tab | [Copying a chat](GUIDE.md#copying-a-chat-to-another-account) |

### Windows and the app

| Feature | What it does | Learn more |
|---|---|---|
| **Taskbar button per account** | Each account gets its own taskbar button and tray icon, in its colour | [Taskbar and tray icons](GUIDE.md#taskbar-and-tray-icons-per-account-windows) |
| **Tray icon and menu** | Every account's usage and quick actions, even with the window closed | [Tray icon and menu](GUIDE.md#tray-icon-and-menu) |
| **In-app updates** | Shows what's new and updates with one click | [Updates](GUIDE.md#updates) |
| **Help and feedback** 🆕 | The **?** button on every page: report a bug, suggest an idea, open this guide | [Help and feedback](GUIDE.md#help-and-feedback) |
| **Mac version** *(preview)* | A Mac build is available but hasn't been tried on a real Mac yet | [macOS](GUIDE.md#macos) |

---

## Coming next

Planned, roughly in this order. Nothing here has a date yet.

| Feature | What it will do |
|---|---|
| **Claude status badge** | A small badge when Claude itself has an outage, so you know it isn't your account |
| **Google sign-in on Mac** | Sign in to an added account with Google on a Mac |
| **Memory use and idle close** | See how much memory each open account uses; optionally close idle ones |
| **Pace and offline view** | "On pace" or "ahead of pace" next to each limit, and the last figures when you're offline |
| **Start with the computer** | Open Multi-Claude quietly in the tray when you sign in to Windows or macOS |
| **Settings backup** | Automatic backups of your accounts list, plus export and import for a new PC |
| **More languages** | Bangla first, then others |
| **PIN lock** | An optional PIN to open Multi-Claude on a shared computer |
| **Launcher links** | `multi-claude://` links to open an account from other apps and launchers |
| **Command-line status** | `Multi-Claude.exe --status --json` for scripts and status bars |
| **Easier installs** | `winget` and Homebrew, and a signed Windows installer |

## Being explored

| Feature | Where it stands |
|---|---|
| **An account per project in VS Code** | Use a different account automatically for each project folder. The first approach didn't work with VS Code; another is being tried |

---

## Not planned

Multi-Claude deliberately leaves these out, because they would get around Anthropic's usage
limits or handle your sign-ins:

- Switching accounts automatically when one hits a limit
- Pooling accounts, or picking the "next available" one
- Launching many accounts at once to multiply usage
- Moving work to another account to keep going past a limit
- Reading, copying, exporting or backing up sign-ins

Owning several accounts is fine; using them to get around limits is not. See
[CONTRIBUTING.md → Project rules](../CONTRIBUTING.md#project-rules) for the full list.
