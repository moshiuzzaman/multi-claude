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
// time it is shown. The default account is never changed.

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

/** What to set on one account's windows. */
function itemFor(account, { exePath, argsPrefix, iconFile }) {
  return {
    dir: account.dir,
    id: shortcutAppId(account.id),
    name: displayName(account.label),
    icon: `${iconFile},0`,
    command: relaunchCommand(exePath, argsPrefix, account.id)
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
    '  $p = $procs | Where-Object { $_.CommandLine -match \'--user-data-dir=(?:"([^"]+)"|(\\S+))\' -and (($(if ($Matches[1]) { $Matches[1] } else { $Matches[2] })).TrimEnd("\\").ToLowerInvariant() -eq $want) } | Select-Object -First 1',
    '  $r = [ordered]@{ dir = $it.dir; pid = 0; windows = 0; changed = 0 }',
    '  if ($p) {',
    '    $r.pid = [int]$p.ProcessId',
    '    foreach ($h in [MultiClaude.Taskbar]::Windows([uint32]$p.ProcessId)) {',
    '      $r.windows++',
    mode === 'clear'
      ? '      if ([MultiClaude.Taskbar]::Clear($h, "dev.multiclaude.app.shortcut.") -eq 1) { $r.changed++ }'
      : '      if ([MultiClaude.Taskbar]::Apply($h, $it.id, $it.name, $it.icon, $it.command) -eq 1) { $r.changed++ }',
    '    }',
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
    dir: String(r.dir), pid: Number(r.pid) || 0, windows: Number(r.windows) || 0, changed: Number(r.changed) || 0
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
    /** dirs: profile folders whose windows go back to Claude's group. */
    clear: (dirs) => run('clear', dirs.map((dir) => ({ dir }))),
  };
}

module.exports = { CSHARP, relaunchCommand, displayName, itemFor, buildScript, parseResult, createTaskbar };
