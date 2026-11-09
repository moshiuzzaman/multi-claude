'use strict';
// Per-account plan limits (Session 5hr / Weekly 7 day), the sanctioned way.
//
// Claude Code — Anthropic's own, unmodified binary, signed in through
// Anthropic's own login flow — passes `rate_limits` to a status-line command
// as part of a documented feature. We register a tiny recorder as that
// command. It copies ONLY the rate_limits object to a file; Multi-Claude reads
// the file. No credential or session token is ever read, stored or sent by
// this app: Anthropic's terms forbid exactly that, and this design never needs
// it. See README "Usage limits by account".
//
// Each Multi-Claude account gets its own CLAUDE_CONFIG_DIR, so each signs in
// separately and records its own limits.

const fsp = require('node:fs/promises');
const path = require('node:path');

// PowerShell, not node: a packaged install cannot assume node is on PATH, and
// PowerShell can't read a script that lives inside app.asar — so this text is
// written out to the app-data folder at runtime.
const RECORDER_PS1 = `param([string]$Out)
# Written by Multi-Claude. Claude Code runs this as its status line and pipes
# session JSON on stdin. Only the rate_limits object is kept; everything else
# in that JSON (paths, session ids, context) is ignored.
$raw = [Console]::In.ReadToEnd()
$line = ''
try {
  $j = $raw | ConvertFrom-Json
  $rl = $j.rate_limits
  if ($rl) {
    $rec = [ordered]@{ recordedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); rate_limits = $rl }
    $tmp = "$Out.tmp"
    [IO.File]::WriteAllText($tmp, ($rec | ConvertTo-Json -Depth 6 -Compress))
    Move-Item -LiteralPath $tmp -Destination $Out -Force
    $parts = @()
    if ($rl.five_hour) { $parts += ('5h ' + [math]::Round([double]$rl.five_hour.used_percentage) + '%') }
    if ($rl.seven_day) { $parts += ('7d ' + [math]::Round([double]$rl.seven_day.used_percentage) + '%') }
    $line = ($parts -join ' | ')
  }
  if ($j.model -and $j.model.display_name) { $line = ($j.model.display_name + '  ' + $line).Trim() }
} catch {}
Write-Output $line
`;

/** Forward slashes survive whichever shell Claude Code uses to run the command. */
function fwd(p) {
  return String(p).replace(/\\/g, '/');
}

function statusLineCommand(recorderPath, outFile) {
  return `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${fwd(recorderPath)}" "${fwd(outFile)}"`;
}

async function ensureRecorder(file) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  let current = null;
  try { current = await fsp.readFile(file, 'utf8'); } catch { /* absent */ }
  if (current !== RECORDER_PS1) await fsp.writeFile(file, RECORDER_PS1, 'utf8');
  return file;
}

/**
 * Point this config dir's status line at the recorder, preserving every other
 * setting. Only ever called on a config dir Multi-Claude created.
 */
async function ensureStatusLine(configDir, command) {
  const file = path.join(configDir, 'settings.json');
  await fsp.mkdir(configDir, { recursive: true });

  let settings = {};
  try {
    const parsed = JSON.parse(stripBom(await fsp.readFile(file, 'utf8')));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) settings = parsed;
  } catch { /* absent or unreadable: start fresh */ }

  const wanted = { type: 'command', command, padding: 0 };
  if (JSON.stringify(settings.statusLine) === JSON.stringify(wanted)) return false;

  settings.statusLine = wanted;
  const tmp = file + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(settings, null, 2), 'utf8');
  await fsp.rename(tmp, file);
  return true;
}

function stripBom(s) {
  return String(s).replace(/^﻿/, '');
}

function windowOf(w, now) {
  if (!w || typeof w !== 'object') return null;
  const pct = Number(w.used_percentage);
  const resetsAt = Number(w.resets_at);
  if (!Number.isFinite(pct)) return null;
  const resetsMs = Number.isFinite(resetsAt) && resetsAt > 0 ? resetsAt * 1000 : null;
  return {
    usedPct: Math.max(0, Math.min(100, pct)),
    resetsAt: resetsMs,
    // Past its reset time the recorded figure no longer describes the window;
    // Claude Code itself drops a window at that point.
    expired: resetsMs !== null && resetsMs <= now
  };
}

/** Parse what the recorder wrote. Returns null when there is nothing usable. */
function parseLimits(text, now = Date.now()) {
  let o;
  try { o = JSON.parse(stripBom(text)); } catch { return null; }
  if (!o || typeof o !== 'object' || !o.rate_limits) return null;
  const rl = o.rate_limits;
  const fiveHour = windowOf(rl.five_hour, now);
  const sevenDay = windowOf(rl.seven_day, now);
  if (!fiveHour && !sevenDay) return null;
  return {
    fiveHour,
    sevenDay,
    recordedAt: Number.isFinite(Number(o.recordedAt)) ? Number(o.recordedAt) : null
  };
}

async function readLimits(file, now = Date.now()) {
  try {
    return parseLimits(await fsp.readFile(file, 'utf8'), now);
  } catch {
    return null;
  }
}

module.exports = {
  RECORDER_PS1, statusLineCommand, ensureRecorder, ensureStatusLine,
  parseLimits, readLimits, stripBom
};
