'use strict';
// A taskbar button of its own for each added account's Claude window (Windows).
//
// Every Claude window normally groups under Claude's one taskbar button, so
// accounts look identical there. Windows groups windows by an id that can be
// set on each window (System.AppUserModel.ID); with it go three "relaunch"
// properties: the icon, the name and the command used if the button is pinned.
// Multi-Claude sets those four on the account's Claude windows, from outside:
//   - the id is the account shortcut's own id, so a pinned account shortcut and
//     its running window share one button;
//   - the icon is the account's coloured letter icon (a file path, so it keeps
//     working after the window is hidden to the tray and shown again);
//   - the command opens the account through Multi-Claude (--launch <id>).
// Nothing in Claude is modified or read: these are shell properties on its
// windows. Setting them to empty puts the window back in Claude's group the next
// time it is shown. The default account's taskbar button is never changed.
//
// Tray icons: every Claude window also puts the same icon in the tray. Each one
// is changed to its account's letter icon through the shell's own
// notification-icon call (Shell_NotifyIcon, NIM_MODIFY) on Claude's tray window.
// Only the icon: Claude's own hover text (its usage) is left as Claude sets it,
// and Claude updating that text doesn't touch the icon. This one includes the
// default account.
// Claude may set its icon again (or Explorer restarts), so it is re-applied on
// Multi-Claude's 5-minute check; turning the setting off puts Claude's own icon
// back.

const { shortcutAppId } = require('./shortcuts.js');

