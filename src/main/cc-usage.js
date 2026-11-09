'use strict';
// Fetch an account's real plan limits with no window and no message.
//
// Runs Anthropic's unmodified Claude Code as `claude -p "/usage"` against the
// account's own CLAUDE_CONFIG_DIR. /usage is a built-in command: Claude Code
// answers it from Anthropic's usage endpoint and attaches a structured
// `usage_report` to the result, without calling a model. Verified on this
// machine with CLI 2.1.319: cost $0, zero turns, no model used.
//
// Two traps learned the hard way:
//   - Never launch through a shell. Git Bash rewrote "/usage" into
//     "C:/Program Files/Git/usage", which went to the model as a prompt.
//   - Belt and braces anyway: the cheapest model, a one-word system prompt
//     and no tools, so if a future CLI ever routed /usage to the model it
//     would cost a fraction of a cent rather than a full turn. The result's
//     turn count is checked, and a fetch that reached a model is reported as
//     such so the caller can stop refreshing automatically.

const { spawn } = require('node:child_process');

const USAGE_ARGS = [
  '-p', '/usage',
  '--output-format', 'stream-json', '--verbose',
  '--no-session-persistence',
  '--model', 'haiku',
  '--system-prompt', 'x',
  '--tools', '',
  '--strict-mcp-config',
  '--setting-sources', ''
];

const TIMEOUT_MS = 45000;

function parseTime(s) {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function scopeLabel(scope) {
  if (!scope || typeof scope !== 'object') return null;
  return (scope.model && scope.model.display_name)
    || (scope.surface && scope.surface.display_name)
    || null;
}

/** A readable name for a meter, from the server's `kind`, never from a label guess. */
function meterTitle(row) {
  const scoped = row.scopeLabel ? ` · ${row.scopeLabel}` : '';
  switch (row.kind) {
    case 'session': return 'Session (5hr)';
    case 'weekly_all': return 'Weekly (all models)';
    case 'weekly_scoped': return `Weekly${scoped || ' (scoped)'}`;
    default: return `${row.kind}${scoped}`;
  }
}

/**
 * Parse the CLI's stream-json output.
 * @returns {{ ok: true, meters, extraUsage, reachedModel: false }
 *          | { ok: false, reason, reachedModel: boolean }}
 */
function parseUsageOutput(text) {
  let report = null;
  let result = null;
  let authError = null;

  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; } // warnings, not data
    if (o.type === 'assistant') {
      if (o.usage_report) report = o.usage_report;
      if (o.error) authError = o.error;
    }
    if (o.type === 'result') result = o;
  }

  const turns = result && Number(result.num_turns);
  const reachedModel = !!(result && (turns > 0 || Object.keys(result.modelUsage || {}).length > 0));

  if (reachedModel) {
    return { ok: false, reachedModel: true, reason: 'This Claude Code version sent /usage to the model instead of answering it directly.' };
  }
  if (authError === 'authentication_failed' || authError === 'oauth_org_not_allowed') {
    return { ok: false, reachedModel: false, reason: 'This account needs to sign in to Claude Code again.', needsSignIn: true };
  }
  if (!report) {
    return { ok: false, reachedModel: false, reason: 'Claude Code did not return a usage report for this account.' };
  }
  if (!report.rate_limits || report.rate_limits.limits === null) {
    return { ok: false, reachedModel: false, reason: "This account's plan does not report usage limits." };
  }

  const meters = (report.rate_limits.limits || []).map((r) => {
    const row = {
      kind: String(r.kind || ''),
      group: String(r.group || ''),
      percent: Math.max(0, Math.min(100, Number(r.percent) || 0)),
      resetsAt: parseTime(r.resets_at),
      severity: ['normal', 'warning', 'critical'].includes(r.severity) ? r.severity : 'normal',
      isActive: r.is_active === true,
      scopeLabel: scopeLabel(r.scope)
    };
    row.title = meterTitle(row);
    return row;
  });

  const eu = report.rate_limits.extra_usage;
  const extraUsage = eu && typeof eu === 'object' ? {
    enabled: eu.is_enabled === true,
    monthlyLimit: Number.isFinite(eu.monthly_limit) ? eu.monthly_limit : null,
    usedCredits: Number.isFinite(eu.used_credits) ? eu.used_credits : null,
    currency: typeof eu.currency === 'string' ? eu.currency : null
  } : null;

  return { ok: true, reachedModel: false, meters, extraUsage };
}

/** Run the fetch for one account. Never throws; failures come back as ok:false. */
function fetchUsage(cliPath, configDir, { spawnImpl = spawn, timeoutMs = TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    let out = '';
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; resolve(v); } };

    let child;
    try {
      child = spawnImpl(cliPath, USAGE_ARGS, {
        cwd: configDir,
        env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
        // No shell, ever (see header). stdin closed so the CLI does not wait
        // three seconds for piped input that will never come.
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        shell: false
      });
    } catch {
      finish({ ok: false, reachedModel: false, reason: 'Claude Code could not be started.' });
      return;
    }

    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* gone */ }
      finish({ ok: false, reachedModel: false, reason: 'Claude Code took too long to answer.' });
    }, timeoutMs);
    // Deliberately not unref()'d: the timeout must be able to fire even when
    // nothing else is keeping the process alive, or a hung CLI hangs us too.

    if (child.stdout) child.stdout.on('data', (d) => { out += d; });
    if (child.stderr) child.stderr.on('data', () => { /* warnings only */ });
    child.on('error', () => {
      clearTimeout(timer);
      finish({ ok: false, reachedModel: false, reason: 'Claude Code could not be started.' });
    });
    child.on('exit', () => {
      clearTimeout(timer);
      finish(parseUsageOutput(out));
    });
  });
}

module.exports = { USAGE_ARGS, parseUsageOutput, fetchUsage, meterTitle };
