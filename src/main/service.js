'use strict';
// The application service: everything the UI can ask for, with all privileged
// work kept on this side.
//
// Every operation takes an account id and looks the path up itself. No caller
// — least of all the renderer — ever supplies a filesystem path.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const store = require('./store.js');
const profiles = require('./profiles.js');
const deleter = require('./deleter.js');
const { createShortcut } = require('./shortcuts.js');
const P = require('./paths.js');
const { scanUsage, SUMMARY_VERSION } = require('./usage-reader.js');
const { buildDashboard } = require('./usage-aggregate.js');
const { createActivityLog, buildSessions, summariseActivity } = require('./activity-log.js');
const { breakdown, purgeCaches } = require('./storage.js');
const { readAccountInfo } = require('./account-info.js');
const limitsMod = require('./limits.js');
const ccCliMod = require('./cc-cli.js');
const { createLoginManager } = require('./cc-login.js');
const ccUsageMod = require('./cc-usage.js');
const vscodeMod = require('./vscode.js');
const vscodeSettings = require('./vscode-settings.js');

const LIMITS_FILE = 'multi-claude-limits.json';
const GMAIL_URL = 'https://mail.google.com/';
const AUTH_TTL_MS = 2 * 60 * 1000;
// How long a fetched /usage report is reused before Claude Code is asked again.
const PLAN_TTL_MS = 90 * 1000;

