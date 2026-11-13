'use strict';
// The macOS half of the parts that talk to the system: finding Claude.app,
// starting a profile, telling which profiles are open and quitting one.
// Windows keeps its own modules (claude-locator, launcher, scanner, closer);
// platform.js picks the right set.
//
// The mechanism is the same on both: Chromium's stock --user-data-dir flag.
// On a Mac a second instance is started through LaunchServices
// (`open -n -a Claude.app --args --user-data-dir=…`), so it gets its own Dock
// icon and outlives Multi-Claude. Nothing about Claude is modified.
//
// Everything with side effects is injected, so this tests on any OS. Paths are
// POSIX here whatever OS the tests run on: `P` is paths.js built for POSIX.

const nodePath = require('node:path');
const { makePaths } = require('./paths.js');
const { findRootPids } = require('./closer.js');

const posix = nodePath.posix;
const P = makePaths(posix);

// Claude for Mac's bundle id, for a Spotlight lookup when it isn't in an
// Applications folder.
const BUNDLE_ID = 'com.anthropic.claudefordesktop';

/** Where Claude keeps its own profile when started with no --user-data-dir. */
function defaultProfileDir(home) {
  return posix.join(home, 'Library', 'Application Support', 'Claude');
}

// ---------------------------------------------------------------- locator --

function createMacLocator({ fsImpl, env, run }) {
  const exists = (p) => { try { return fsImpl.existsSync(p); } catch { return false; } };
  const home = env.HOME || '';

  async function fromSpotlight() {
    let out;
    try {
      out = await run('mdfind', [`kMDItemCFBundleIdentifier == "${BUNDLE_ID}"`]);
    } catch {
      return null;
    }
    return String(out).split('\n').map((s) => s.trim()).find((p) => p.endsWith('.app') && exists(p)) || null;
  }

  return {
    /** The Claude.app bundle, re-found whenever the remembered one is gone. */
    async resolve(cachedPath) {
      if (cachedPath && cachedPath.endsWith('.app') && exists(cachedPath)) return cachedPath;
      for (const p of ['/Applications/Claude.app', posix.join(home, 'Applications', 'Claude.app')]) {
        if (exists(p)) return p;
      }
      return await fromSpotlight();
    }
  };
}

// --------------------------------------------------------------- launcher --

/** `open` arguments for one account. The default account gets no flag. */
function buildOpenArgs(appPath, account) {
  if (account.kind === 'default') return ['-a', appPath];
  // -n: a new instance even when Claude is already open for another profile.
  return ['-n', '-a', appPath, '--args', `--user-data-dir=${account.dir}`];
}

function createMacLauncher({ spawnImpl }) {
  function launch(appPath, account) {
    const child = spawnImpl('open', buildOpenArgs(appPath, account), { detached: true, stdio: 'ignore' });
    child.unref();
  }
  // `open -n` starts a new process; Claude's single-instance lock (per data
  // folder) hands it to the running copy, which brings its window forward.
  return { launch, show: launch };
}

// ---------------------------------------------------------------- scanner --

// `ps` prints each process's arguments joined by spaces, so a path with a
// space in it is not quoted. The flag's value runs to the next " --" flag or
// the end of the line; profile paths never contain " --".
const DIR_FLAG = /--user-data-dir=(?:"([^"]+)"|(.+?))(?=\s+--|\s*$)/;

/** A Claude for Mac process: the app itself or one of its helpers. */
function isClaudeProcess(command) {
  return /\/Claude\.app\/Contents\/(MacOS\/Claude|Frameworks\/Claude Helper)/.test(command);
}

/** `ps -axww -o pid=,ppid=,command=` output -> [{ pid, ppid, dir }] for Claude. */
function parsePs(stdout) {
  const out = [];
  for (const line of String(stdout).split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const command = m[3];
    if (!isClaudeProcess(command)) continue;
    const d = DIR_FLAG.exec(command);
    out.push({
      pid: Number(m[1]),
      ppid: Number(m[2]),
      dir: d ? P.normalizeDir(d[1] || d[2]) : null
    });
  }
  return out;
}