// System.AppUserModel property ids (fmtid 9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3).
const CSHARP = `
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

namespace MultiClaude {
  [StructLayout(LayoutKind.Sequential, Pack = 4)]
  public struct PropKey { public Guid fmtid; public uint pid; }

  [StructLayout(LayoutKind.Explicit, Size = 24)]
  public struct PropVar { [FieldOffset(0)] public ushort vt; [FieldOffset(8)] public IntPtr p; }

  [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IPropStore {
    [PreserveSig] int GetCount(out uint c);
    [PreserveSig] int GetAt(uint i, out PropKey k);
    [PreserveSig] int GetValue(ref PropKey k, out PropVar v);
    [PreserveSig] int SetValue(ref PropKey k, ref PropVar v);
    [PreserveSig] int Commit();
  }

  public static class Taskbar {
    [DllImport("shell32.dll")] static extern int SHGetPropertyStoreForWindow(IntPtr h, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out IPropStore ps);
    [DllImport("ole32.dll")] static extern int PropVariantClear(ref PropVar v);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint c);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
    delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct NotifyData {
      public int cbSize; public IntPtr hWnd; public uint uID; public uint uFlags; public uint uCallbackMessage; public IntPtr hIcon;
      [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string szTip; public uint dwState; public uint dwStateMask;
      [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string szInfo; public uint uVersion;
      [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string szInfoTitle; public uint dwInfoFlags; public Guid guidItem; public IntPtr hBalloonIcon;
    }
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)] static extern bool Shell_NotifyIcon(uint msg, ref NotifyData d);
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)] static extern uint ExtractIconEx(string file, int index, IntPtr[] large, IntPtr[] small, uint n);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr LoadImage(IntPtr h, string name, uint type, int cx, int cy, uint flags);
    [DllImport("user32.dll")] static extern int GetSystemMetricsForDpi(int idx, uint dpi);
    [DllImport("user32.dll")] static extern uint GetDpiForSystem();
    [DllImport("user32.dll")] static extern bool DestroyIcon(IntPtr h);

    static Guid IID = new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99");
    static PropKey Key(uint pid) { return new PropKey { fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), pid = pid }; }
    const uint ID = 5, COMMAND = 2, ICON = 3, NAME = 4;

    // Claude's own top-level windows: Chromium's window class, with a title.
    public static List<IntPtr> Windows(uint processId) {
      var r = new List<IntPtr>();
      EnumWindows((h, l) => {
        uint p; GetWindowThreadProcessId(h, out p);
        if (p != processId || GetWindow(h, 4) != IntPtr.Zero) return true;
        var c = new StringBuilder(64); GetClassName(h, c, 64);
        var t = new StringBuilder(8); GetWindowText(h, t, 8);
        if (c.ToString() == "Chrome_WidgetWin_1" && t.Length > 0) r.Add(h);
        return true;
      }, IntPtr.Zero);
      return r;
    }

    static string Get(IPropStore ps, uint pid) {
      var k = Key(pid); PropVar v;
      if (ps.GetValue(ref k, out v) != 0) return null;
      string s = v.vt == 31 ? Marshal.PtrToStringUni(v.p) : null;
      PropVariantClear(ref v);
      return s;
    }

    static void Set(IPropStore ps, uint pid, string value) {
      var k = Key(pid); var v = new PropVar();
      if (value != null) { v.vt = 31; v.p = Marshal.StringToCoTaskMemUni(value); }
      ps.SetValue(ref k, ref v);
      if (value != null) Marshal.FreeCoTaskMem(v.p);
    }

    // 1 = changed, 0 = already had this id, -1 = failed.
    public static int Apply(IntPtr h, string id, string name, string icon, string command) {
      IPropStore ps;
      if (SHGetPropertyStoreForWindow(h, ref IID, out ps) != 0) return -1;
      try {
        if (Get(ps, ID) == id && Get(ps, ICON) == icon) return 0;
        // The relaunch properties have to be in place before the id.
        Set(ps, COMMAND, command); Set(ps, ICON, icon); Set(ps, NAME, name); Set(ps, ID, id);
        ps.Commit();
        return 1;
      } finally { Marshal.ReleaseComObject(ps); }
    }

    // A Claude Desktop process, as opposed to Claude Code's command-line
    // claude.exe (same name, no windows): it has a window or a tray icon.
    public static bool IsDesktop(uint processId) {
      return TrayHosts(processId).Count > 0 || Windows(processId).Count > 0;
    }

    // The process's tray windows (Electron's notify-icon host).
    static List<IntPtr> TrayHosts(uint processId) {
      var r = new List<IntPtr>();
      EnumWindows((h, l) => {
        uint p; GetWindowThreadProcessId(h, out p);
        if (p != processId) return true;
        var c = new StringBuilder(64); GetClassName(h, c, 64);
        if (c.ToString() == "Electron_NotifyIconHostWindow") r.Add(h);
        return true;
      }, IntPtr.Zero);
      return r;
    }

    // Changes the icon (only the icon: NIF_ICON) of every tray icon the process
    // shows (Claude shows one). The shell copies the icon, so it is freed here.
    // Returns how many icons changed.
    static int SetTrayIcon(uint processId, IntPtr icon) {
      int n = 0;
      if (icon == IntPtr.Zero) return 0;
      foreach (var h in TrayHosts(processId)) {
        for (uint id = 1; id <= 8; id++) {
          var d = new NotifyData();
          d.cbSize = Marshal.SizeOf(typeof(NotifyData)); d.hWnd = h; d.uID = id;
          d.uFlags = 0x2; d.hIcon = icon;
          if (Shell_NotifyIcon(1, ref d)) n++;
        }
      }
      return n;
    }

    public static int Tray(uint processId, string iconFile) {
      int size = GetSystemMetricsForDpi(49, GetDpiForSystem());
      IntPtr icon = LoadImage(IntPtr.Zero, iconFile, 1, size, size, 0x10);
      try { return SetTrayIcon(processId, icon); }
      finally { if (icon != IntPtr.Zero) DestroyIcon(icon); }
    }

    // Claude's own icon back, taken from its exe.
    public static int TrayReset(uint processId, string exePath) {
      var small = new IntPtr[1];
      if (string.IsNullOrEmpty(exePath) || ExtractIconEx(exePath, 0, null, small, 1) == 0) return 0;
      try { return SetTrayIcon(processId, small[0]); }
      finally { if (small[0] != IntPtr.Zero) DestroyIcon(small[0]); }
    }

    // Removes Multi-Claude's properties (only ones it set: the id prefix).
    public static int Clear(IntPtr h, string prefix) {
      IPropStore ps;
      if (SHGetPropertyStoreForWindow(h, ref IID, out ps) != 0) return -1;
      try {
        var id = Get(ps, ID);
        if (id == null || !id.StartsWith(prefix)) return 0;
        Set(ps, NAME, null); Set(ps, COMMAND, null); Set(ps, ICON, null); Set(ps, ID, null);
        ps.Commit();
        return 1;
      } finally { Marshal.ReleaseComObject(ps); }
    }
  }
}
`;

/** "<exe>" <prefix>--launch <id>: how a pinned button opens the account. */
function relaunchCommand(exePath, argsPrefix, accountId) {
  return `"${exePath}" ${argsPrefix || ''}--launch ${accountId}`;
}

function displayName(label) {
  return `Claude - ${String(label || '').trim() || 'account'}`;
}

/** What to set on one account's windows and its tray icon. */
function itemFor(account, { exePath, argsPrefix, iconFile }) {
  return {
    dir: account.dir,
    id: shortcutAppId(account.id),
    name: displayName(account.label),
    icon: `${iconFile},0`,
    command: relaunchCommand(exePath, argsPrefix, account.id),
    trayIcon: iconFile
  };
}