function err(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

// How long a measured profile size stays fresh. Long enough that moving
// between views never re-walks, short enough that it is not stale by the time
// anyone acts on it.
const STORAGE_TTL_MS = 10 * 60 * 1000;

function createService(deps) {
  let data = store.emptyStore();
  let scanner = deps.scanner;
  let locator = deps.locator;

  // Usage scanning state. The cache turns a ~3.4s cold scan of 80k records
  // into a ~20ms warm scan, so it is worth persisting across restarts.
  let usageCache = {};
  let usageCacheDirty = false;
  let storageCache = {};
  const activity = deps.activityFile ? createActivityLog({ file: deps.activityFile }) : null;

  const persist = () => store.save(deps.configFile, data);

  // ---- per-account Claude Code (for plan limits) ---------------------------
  const ccCli = deps.ccCli || {
    // Claude Desktop keeps its own Claude Code inside each profile folder, so
    // the accounts' folders are searched as well as the usual install places.
    find: () => ccCliMod.findClaudeCli({
      // deps.appDir holds the copy Multi-Claude downloads itself (cc-install.js),
      // laid out the same way: <dir>/claude-code/<version>/claude.exe.
      profileDirs: [deps.appDir, deps.defaultProfileDir, ...((data && data.accounts) || []).map((a) => a.dir)]
    }),
    authStatus: (cli, dir) => ccCliMod.authStatus(cli, dir),
    openTerminal: (cli, dir, args, opts) => ccCliMod.openTerminal(cli, dir, args, opts)
  };
  let cliPromise = null;
  const authCache = new Map(); // account id -> { at, auth }
  const planCache = new Map(); // account id -> { at, value } from /usage
  // Accounts whose /usage fetch ever reached a model. Auto-refresh stops for
  // them so a changed CLI can never quietly spend usage on a timer.
  const planHalted = new Set();
  const ccUsage = deps.ccUsage || { fetch: (cliPath, dir) => ccUsageMod.fetchUsage(cliPath, dir) };
  // Hidden `claude auth login` runs, one per account being signed in.
  const logins = deps.loginManager || createLoginManager({
    openExternal: (url) => deps.shellImpl && deps.shellImpl.openExternal && deps.shellImpl.openExternal(url)
  });

  const ccDirFor = (a) => (deps.ccRoot ? path.join(deps.ccRoot, a.id) : null);

  const vscode = deps.vscode || {
    find: () => vscodeMod.findVsCode(),
    isRunning: () => vscodeMod.createVsCodeProbe({ runPowerShell: deps.runPowerShell }).isRunning(),
    launch: (exe) => vscodeMod.launch(exe)
  };

  // VS Code settings changes run one at a time. Each is read-modify-write on
  // one file through one temp name, so two overlapping clicks could otherwise
  // rename the same temp file twice or have the earlier click land last.
  let vscodeQueue = Promise.resolve();
  function vscodeSerially(fn) {
    const run = vscodeQueue.then(fn, fn);
    vscodeQueue = run.catch(() => {});
    return run;
  }

  const VSCODE_BACKUPS_KEPT = 3;

  /**
   * Replace the user's VS Code settings with `next`, given the `current` text.
   *
   * Writes to the file a symlinked settings.json points at, so a dotfiles link
   * survives — renaming onto the link would replace it with a plain file.
   * Backs up first and keeps only the newest few backups, so repeated
   * switching never litters the user's folder.
   */
  async function writeVsCodeSettings(file, current, next) {
    let target = file;
    try { target = await fsp.realpath(file); } catch { /* not there yet: write it where it belongs */ }
    const dir = path.dirname(target);
    const base = path.basename(target);
    await fsp.mkdir(dir, { recursive: true });

    if (current !== '') {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      try { await fsp.writeFile(path.join(dir, `${base}.multi-claude-${stamp}.bak`), current); } catch { /* best effort */ }
      try {
        // ISO timestamps sort lexically in time order, oldest first.
        const old = (await fsp.readdir(dir))
          .filter((n) => n.startsWith(`${base}.multi-claude-`) && n.endsWith('.bak'))
          .sort()
          .slice(0, -VSCODE_BACKUPS_KEPT);
        for (const n of old) await fsp.rm(path.join(dir, n), { force: true });
      } catch { /* best effort */ }
    }

    // Temp file and rename, so VS Code's own watcher never sees a half-file.
    const tmp = path.join(dir, `${base}.tmp`);
    await fsp.writeFile(tmp, next);
    try {
      await fsp.rename(tmp, target);
    } catch (e) {
      try { await fsp.rm(tmp, { force: true }); } catch { /* best effort */ }
      throw e;
    }
  }

  async function cli() {
    if (!cliPromise) cliPromise = Promise.resolve(ccCli.find()).catch(() => null);
    const found = await cliPromise;
    if (!found) cliPromise = null; // let a later call find a fresh install
    return found;
  }

  /** Make sure this account's config dir records limits via the status line. */
  async function prepareCcDir(a) {
    const dir = ccDirFor(a);
    if (!dir) throw err('unsupported', 'Plan limits are not available here.');
    const recorder = await limitsMod.ensureRecorder(deps.recorderFile);
    await limitsMod.ensureStatusLine(dir, limitsMod.statusLineCommand(recorder, path.join(dir, LIMITS_FILE)));
    return dir;
  }

  async function requireCli() {
    const found = await cli();
    if (!found) {
      throw err('no_claude_code',
        'Claude Code was not found. Open the Code tab in Claude Desktop once, or install it from code.claude.com, then try again.');
    }
    return found;
  }

  async function loadUsageCache() {
    if (!deps.usageCacheFile) return;
    try {
      const parsed = JSON.parse(await fsp.readFile(deps.usageCacheFile, 'utf8'));
      // Summaries written by an older reader lack newer fields, and the cache
      // key would never invalidate them. Discard rather than serve stale shape.
      usageCache = parsed && parsed.__v === SUMMARY_VERSION && parsed.files ? parsed.files : {};
    } catch {
      usageCache = {}; // a missing or unreadable cache just means a cold scan
    }
  }

  async function loadStorageCache() {
    if (!deps.storageCacheFile) return;
    try {
      storageCache = JSON.parse(await fsp.readFile(deps.storageCacheFile, 'utf8'));
    } catch {
      storageCache = {};
    }
  }

  async function saveStorageCache() {
    if (!deps.storageCacheFile) return;
    try {
      await fsp.mkdir(path.dirname(deps.storageCacheFile), { recursive: true });
      const tmp = deps.storageCacheFile + '.tmp';
      await fsp.writeFile(tmp, JSON.stringify(storageCache), 'utf8');
      await fsp.rename(tmp, deps.storageCacheFile);
    } catch {
      // a cache write failure must never break the feature
    }
  }

  async function saveUsageCache() {
    if (!deps.usageCacheFile || !usageCacheDirty) return;
    try {
      await fsp.mkdir(path.dirname(deps.usageCacheFile), { recursive: true });
      const tmp = deps.usageCacheFile + '.tmp';
      await fsp.writeFile(tmp, JSON.stringify({ __v: SUMMARY_VERSION, files: usageCache }), 'utf8');
      await fsp.rename(tmp, deps.usageCacheFile);
      usageCacheDirty = false;
    } catch {
      // the cache is an optimisation; failing to write it must never break usage
    }
  }

  const find = (id) => {
    const a = data.accounts.find((x) => x.id === id);
    if (!a) throw err('unknown_account', 'That account is no longer in the list.');
    return a;
  };

  // Re-resolves claude.exe whenever the remembered path has gone stale, which
  // is what happens every time the Store build updates itself.
  async function exe() {
    const resolved = await locator.resolve(data.exePath);
    if (!resolved) {
      throw err('no_exe', 'Could not find claude.exe. Use "Locate claude.exe…" to point at it.');
    }
    if (resolved !== data.exePath) {
      data.exePath = resolved;
      await persist();
    }
    return resolved;
  }

  return {
    async init() {
      const { data: loaded, recoveredFrom } = await store.load(deps.configFile);
      data = loaded;

      if (data.accounts.length === 0) {
        const now = () => new Date().toISOString();
        data.accounts.push({
          id: profiles.newId(), label: 'Default', kind: 'default',
          dir: deps.defaultProfileDir, createdAt: now()
        });

        // Adopt the folder the old Claude-Account2.bat created, in place.
        const work = path.join(deps.userProfile, 'Claude_Work');
        if (fs.existsSync(work)) {
          data.accounts.push({
            id: profiles.newId(), label: 'Work', kind: 'imported',
            dir: work, createdAt: now()
          });
        }
        await persist();
      }

      await fsp.mkdir(deps.profilesRoot, { recursive: true });
      await loadUsageCache();
      await loadStorageCache();
      return { recoveredFrom };
    },

    async list() {
      return data.accounts.map((a) => ({ ...a, exists: fs.existsSync(a.dir) }));
    },

    async add({ label }) {
      const clean = String(label || '').trim();
      if (clean === '') throw err('bad_label', 'Give the account a name.');

      const taken = new Set(data.accounts.map((a) => path.basename(a.dir).toLowerCase()));
      const slug = profiles.uniqueSlug(profiles.slugify(clean), taken);
      const dir = path.join(deps.profilesRoot, slug);
      await fsp.mkdir(dir, { recursive: true });

      const account = {
        id: profiles.newId(), label: clean, kind: 'managed',
        dir, createdAt: new Date().toISOString()
      };
      data.accounts.push(account);
      await persist();

      // Opens signed out; the user logs in inside Claude's own window.
      deps.launcher.launch(await exe(), account);
      return account;
    },

    /**
     * Mark an account as on Claude's free plan, or not. Claude Code only signs
     * in Pro, Max and Ultra (and Team/Enterprise) accounts, so a free one can
     * never show usage limits; marked free, it stops asking to connect.
     */
    async setFreePlan({ id, free }) {
      const a = find(id);
      if (free) a.freePlan = true;
      else delete a.freePlan;
      authCache.delete(id);
      planCache.delete(id);
      planHalted.delete(id);
      await persist();
      return { ok: true, freePlan: a.freePlan === true };
    },

    async rename({ id, label }) {
      const clean = String(label || '').trim();
      if (clean === '') throw err('bad_label', 'Give the account a name.');
      const a = find(id);
      a.label = clean; // the folder on disk is deliberately never renamed
      await persist();
      return a;
    },

    async launch({ id }) {
      const account = find(id);
      deps.launcher.launch(await exe(), account);
      return { ok: true };
    },

    /**
     * Quit a running profile — a force-kill of that one instance's process tree
     * (see closer.js for why a graceful close cannot work). The caller must have
     * confirmed with the user first: anything running inside it stops.
     *
     * Waits for the scan to agree the instance is gone, so the answer is what
     * actually happened rather than what was attempted.
     * Returns { closed, stillRunning }; closed:0 means it was not running.
     */
    async closeAccount({ id }) {
      const account = find(id);
      if (!deps.closer) throw err('unsupported', 'Closing is not available here.');

      const r = await deps.closer.close(account.dir);
      if (r.closed === 0) return { closed: 0, stillRunning: false };

      const target = P.normalizeDir(account.dir);
      const sleep = deps.sleep || ((ms) => new Promise((res) => setTimeout(res, ms)));
      let stillRunning = true;

      for (let i = 0; i < 8 && stillRunning; i++) {
        await sleep(i === 0 ? 300 : 500);
        const { dirs, ok } = await scanner.scan();
        if (!ok) continue; // a failed scan proves nothing either way
        const set = new Set(dirs.map(P.normalizeDir).filter(Boolean));
        stillRunning = set.has(target);
        if (activity) {
          try {
            await activity.record(
              data.accounts.filter((a) => set.has(P.normalizeDir(a.dir))).map((a) => a.id)
            );
          } catch { /* best effort */ }
        }
      }

      return { closed: r.closed, stillRunning };
    },

    async remove({ id, confirmLabel, unlockOutsideRoot }) {
      const account = find(id);
      const { dirs } = await scanner.scan();

      await deleter.removeProfile({
        account,
        runningDirs: dirs,
        confirmLabel,
        unlockOutsideRoot: unlockOutsideRoot === true,
        profilesRoot: deps.profilesRoot,
        userProfile: deps.userProfile
      });

      // The account's Claude Code sign-in goes with it. Guarded so it can only
      // ever delete a folder inside Multi-Claude's own cc root.
      const cc = ccDirFor(account);
      if (cc && P.isInside(cc, deps.ccRoot)) {
        try { await fsp.rm(cc, { recursive: true, force: true }); } catch { /* best effort */ }
      }
      // If VS Code was using this account, it would now point at a deleted
      // folder and look signed out. Take the block out instead, so VS Code
      // falls back to the plain ~/.claude. Best effort: the account is gone
      // either way, and a settings problem must not undo that.
      if (cc && deps.vscodeSettingsFile) {
        await vscodeSerially(async () => {
          const file = deps.vscodeSettingsFile;
          const text = await fsp.readFile(file, 'utf8');
          const pointed = vscodeSettings.readManaged(text);
          if (pointed && path.resolve(pointed).toLowerCase() === path.resolve(cc).toLowerCase()) {
            await writeVsCodeSettings(file, text, vscodeSettings.removeManaged(text));
          }
        }).catch(() => {});
      }
      authCache.delete(id);
      planCache.delete(id);
      planHalted.delete(id);

      data.accounts = data.accounts.filter((x) => x.id !== id);
      await persist();
      return { ok: true };
    },

    /** Drops the entry from the list. Never touches the filesystem. */
    async forget({ id }) {
      find(id);
      data.accounts = data.accounts.filter((x) => x.id !== id);
      await persist();
      return { ok: true };
    },

    /**
     * Open Gmail in the browser, for the email sign-in code. The address is
     * fixed here: the renderer cannot ask for any other page.
     */
    async openGmail() {
      await deps.shellImpl.openExternal(GMAIL_URL);
      return { ok: true };
    },

    async openFolder({ id }) {
      const a = find(id);
      if (!fs.existsSync(a.dir)) throw err('missing', 'That folder no longer exists.');
      await deps.shellImpl.openPath(a.dir);
      return { ok: true };
    },

    async createShortcut({ id }) {
      const a = find(id);
      await fsp.mkdir(deps.desktopDir, { recursive: true });
      return {
        path: createShortcut({
          shell: deps.shellImpl,
          desktopDir: deps.desktopDir,
          exePath: deps.appExePath,
          account: a,
          argsPrefix: deps.shortcutArgsPrefix || ''
        })
      };
    },

    async setExePath(p) {
      data.exePath = p;
      await persist();
      return { ok: true };
    },

    async scan() {
      const { dirs, ok } = await scanner.scan();
      const set = new Set(dirs.map(P.normalizeDir).filter(Boolean));
      const running = data.accounts
        .filter((a) => set.has(P.normalizeDir(a.dir)))
        .map((a) => a.id);

      // Only record when the scan actually succeeded. A failed scan returns an
      // empty set, and treating that as "everything stopped" would write a
      // stream of false stop events into the activity log.
      if (ok && activity) {
        try { await activity.record(running); } catch { /* logging is best effort */ }
      }

      return { running, ok };
    },

    /** Token and cost metadata from Claude Code's session logs. */
    async usage({ days = 30 } = {}) {
      if (!deps.claudeProjectsRoot) {
        throw err('no_usage_source', 'Claude Code session logs were not found on this machine.');
      }
      const r = await scanUsage({ projectsRoot: deps.claudeProjectsRoot, cache: usageCache });
      if (r.parsed > 0) usageCacheDirty = true;
      usageCache = r.cache;
      saveUsageCache(); // deliberately not awaited: the answer should not wait on disk

      return {
        ...buildDashboard(r.sessions, { days }),
        scan: { files: r.files, parsed: r.parsed, reused: r.reused }
      };
    },

    /**
     * Identity of the account Claude Code is signed in as. One account only —
     * see account-info.js for why there is no per-profile equivalent.
     */
    async accountInfo() {
      if (!deps.claudeConfigFile) {
        return { available: false, reason: 'Claude Code config path not configured.' };
      }
      return readAccountInfo(deps.claudeConfigFile);
    },

    /**
     * Each account's real Session (5hr) / Weekly (7 day) limits, as recorded by
     * that account's own Claude Code status line. See limits.js.
     */
    async limits({ force = false, cachedOnly = false } = {}) {
      const found = await cli();
      const now = Date.now();

      const rows = await Promise.all(data.accounts.map(async (a) => {
        // A free Claude plan can't sign in to Claude Code, so there is nothing
        // to ask: no process is started for it.
        if (a.freePlan === true) {
          return { id: a.id, label: a.label, freePlan: true, connected: false, auth: { loggedIn: false }, plan: null, limits: null };
        }
        const dir = ccDirFor(a);
        const connected = !!dir && fs.existsSync(dir);
        let auth = { loggedIn: false };

        if (connected && found) {
          const hit = authCache.get(a.id);
          if (cachedOnly) {
            // Instant answer for first paint: no process is started.
            auth = hit ? hit.auth : { loggedIn: false, pending: true };
          } else if (!force && hit && now - hit.at < AUTH_TTL_MS) {
            auth = hit.auth;
          } else {
            auth = await ccCli.authStatus(found.path, dir);
            authCache.set(a.id, { at: now, auth });
          }
        }

        // Primary source: Claude Code's own /usage report, fetched with no
        // window and no model call. Fallback: whatever the status line last
        // recorded, if the account was ever used in Claude Code.
        let plan = null;
        if (connected && found && auth.loggedIn) {
          const hit = planCache.get(a.id);
          if (cachedOnly) {
            plan = hit ? hit.value : null;
          } else if (!force && hit && now - hit.at < PLAN_TTL_MS) {
            plan = hit.value;
          } else if (!force && planHalted.has(a.id)) {
            plan = hit ? hit.value : { ok: false, reachedModel: true, reason: 'Paused: Claude Code answered /usage with the model.' };
          } else {
            plan = await ccUsage.fetch(found.path, dir);
            plan.fetchedAt = now;
            planCache.set(a.id, { at: now, value: plan });
            if (plan.reachedModel) planHalted.add(a.id);
            if (plan.needsSignIn) authCache.delete(a.id);
          }
        }

        const lim = connected ? await limitsMod.readLimits(path.join(dir, LIMITS_FILE), now) : null;
        return { id: a.id, label: a.label, connected, auth, plan, limits: lim };
      }));

      return {
        cli: found ? { version: found.version.join('.') } : null,
        accounts: rows
      };
    },

    /**
     * Start Anthropic's own sign-in for this account, with no terminal window.
     * The CLI opens the browser; the UI polls loginStatus and can pass a pasted
     * code through loginSubmit. See cc-login.js.
     */
    async connectAccount({ id }) {
      const a = find(id);
      const found = await requireCli();
      const dir = await prepareCcDir(a);
      authCache.delete(id);
      return logins.start(id, { cliPath: found.path, configDir: dir });
    },

    async loginStatus({ id }) {
      find(id);
      const st = logins.status(id);
      if (st.state === 'done') {
        // Next limits() re-asks the CLI and fetches a fresh report.
        authCache.delete(id);
        planCache.delete(id);
        planHalted.delete(id);
      }
      return st;
    },

    async loginSubmit({ id, code }) {
      find(id);
      return logins.submit(id, code);
    },

    async loginCancel({ id }) {
      return logins.cancel(id);
    },

    async loginOpenPage({ id }) {
      find(id);
      return logins.openPage(id);
    },

    /**
     * Download Anthropic's Claude Code into Multi-Claude's own folder, for a PC
     * that has none. Not awaited by the caller: the UI polls ccInstallStatus.
     */
    ccInstallStart() {
      if (!deps.ccInstaller) throw err('unsupported', 'Downloading Claude Code is not available here.');
      deps.ccInstaller.start().catch(() => {});
      return deps.ccInstaller.status();
    },

    ccInstallStatus() {
      return deps.ccInstaller ? deps.ccInstaller.status() : { state: 'idle' };
    },

    /** Open an interactive Claude Code session as this account. */
    async openClaudeCode({ id }) {
      const a = find(id);
      const found = await requireCli();
      const dir = await prepareCcDir(a);
      ccCli.openTerminal(found.path, dir, [], { title: `Claude Code: ${a.label}` });
      return { ok: true };
    },

    /**
     * Point VS Code's Claude Code at this account.
     *
     * The extension watches this setting and refreshes in place, so an editor
     * that is already open switches account without a new window.
     */
    async useVsCodeAccount({ id }) {
      const a = find(id);
      const file = deps.vscodeSettingsFile;
      if (!file) throw err('unsupported', 'VS Code settings are not available here.');
      return vscodeSerially(async () => {
        const ccDir = await prepareCcDir(a);

        let text = '';
        try {
          text = await fsp.readFile(file, 'utf8');
        } catch (e) {
          // Not being there is fine — we create it. Anything else means it
          // exists and cannot be read, and writing would destroy it.
          if (!e || e.code !== 'ENOENT') {
            throw err('vscode_settings', `Could not read your VS Code settings: ${e && e.message}`);
          }
        }

        // A key outside our block is the user's own. Do not fight it: in JSONC
        // the last key wins, so a second copy could silently pick the account.
        if (vscodeSettings.hasForeignKey(text)) {
          return { ok: true, switched: false, reason: 'foreign', launched: false };
        }

        await writeVsCodeSettings(file, text, vscodeSettings.writeManaged(text, ccDir));

        // An open editor picks the setting up by itself; only start one if none is.
        if (await vscode.isRunning()) return { ok: true, switched: true, launched: false };
        const exe = await vscode.find();
        if (!exe) return { ok: true, switched: true, launched: false, notFound: true };
        vscode.launch(exe);
        return { ok: true, switched: true, launched: true };
      });
    },

    /** Launch history that Multi-Claude observed itself. */
    async activity({ days = 30 } = {}) {
      if (!activity) return { accounts: [], daily: [], recent: [], observedSince: null };

      const events = await activity.read();
      const now = Date.now();
      const sessions = buildSessions(events, now);
      const summary = summariseActivity(sessions, { days, now });
      const labels = Object.fromEntries(data.accounts.map((a) => [a.id, a.label]));
      const name = (id) => labels[id] || '(removed account)';

      return {
        accounts: summary.accounts.map((a) => ({ ...a, label: name(a.id) })),
        daily: summary.daily,
        recent: sessions.slice(0, 60).map((s) => ({ ...s, label: name(s.id) })),
        observedSince: events.length ? Math.min(...events.map((e) => e.t)) : null
      };
    },

    /**
     * Per-profile disk usage split into vm / runtime / cache / sessions / data.
     *
     * Walking these profiles means ~23 GB across hundreds of thousands of
     * files, so results are cached on disk and reused for STORAGE_TTL_MS. The
     * Recalculate button passes force:true.
     */
    async storage({ force = false } = {}) {
      const now = Date.now();
      const out = [];
      let changed = false;

      for (const a of data.accounts) {
        const hit = storageCache[a.dir];
        if (!force && hit && now - hit.at < STORAGE_TTL_MS) {
          out.push({ id: a.id, label: a.label, kind: a.kind, dir: a.dir, ...hit.value, cached: true });
          continue;
        }
        const value = await breakdown(a.dir);
        storageCache[a.dir] = { at: now, value };
        changed = true;
        out.push({ id: a.id, label: a.label, kind: a.kind, dir: a.dir, ...value, cached: false });
      }

      if (changed) saveStorageCache(); // not awaited: the answer should not wait on disk
      return out;
    },

    async purgeCache({ id }) {
      const account = find(id);
      const { dirs } = await scanner.scan();
      return purgeCaches({ account, runningDirs: dirs });
    },

    /** Called on shutdown so an open activity session gets a real end time. */
    async shutdown() {
      try { logins.cancelAll(); } catch { /* best effort */ }
      if (activity) {
        try { await activity.closeAll(); } catch { /* best effort */ }
      }
      await saveUsageCache(); // no-ops unless a scan actually changed it
    },

    async sizes() {
      const out = {};
      for (const a of data.accounts) out[a.id] = await profiles.dirSize(a.dir);
      return out;
    },

    _setScannerForTest(s) { scanner = s; },
    _setCloserForTest(c) { deps.closer = c; },
    _setSleepForTest(f) { deps.sleep = f; },
    _expirePlanCacheForTest() { for (const v of planCache.values()) v.at = 0; },
    _setLocatorForTest(l) { locator = l; }
  };
}

module.exports = { createService };