const PS_ARGS = ['-axww', '-o', 'pid=,ppid=,command='];

function createMacScanner({ run }) {
  return {
    /** Same contract as scanner.js: ok:false is "unknown", never "not running". */
    async scan() {
      try {
        const dirs = new Set(parsePs(await run('ps', PS_ARGS)).map((p) => p.dir).filter(Boolean));
        return { dirs: [...dirs], ok: true };
      } catch {
        return { dirs: [], ok: false };
      }
    }
  };
}

// ----------------------------------------------------------------- closer --

/** Every process below the given roots, roots included. */
function treeOf(processes, roots) {
  const keep = new Set(roots);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of processes) {
      if (!keep.has(p.pid) && keep.has(p.ppid)) { keep.add(p.pid); grew = true; }
    }
  }
  return [...keep];
}

/**
 * Quit every Claude instance using `dir`. A Mac app quits properly on SIGTERM,
 * so that comes first; whatever is still there after a few seconds is ended
 * with SIGKILL. Only that profile's own process tree is ever signalled.
 */
function createMacCloser({ run, kill, isAlive, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), graceMs = 4000 }) {
  return {
    async close(dir) {
      const processes = parsePs(await run('ps', PS_ARGS));
      const roots = findRootPids(processes, dir, P.normalizeDir);
      if (roots.length === 0) return { closed: 0, pids: [] };
      const tree = treeOf(processes, roots);

      for (const pid of roots) { try { kill(pid, 'SIGTERM'); } catch { /* already gone */ } }
      for (let waited = 0; waited < graceMs && roots.some(isAlive); waited += 250) await sleep(250);
      for (const pid of tree) {
        if (isAlive(pid)) { try { kill(pid, 'SIGKILL'); } catch { /* gone */ } }
      }
      return { closed: roots.length, pids: roots };
    }
  };
}

// ---------------------------------------------------------------- VS Code --

function candidateEditors(env, fsImpl) {
  const home = env.HOME || '';
  return ['/Applications/Visual Studio Code.app', posix.join(home, 'Applications', 'Visual Studio Code.app')]
    .filter((p) => { try { return fsImpl.existsSync(p); } catch { return false; } });
}

function createMacVsCode({ env, fsImpl, run, spawnImpl }) {
  return {
    find: () => candidateEditors(env, fsImpl)[0] || null,
    async isRunning() {
      try {
        return String(await run('ps', ['-axww', '-o', 'command='])).includes('/Visual Studio Code.app/Contents/MacOS/');
      } catch {
        return false;
      }
    },
    launch(appPath) {
      const child = spawnImpl('open', ['-a', appPath], { detached: true, stdio: 'ignore' });
      child.unref();
    }
  };
}

// -------------------------------------------------------------- shortcuts --

function shortcutName(label) {
  const clean = String(label == null ? '' : label).replace(/[/:]/g, '').trim();
  return `Claude - ${clean === '' ? 'account' : clean}.app`;
}

function plistEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** A shell single-quoted string. */
function shQuote(s) {
  return `'${String(s).replace(/'/g, "'\\''")}'`;
}

/**
 * A desktop shortcut on a Mac is a tiny app: double-clicking it starts
 * Multi-Claude with --launch <id>, which opens that profile and exits (or
 * hands the request to a Multi-Claude that is already open).
 */
