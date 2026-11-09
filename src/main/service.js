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

function err(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

function createService(deps) {
  let data = store.emptyStore();
  let scanner = deps.scanner;
  let locator = deps.locator;

  const persist = () => store.save(deps.configFile, data);

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
          account: a
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
      return { running, ok };
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
