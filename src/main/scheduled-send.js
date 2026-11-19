'use strict';
// Send one scheduled message from an account, with no window.
//
// Runs Anthropic's unmodified Claude Code as `claude -p "<message>"` against
// the account's own CLAUDE_CONFIG_DIR, so the message counts on that account
// and starts its 5-hour window. Kept as small as a real message can be: the
// cheapest model, no tools, no MCP servers, no user settings. Verified on this
// machine with CLI 2.1.326: about $0.0008, and `--resume` adds to the same chat.
//
// Never through a shell (see cc-usage.js): the message goes to Claude Code as
// one argument, exactly as typed.

const { spawn } = require('node:child_process');

const TIMEOUT_MS = 120000;

function buildArgs(message, sessionId) {
  return [
    '-p', message,
    ...(sessionId ? ['--resume', sessionId] : []),
    '--output-format', 'json',
    '--model', 'haiku',
    '--tools', '',
    '--strict-mcp-config',
    '--setting-sources', ''
  ];
}

/**
 * Read Claude Code's JSON result.
 * @returns {{ ok: true, sessionId, reply }
 *          | { ok: false, reason, sessionId?, needsSignIn?, limitReached?, noChat? }}
 */
function parseSendOutput(text) {
  let result = null;
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line);
      if (o && o.type === 'result') result = o;
    } catch { /* a warning, not the result */ }
  }
  if (!result) return { ok: false, reason: 'Claude Code did not answer.' };

  const sessionId = typeof result.session_id === 'string' ? result.session_id : null;
  const said = typeof result.result === 'string' ? result.result.trim() : '';
  if (result.is_error !== true) return { ok: true, sessionId, reply: said };

  const apiError = String(result.api_error || '');
  const status = Number(result.api_error_status);
  if (apiError === 'usage_limit_reached' || status === 429) {
    return { ok: false, limitReached: true, sessionId, reason: said || 'This account has reached its limit.' };
  }
  if (status === 401 || status === 403 || /authentication|log ?in|sign ?in/i.test(apiError + ' ' + said)) {
    return { ok: false, needsSignIn: true, reason: 'This account needs to sign in to Claude Code again.' };
  }
  if (/no conversation found/i.test(said)) {
    return { ok: false, noChat: true, reason: said };
  }
  return { ok: false, sessionId, reason: said || 'Claude Code could not send the message.' };
}

/** Send it. Never throws; a failure comes back as ok:false with a reason. */
function sendMessage(cliPath, configDir, { message, sessionId, cwd, spawnImpl = spawn, timeoutMs = TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    let out = '';
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; resolve(v); } };

    let child;
    try {
      child = spawnImpl(cliPath, buildArgs(message, sessionId), {
        cwd: cwd || configDir,
        env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        shell: false
      });
    } catch {
      finish({ ok: false, reason: 'Claude Code could not be started.' });
      return;
    }

    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* gone */ }
      finish({ ok: false, reason: 'Claude Code took too long to answer.' });
    }, timeoutMs);

    if (child.stdout) child.stdout.on('data', (d) => { out += d; });
    if (child.stderr) child.stderr.on('data', () => { /* warnings only */ });
    child.on('error', () => {
      clearTimeout(timer);
      finish({ ok: false, reason: 'Claude Code could not be started.' });
    });
    child.on('exit', () => {
      clearTimeout(timer);
      finish(parseSendOutput(out));
    });
  });
}

module.exports = { TIMEOUT_MS, buildArgs, parseSendOutput, sendMessage };