function createMacShortcut({ fsImpl, desktopDir, exePath, account, argsPrefix = '', iconFile = null }) {
  const app = posix.join(desktopDir, shortcutName(account.label));
  const contents = posix.join(app, 'Contents');
  fsImpl.mkdirSync(posix.join(contents, 'MacOS'), { recursive: true });
  fsImpl.mkdirSync(posix.join(contents, 'Resources'), { recursive: true });

  const launcher = posix.join(contents, 'MacOS', 'launch');
  const prefix = argsPrefix ? `${argsPrefix.trim()} ` : '';
  fsImpl.writeFileSync(launcher,
    `#!/bin/sh\n# Opens Claude with the ${account.label.replace(/\n/g, ' ')} profile, through Multi-Claude.\n` +
    `exec ${shQuote(exePath)} ${prefix}--launch ${shQuote(account.id)} >/dev/null 2>&1\n`);
  fsImpl.chmodSync(launcher, 0o755);

  let iconKey = '';
  if (iconFile) {
    try {
      fsImpl.copyFileSync(iconFile, posix.join(contents, 'Resources', 'icon.icns'));
      iconKey = '  <key>CFBundleIconFile</key><string>icon</string>\n';
    } catch { /* no icon is fine */ }
  }
  fsImpl.writeFileSync(posix.join(contents, 'Info.plist'),
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n' +
    '<plist version="1.0"><dict>\n' +
    `  <key>CFBundleName</key><string>${plistEscape(shortcutName(account.label).replace(/\.app$/, ''))}</string>\n` +
    '  <key>CFBundleExecutable</key><string>launch</string>\n' +
    `  <key>CFBundleIdentifier</key><string>dev.multiclaude.shortcut.${plistEscape(account.id)}</string>\n` +
    '  <key>CFBundlePackageType</key><string>APPL</string>\n' +
    '  <key>LSUIElement</key><true/>\n' +
    iconKey +
    '</dict></plist>\n');
  return app;
}

// ---------------------------------------------------------- Claude Code --

/** Every place an official Claude Code binary is commonly installed on a Mac. */
function ccCandidatePaths(env, fsImpl, profileDirs = []) {
  const home = env.HOME || '';
  const list = (d) => { try { return fsImpl.readdirSync(d).map(String); } catch { return []; } };
  const out = [
    posix.join(home, '.local', 'bin', 'claude'),
    posix.join(home, '.claude', 'local', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    posix.join(home, '.npm-global', 'bin', 'claude')
  ];
  for (const editor of ['.vscode', '.vscode-insiders', '.cursor', '.windsurf']) {
    const ext = posix.join(home, editor, 'extensions');
    for (const name of list(ext)) {
      if (name.startsWith('anthropic.claude-code-')) out.push(posix.join(ext, name, 'resources', 'native-binary', 'claude'));
    }
  }
  // Claude Desktop's own copy: <profile>/claude-code/<version>[/<build>]/claude.
  for (const dir of [...profileDirs, defaultProfileDir(home)]) {
    if (!dir) continue;
    const root = posix.join(dir, 'claude-code');
    for (const version of list(root)) {
      out.push(posix.join(root, version, 'claude'));
      for (const build of list(posix.join(root, version))) out.push(posix.join(root, version, build, 'claude'));
    }
  }
  for (const d of String(env.PATH || '').split(':')) if (d.trim()) out.push(posix.join(d.trim(), 'claude'));

  const seen = new Set();
  return out.filter((p) => {
    if (seen.has(p)) return false;
    seen.add(p);
    try { return fsImpl.existsSync(p); } catch { return false; }
  });
}

/** AppleScript string literal. */
function asQuote(s) {
  return `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** A visible Terminal window running Claude Code against one account. */
function openCcTerminal(cliPath, configDir, args, { spawnImpl, cwd } = {}) {
  const cmd = [
    cwd ? `cd ${shQuote(cwd)}` : null,
    `export CLAUDE_CONFIG_DIR=${shQuote(configDir)}`,
    [shQuote(cliPath), ...args.map(shQuote)].join(' ')
  ].filter(Boolean).join('; ');
  const child = spawnImpl('osascript', [
    '-e', `tell application "Terminal" to do script ${asQuote(cmd)}`,
    '-e', 'tell application "Terminal" to activate'
  ], { detached: true, stdio: 'ignore' });
  child.unref();
}

module.exports = {
  BUNDLE_ID, defaultProfileDir,
  createMacLocator, buildOpenArgs, createMacLauncher,
  DIR_FLAG, isClaudeProcess, parsePs, PS_ARGS, createMacScanner,
  treeOf, createMacCloser,
  createMacVsCode,
  shortcutName, createMacShortcut, shQuote,
  ccCandidatePaths, openCcTerminal, asQuote
};
