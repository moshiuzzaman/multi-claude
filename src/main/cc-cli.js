'use strict';
// Finding and driving the official Claude Code CLI.
//
// Multi-Claude never authenticates anyone. Sign-in happens in Anthropic's own
// `claude auth login` flow, in a terminal window the user can see; the CLI
// keeps its own credentials inside the per-account CLAUDE_CONFIG_DIR. The only
// thing read back is `claude auth status --json`, and only the descriptive
// fields below are kept from it.

const fs = require('node:fs');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');

const AUTH_FIELDS = ['loggedIn', 'authMethod', 'email', 'orgName', 'subscriptionType'];

function pickAuth(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return { loggedIn: false };
  for (const k of AUTH_FIELDS) {
    const v = raw[k];
    if (typeof v === 'string' || typeof v === 'boolean') out[k] = v;
  }
  out.loggedIn = out.loggedIn === true;
  return out;
}

/** "2.1.319 (Claude Code)" -> [2,1,319]; null when unparseable. */
function parseVersion(s) {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(s));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/** Every place an official Claude Code binary is commonly installed. */
function candidatePaths(env, fsImpl = fs) {
  const home = env.USERPROFILE || '';
  const out = [
    path.join(home, '.local', 'bin', 'claude.exe'),
    path.join(env.APPDATA || '', 'npm', 'claude.cmd')
  ];
  const extDir = path.join(home, '.vscode', 'extensions');
  try {
    for (const name of fsImpl.readdirSync(extDir)) {
      if (name.startsWith('anthropic.claude-code-')) {
        out.push(path.join(extDir, name, 'resources', 'native-binary', 'claude.exe'));
      }
    }
  } catch { /* no VS Code extensions */ }
  return out.filter((p) => { try { return fsImpl.existsSync(p); } catch { return false; } });
}

function runFile(file, args, opts = {}) {
  return new Promise((resolve, reject) => {
    // .cmd shims (npm) must go through the shell; native exes must not.
    const shell = /\.cmd$/i.test(file);
    execFile(shell ? `"${file}"` : file, args, {
      windowsHide: true, timeout: 20000, maxBuffer: 1024 * 1024, shell, ...opts
    }, (e, stdout) => (e ? reject(e) : resolve(stdout)));
  });
}

/**
 * The newest installed Claude Code. Newest, because the status-line
 * rate_limits field only exists in recent versions and this machine has
 * binaries spanning 2.1.112 to 2.1.319.
 */
async function findClaudeCli({ env = process.env, fsImpl = fs, run = runFile } = {}) {
  let best = null;
  for (const p of candidatePaths(env, fsImpl)) {
    let v;
    try { v = parseVersion(await run(p, ['--version'])); } catch { continue; }
    if (!v) continue;
    if (!best || compareVersions(v, best.version) > 0) best = { path: p, version: v };
  }
  return best;
}

async function authStatus(cliPath, configDir, run = runFile) {
  try {
    const out = await run(cliPath, ['auth', 'status', '--json'], {
      env: { ...process.env, CLAUDE_CONFIG_DIR: configDir }
    });
    return pickAuth(JSON.parse(out));
  } catch {
    // Not signed in yet makes the CLI exit non-zero; that is a normal state.
    return { loggedIn: false };
  }
}

/**
 * Open a visible terminal running the CLI against this account's config dir.
 * Visible on purpose: sign-in and any Claude Code session belong to the user.
 */
function openTerminal(cliPath, configDir, args, { title = 'Claude Code', cwd } = {}) {
  const quoted = `"${cliPath}"${args.length ? ' ' + args.join(' ') : ''}`;
  const child = spawn('cmd.exe', ['/c', 'start', `"${title}"`, 'cmd.exe', '/k', quoted], {
    cwd: cwd || process.env.USERPROFILE,
    env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
    detached: true,
    stdio: 'ignore',
    windowsVerbatimArguments: true
  });
  child.unref();
}

module.exports = {
  AUTH_FIELDS, pickAuth, parseVersion, compareVersions, candidatePaths,
  findClaudeCli, authStatus, openTerminal
};