/** The default account: its tray icon only; its taskbar button stays Claude's. */
function trayItemFor(account, { iconFile }) {
  return {
    dir: account.dir,
    isDefault: true,
    taskbar: false,
    trayIcon: iconFile
  };
}

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

/**
 * The PowerShell that finds each account's main Claude process by its
 * --user-data-dir and applies (or clears) the properties on its windows.
 * Everything variable travels base64-encoded JSON, so no path or name can break
 * out of the script's quoting. Prints one JSON line: [{ dir, pid, windows, changed }].
 */
function buildScript(mode, items) {
  return [
    '$ErrorActionPreference = "Stop"',
    `Add-Type -TypeDefinition ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64(CSHARP)}')))`,
    `$items = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64(JSON.stringify(items))}')) | ConvertFrom-Json`,
    '$procs = @(Get-CimInstance Win32_Process -Filter "Name=\'claude.exe\'" | Where-Object { $_.CommandLine -and $_.CommandLine -notmatch "--type=" })',
    '$out = @()',
    'foreach ($it in @($items)) {',
    '  $want = $it.dir.TrimEnd("\\").ToLowerInvariant()',
    // The default account's Claude runs without --user-data-dir.
    // Claude Code's claude.exe shares the name, so only one with a window or tray icon counts.
    '  if ($it.isDefault) { $p = $procs | Where-Object { $_.CommandLine -notmatch "--user-data-dir" -and [MultiClaude.Taskbar]::IsDesktop([uint32]$_.ProcessId) } | Select-Object -First 1 }',
    '  else { $p = $procs | Where-Object { $_.CommandLine -match \'--user-data-dir=(?:"([^"]+)"|(\\S+))\' -and (($(if ($Matches[1]) { $Matches[1] } else { $Matches[2] })).TrimEnd("\\").ToLowerInvariant() -eq $want) } | Select-Object -First 1 }',
    '  $r = [ordered]@{ dir = $it.dir; pid = 0; windows = 0; changed = 0; tray = 0 }',
    '  if ($p) {',
    '    $r.pid = [int]$p.ProcessId',
    '    if ($it.taskbar -ne $false) {',
    '      foreach ($h in [MultiClaude.Taskbar]::Windows([uint32]$p.ProcessId)) {',
    '        $r.windows++',
    mode === 'clear'
      ? '        if ([MultiClaude.Taskbar]::Clear($h, "dev.multiclaude.app.shortcut.") -eq 1) { $r.changed++ }'
      : '        if ([MultiClaude.Taskbar]::Apply($h, $it.id, $it.name, $it.icon, $it.command) -eq 1) { $r.changed++ }',
    '      }',
    '    }',
    mode === 'clear'
      ? '    $r.tray = [MultiClaude.Taskbar]::TrayReset([uint32]$p.ProcessId, [string]$p.ExecutablePath)'
      : '    if ($it.trayIcon) { $r.tray = [MultiClaude.Taskbar]::Tray([uint32]$p.ProcessId, $it.trayIcon) }',
    '  }',
    '  $out += [pscustomobject]$r',
    '}',
    'ConvertTo-Json -Compress -InputObject @($out)'
  ].join('\n');
}

function parseResult(stdout) {
  const text = String(stdout || '').trim();
  if (!text) return [];
  const v = JSON.parse(text);
  return (Array.isArray(v) ? v : [v]).map((r) => ({
    dir: String(r.dir), pid: Number(r.pid) || 0, windows: Number(r.windows) || 0, changed: Number(r.changed) || 0,
    tray: Number(r.tray) || 0
  }));
}

function createTaskbar({ runPowerShell }) {
  async function run(mode, items) {
    if (items.length === 0) return { ok: true, results: [] };
    try {
      return { ok: true, results: parseResult(await runPowerShell(buildScript(mode, items))) };
    } catch (e) {
      return { ok: false, results: [], error: e && e.message };
    }
  }
  return {
    /** items: from itemFor(). */
    apply: (items) => run('apply', items),
    /**
     * Profile folders (or { dir, isDefault }) whose windows go back to
     * Claude's group and whose tray icons go back to Claude's own.
     */
    clear: (list) => run('clear', list.map((x) => (typeof x === 'string' ? { dir: x } : { dir: x.dir, isDefault: !!x.isDefault }))),
  };
}

module.exports = { CSHARP, relaunchCommand, displayName, itemFor, trayItemFor, buildScript, parseResult, createTaskbar };
