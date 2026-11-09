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
const { scanUsage } = require('./usage-reader.js');
const { buildDashboard } = require('./usage-aggregate.js');
const { createActivityLog, buildSessions, summariseActivity } = require('./activity-log.js');
const { breakdown, purgeCaches } = require('./storage.js');

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

  async function loadUsageCache() {
    if (!deps.usageCacheFile) return;
    try {
      usageCache = JSON.parse(await fsp.readFile(deps.usageCacheFile, 'utf8'));
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
      await fsp.writeFile(tmp, JSON.stringify(usageCache), 'utf8');
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
    _setLocatorForTest(l) { locator = l; }
  };
}

module.exports = { createService };
