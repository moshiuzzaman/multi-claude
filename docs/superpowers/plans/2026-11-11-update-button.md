# In-App Updates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Multi-Claude checks GitHub Releases when it opens; when a newer version exists it shows **What's new** and **Update** in the sidebar footer, and Update installs it silently and restarts the app. Otherwise the footer says everything is up to date.

**Architecture:** Three small main-process modules — `update-feed.js` (pure parsing and URLs), `update-http.js` (GET with redirects, verified download) and `updater.js` (a state machine over injected I/O) — exposed through five IPC channels. The renderer adds an `UpdateFoot` line and a `WhatsNewDialog`. The installer is electron-builder's own NSIS installer, run with `/S --updated --force-run`.

**Tech Stack:** Node 22, Electron 33, React 18, `node:test`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-11-update-button-design.md`

### Where this plan departs from the spec, on purpose

- **The repo is a constant, not read from `package.json` at runtime.** electron-builder strips the `build` key from the packaged `package.json` (`app-builder-lib/out/fileTransformer.js`, `ignoredPackageMetadataProperties`), so the installed app could never read `build.publish`. `src/main/update-config.js` holds `{ owner, repo }` and a test fails if it ever differs from `build.publish`.
- **The installer's size comes from the `files:` entry in `latest.yml`.** electron-builder writes `size` only there (`createBlockmap` → `files[0]`), not at the top level.
- **Five IPC channels, not four.** `updateOpenPage` opens the releases page from the What's new dialog when notes cannot load; the renderer cannot open external links itself (`setWindowOpenHandler` denies them) and must not pass URLs over IPC.
- **Two modules beside `updater.js`.** Parsing and HTTP live in their own files so each is small and tested on its own.
- **Stalls are timed per chunk.** A socket timeout that fires mid-body reaches the response only as a generic `aborted`, so `update-http.js` clears the request timeout once headers arrive and runs its own per-chunk timer that fails with code `timeout`. Verified against a local server before this plan was written.

---

## Global Constraints

- Windows only. **No new runtime dependency.**
- Updates come only from `https://github.com/moshiuzzaman/multi-claude`. Download URLs are built from `update-config.js` and the file name in `latest.yml`; nothing else from the network becomes part of a URL. A redirect away from HTTPS is refused.
- A downloaded installer runs only after its size **and** SHA-512 match `latest.yml`; otherwise it is deleted.
- Binaries are launched directly, never through a shell.
- The preload bridge passes no paths or URLs.
- Release notes are rendered as text, never as HTML.
- Nothing downloads or installs without a click. One check per launch.
- Tests run under `node --test` with no Electron and no internet (a local `127.0.0.1` server is fine).
- Builds and releases run from an ordinary terminal, never from inside Claude Desktop (README, *Build from your own terminal*).
- Commits made by an agent end with a `Co-Authored-By:` trailer naming that agent's own model.

---

### Task 1: The release feed and its configuration

**Files:**
- Create: `src/main/update-config.js`
- Create: `src/main/update-feed.js`
- Modify: `package.json` (`scripts`, `build`)
- Test: `test/update-feed.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `update-config.js` → `{ owner: 'moshiuzzaman', repo: 'multi-claude' }`
  - `parseLatestYml(text) -> { version, path, sha512, size } | null`
  - `isNewer(a, b) -> boolean` — true when `a` is strictly newer than `b`
  - `safeAssetName(name) -> boolean`
  - `parseReleases(list, currentVersion) -> [{ version, date, notes }]`, newest first
  - `feedUrls({ owner, repo }) -> { latestYml, releasesApi, releasesPage, asset(version, name), releasePage(version) }`

- [ ] **Step 1: Write the failing test**

Create `test/update-feed.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const F = require('../src/main/update-feed.js');

// What electron-builder writes for an NSIS build: size lives only in files[].
const SAMPLE = [
  'version: 1.3.0',
  'files:',
  '  - url: Multi-Claude-Setup-1.3.0.exe',
  '    sha512: QUJD+/==',
  '    size: 86123456',
  'path: Multi-Claude-Setup-1.3.0.exe',
  'sha512: QUJD+/==',
  "releaseDate: '2026-11-11T10:00:00.000Z'",
  ''
].join('\n');

const WANT = { version: '1.3.0', path: 'Multi-Claude-Setup-1.3.0.exe', sha512: 'QUJD+/==', size: 86123456 };

test('parseLatestYml reads what electron-builder writes', () => {
  assert.deepStrictEqual(F.parseLatestYml(SAMPLE), WANT);
});

test('parseLatestYml tolerates CRLF and quoted values', () => {
  const text = SAMPLE.replace("version: 1.3.0", "version: '1.3.0'")
    .replace('path: Multi-Claude-Setup-1.3.0.exe', 'path: "Multi-Claude-Setup-1.3.0.exe"')
    .replace(/\n/g, '\r\n');
  assert.deepStrictEqual(F.parseLatestYml(text), WANT);
});

test('parseLatestYml returns null when a field is missing', () => {
  assert.strictEqual(F.parseLatestYml(SAMPLE.replace('    size: 86123456\n', '')), null);
  assert.strictEqual(F.parseLatestYml(SAMPLE.replace('path: Multi-Claude-Setup-1.3.0.exe\n', '')), null);
  assert.strictEqual(F.parseLatestYml(SAMPLE.replace('version: 1.3.0\n', '')), null);
  assert.strictEqual(F.parseLatestYml(''), null);
  assert.strictEqual(F.parseLatestYml('<html>not yaml</html>'), null);
});

test('isNewer compares numerically, ignoring a leading v', () => {
  assert.strictEqual(F.isNewer('1.10.0', '1.9.2'), true);
  assert.strictEqual(F.isNewer('v1.3.0', '1.2.9'), true);
  assert.strictEqual(F.isNewer('1.2.0', '1.2.0'), false);
  assert.strictEqual(F.isNewer('1.2.0', '1.3.0'), false);
});

test('isNewer never treats a prerelease or garbage as newer', () => {
  assert.strictEqual(F.isNewer('1.3.0-beta.1', '1.2.0'), false);
  assert.strictEqual(F.isNewer('latest', '1.0.0'), false);
});

test('safeAssetName accepts a plain installer name only', () => {
  assert.strictEqual(F.safeAssetName('Multi-Claude-Setup-1.3.0.exe'), true);
  for (const bad of ['../x.exe', 'a/b.exe', 'a\\b.exe', '', 'setup.msi', null]) {
    assert.strictEqual(F.safeAssetName(bad), false, String(bad));
  }
});

test('parseReleases keeps newer published releases, newest first', () => {
  const list = [
    { tag_name: 'v1.3.0', draft: false, prerelease: false, published_at: '2026-11-20T00:00:00Z', body: 'three' },
    { tag_name: 'v1.5.0', draft: true, prerelease: false, published_at: null, body: 'draft' },
    { tag_name: 'v1.4.0-beta.1', draft: false, prerelease: true, published_at: '2026-11-25T00:00:00Z', body: 'beta' },
    { tag_name: 'v1.2.0', draft: false, prerelease: false, published_at: '2026-11-11T00:00:00Z', body: 'current' },
    { tag_name: 'v1.4.0', draft: false, prerelease: false, published_at: '2026-11-30T00:00:00Z', body: null }
  ];
  assert.deepStrictEqual(F.parseReleases(list, '1.2.0'), [
    { version: '1.4.0', date: '2026-11-30T00:00:00Z', notes: '' },
    { version: '1.3.0', date: '2026-11-20T00:00:00Z', notes: 'three' }
  ]);
  assert.deepStrictEqual(F.parseReleases({ message: 'rate limited' }, '1.2.0'), []);
});

test('feedUrls builds every address from the repo alone', () => {
  const u = F.feedUrls({ owner: 'o', repo: 'r' });
  assert.strictEqual(u.latestYml, 'https://github.com/o/r/releases/latest/download/latest.yml');
  assert.strictEqual(u.releasesApi, 'https://api.github.com/repos/o/r/releases?per_page=30');
  assert.strictEqual(u.releasesPage, 'https://github.com/o/r/releases');
  assert.strictEqual(u.asset('1.3.0', 'Multi-Claude-Setup-1.3.0.exe'),
    'https://github.com/o/r/releases/download/v1.3.0/Multi-Claude-Setup-1.3.0.exe');
  assert.strictEqual(u.releasePage('1.3.0'), 'https://github.com/o/r/releases/tag/v1.3.0');
});

test('the updater checks the repo electron-builder publishes to', () => {
  const pkg = require('../package.json');
  const cfg = require('../src/main/update-config.js');
  assert.strictEqual(pkg.build.publish.provider, 'github');
  assert.deepStrictEqual(
    { owner: pkg.build.publish.owner, repo: pkg.build.publish.repo },
    { owner: cfg.owner, repo: cfg.repo }
  );
});

test('artifact names have no spaces, so GitHub keeps them matching latest.yml', () => {
  const pkg = require('../package.json');
  assert.ok(!/\s/.test(pkg.build.nsis.artifactName));
  assert.ok(!/\s/.test(pkg.build.portable.artifactName));
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `node --test test/update-feed.test.js`
Expected: FAIL — `Cannot find module '../src/main/update-feed.js'`.

- [ ] **Step 3: Write `update-config.js`**

```js
'use strict';
// Where Multi-Claude looks for new versions.
//
// A constant rather than a read of package.json: electron-builder strips the
// `build` key from the packaged package.json, so the installed app could never
// see `build.publish`. test/update-feed.test.js fails if the two drift apart.

module.exports = Object.freeze({ owner: 'moshiuzzaman', repo: 'multi-claude' });
```

- [ ] **Step 4: Write `update-feed.js`**

```js
'use strict';
// Reading what GitHub Releases says about the newest version. Pure functions:
// text and JSON in, plain values out, so all of it tests without a network.

function unquote(v) {
  const s = String(v).trim();
  const q = s[0];
  if (s.length >= 2 && (q === "'" || q === '"') && s[s.length - 1] === q) return s.slice(1, -1);
  return s;
}

/**
 * The installer described by electron-builder's latest.yml, or null.
 *
 * Reads only the keys it needs, line by line — not a YAML parser. The size is
 * taken from the `files:` entry whose url matches `path`, because that is the
 * only place electron-builder writes it.
 */
function parseLatestYml(text) {
  const top = {};
  const files = [];
  for (const line of String(text ?? '').split(/\r?\n/)) {
    let m;
    if ((m = /^\s*-\s+url:\s*(.*)$/.exec(line))) {
      files.push({ url: unquote(m[1]) });
    } else if ((m = /^\s+(sha512|size):\s*(.*)$/.exec(line)) && files.length) {
      files[files.length - 1][m[1]] = unquote(m[2]);
    } else if ((m = /^(version|path|sha512):\s*(.*)$/.exec(line))) {
      top[m[1]] = unquote(m[2]);
    }
  }
  const file = files.find((f) => f.url === top.path);
  const size = Number(file && file.size);
  const sha512 = (file && file.sha512) || top.sha512;
  if (!top.version || !top.path || !sha512 || !Number.isInteger(size) || size <= 0) return null;
  return { version: top.version, path: top.path, sha512, size };
}

function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(-.+)?$/.exec(String(v ?? '').trim());
  return m ? { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: !!m[4] } : null;
}

/** Is `a` strictly newer than `b`? A prerelease never counts as newer. */
function isNewer(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y || x.pre) return false;
  for (let i = 0; i < 3; i++) {
    if (x.nums[i] !== y.nums[i]) return x.nums[i] > y.nums[i];
  }
  return false;
}

/**
 * The installer's file name is the one part of a download URL that comes from
 * the network, so it must be a plain .exe name: no path, no traversal.
 */
function safeAssetName(name) {
  return typeof name === 'string' && /\.exe$/i.test(name) && !/[\\/]/.test(name) && !name.includes('..');
}

/** Published releases newer than the running version, newest first. */
function parseReleases(list, currentVersion) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((r) => r && !r.draft && !r.prerelease && isNewer(r.tag_name, currentVersion))
    .map((r) => ({
      version: String(r.tag_name).replace(/^v/, ''),
      date: r.published_at || null,
      notes: typeof r.body === 'string' ? r.body : ''
    }))
    .sort((a, b) => (isNewer(a.version, b.version) ? -1 : isNewer(b.version, a.version) ? 1 : 0));
}

/** Every address the updater uses, built from the repo alone. */
function feedUrls({ owner, repo }) {
  const site = `https://github.com/${owner}/${repo}`;
  return {
    latestYml: `${site}/releases/latest/download/latest.yml`,
    releasesApi: `https://api.github.com/repos/${owner}/${repo}/releases?per_page=30`,
    releasesPage: `${site}/releases`,
    asset: (version, name) => `${site}/releases/download/v${version}/${encodeURIComponent(name)}`,
    releasePage: (version) => `${site}/releases/tag/v${version}`
  };
}

module.exports = { parseLatestYml, isNewer, safeAssetName, parseReleases, feedUrls };
```

- [ ] **Step 5: Configure publishing in `package.json`**

In `scripts`, replace `dist` and add `release`:

```json
    "dist": "npm run build:renderer && electron-builder --publish never",
    "release": "npm run build:renderer && electron-builder --publish always"
```

In `build`, add `publish` after `files`, add `artifactName` to the existing `nsis` block, and add a `portable` block:

```json
    "publish": {
      "provider": "github",
      "owner": "moshiuzzaman",
      "repo": "multi-claude",
      "releaseType": "draft"
    },
```

```json
    "nsis": {
      "oneClick": false,
      "perMachine": false,
      "allowToChangeInstallationDirectory": true,
      "createDesktopShortcut": true,
      "shortcutName": "Multi-Claude",
      "artifactName": "Multi-Claude-Setup-${version}.${ext}"
    },
    "portable": {
      "artifactName": "Multi-Claude-${version}-portable.${ext}"
    }
```

- [ ] **Step 6: Run the tests and watch them pass**

Run: `npm test`
Expected: PASS — every new test, and every existing one still green.

- [ ] **Step 7: Commit**

```bash
git add src/main/update-config.js src/main/update-feed.js test/update-feed.test.js package.json
git commit -m "feat: read the GitHub release feed for updates"
```

---

### Task 2: Fetching and verified downloading

**Files:**
- Create: `src/main/update-http.js`
- Test: `test/update-http.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `fetchText(url, { timeoutMs = 15000, accept }?) -> Promise<string>`
  - `fetchJson(url, opts?) -> Promise<any>`
  - `downloadVerified(url, dest, { sha512, size, onProgress?, stallMs = 60000 }) -> Promise<void>`
  - Errors carry `code`: `not_found`, `http_status`, `timeout`, `network`, `damaged`, `bad_url`, `bad_json`, `too_large`, `too_many_redirects`, `insecure_redirect`.

- [ ] **Step 1: Write the failing test**

Create `test/update-http.test.js`:

```js
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const H = require('../src/main/update-http.js');

const BODY = Buffer.alloc(300000, 7);
const SHA = crypto.createHash('sha512').update(BODY).digest('base64');
let server;
let base;
let dir;

before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/redirect') { res.writeHead(302, { Location: '/file' }); return res.end(); }
    if (req.url === '/file') { res.writeHead(200, { 'content-length': BODY.length }); return res.end(BODY); }
    if (req.url === '/stall') {
      // Headers and a little data, then nothing: a stalled download.
      res.writeHead(200, { 'content-length': BODY.length });
      res.write(BODY.subarray(0, 1000));
      return undefined;
    }
    if (req.url === '/text') { res.writeHead(200); return res.end('version: 1.3.0'); }
    if (req.url === '/json') { res.writeHead(200); return res.end('[{"tag_name":"v1.3.0"}]'); }
    res.writeHead(404);
    return res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-upd-'));
});

after(() => {
  server.closeAllConnections();
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('fetchText and fetchJson read an answer', async () => {
  assert.strictEqual(await H.fetchText(`${base}/text`), 'version: 1.3.0');
  assert.deepStrictEqual(await H.fetchJson(`${base}/json`), [{ tag_name: 'v1.3.0' }]);
});

test('a missing file is reported as not_found', async () => {
  await assert.rejects(() => H.fetchText(`${base}/nope`), (e) => e.code === 'not_found');
});

test('only http and https addresses are fetched', async () => {
  await assert.rejects(() => H.fetchText('ftp://127.0.0.1/x'), (e) => e.code === 'bad_url');
});

test('downloadVerified follows a redirect, reports progress and keeps a good file', async () => {
  const dest = path.join(dir, 'sub', 'good.exe');
  const seen = [];
  await H.downloadVerified(`${base}/redirect`, dest, { sha512: SHA, size: BODY.length, onProgress: (p) => seen.push(p) });
  assert.ok(fs.readFileSync(dest).equals(BODY));
  assert.strictEqual(seen[seen.length - 1], 1);
});

test('a checksum mismatch deletes the file and never keeps it', async () => {
  const dest = path.join(dir, 'bad.exe');
  await assert.rejects(
    () => H.downloadVerified(`${base}/file`, dest, { sha512: 'not-it', size: BODY.length }),
    (e) => e.code === 'damaged'
  );
  assert.strictEqual(fs.existsSync(dest), false);
});

test('a size mismatch is damage too', async () => {
  const dest = path.join(dir, 'short.exe');
  await assert.rejects(
    () => H.downloadVerified(`${base}/file`, dest, { sha512: SHA, size: BODY.length + 1 }),
    (e) => e.code === 'damaged'
  );
  assert.strictEqual(fs.existsSync(dest), false);
});

test('a stalled download times out and deletes the partial file', async () => {
  const dest = path.join(dir, 'stall.exe');
  await assert.rejects(
    () => H.downloadVerified(`${base}/stall`, dest, { sha512: SHA, size: BODY.length, stallMs: 300 }),
    (e) => e.code === 'timeout'
  );
  assert.strictEqual(fs.existsSync(dest), false);
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `node --test test/update-http.test.js`
Expected: FAIL — `Cannot find module '../src/main/update-http.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/main/update-http.js`:

```js
'use strict';
// Plain GETs for the updater: redirects followed, nothing kept that does not
// verify. Node's own http/https, so there is no dependency to package.

const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const MAX_REDIRECTS = 5;
const MAX_TEXT_BYTES = 5 * 1024 * 1024;
// GitHub's API refuses requests without a User-Agent. Nothing about the user.
const HEADERS = { 'User-Agent': 'Multi-Claude-updater' };

function httpErr(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

/** GET `url`, following redirects; resolves with a 200 response stream. */
function open(url, { timeoutMs, accept } = {}, hops = 0) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch { return reject(httpErr('bad_url', 'Not a valid address.')); }
    const lib = u.protocol === 'https:' ? https : u.protocol === 'http:' ? http : null;
    if (!lib) return reject(httpErr('bad_url', `Unsupported address: ${u.protocol}`));
    const headers = accept ? { ...HEADERS, Accept: accept } : HEADERS;

    const req = lib.get(u, { headers }, (res) => {
      // The answer has started; from here a stall is timed per chunk instead,
      // because a socket timeout mid-body reaches the response only as a
      // generic 'aborted'.
      req.setTimeout(0);
      const s = res.statusCode;
      if (s >= 300 && s < 400 && res.headers.location) {
        res.resume();
        if (hops >= MAX_REDIRECTS) return reject(httpErr('too_many_redirects', 'Too many redirects.'));
        const next = new URL(res.headers.location, u);
        if (u.protocol === 'https:' && next.protocol !== 'https:') {
          return reject(httpErr('insecure_redirect', 'Refused a redirect away from HTTPS.'));
        }
        return resolve(open(next.toString(), { timeoutMs, accept }, hops + 1));
      }
      if (s !== 200) {
        res.resume();
        return reject(httpErr(s === 404 ? 'not_found' : 'http_status', `The server answered ${s}.`));
      }
      return resolve(res);
    });
    req.on('error', (e) => reject(e.code === 'timeout' ? e : httpErr('network', e.message)));
    if (timeoutMs) {
      req.setTimeout(timeoutMs, () => {
        req.destroy(httpErr('timeout', `No answer for ${Math.max(1, Math.round(timeoutMs / 1000))} s.`));
      });
    }
    return undefined;
  });
}

/** Fail with code 'timeout' when no data arrives for `ms`. */
function stallGuard(res, ms) {
  let t = null;
  const arm = () => {
    clearTimeout(t);
    t = setTimeout(() => res.destroy(httpErr('timeout', `No data for ${Math.max(1, Math.round(ms / 1000))} s.`)), ms);
  };
  res.on('data', arm);
  res.on('close', () => clearTimeout(t));
  arm();
}

async function fetchText(url, { timeoutMs = 15000, accept } = {}) {
  const res = await open(url, { timeoutMs, accept });
  stallGuard(res, timeoutMs);
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    res.on('data', (c) => {
      total += c.length;
      if (total > MAX_TEXT_BYTES) res.destroy(httpErr('too_large', 'The answer was too large.'));
      else chunks.push(c);
    });
    res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    res.on('error', (e) => reject(e.code === 'timeout' || e.code === 'too_large' ? e : httpErr('network', e.message)));
  });
}

async function fetchJson(url, opts = {}) {
  const text = await fetchText(url, { accept: 'application/vnd.github+json', ...opts });
  try { return JSON.parse(text); } catch { throw httpErr('bad_json', 'The answer was not valid JSON.'); }
}

/**
 * Download to `dest`, hashing as it writes. Kept only when both the size and
 * the SHA-512 match; anything else deletes the file, so a damaged or swapped
 * installer can never be run.
 */
async function downloadVerified(url, dest, { sha512, size, onProgress = () => {}, stallMs = 60000 }) {
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const res = await open(url, { timeoutMs: stallMs });
  stallGuard(res, stallMs);
  const total = Number(res.headers['content-length']) || size;
  const hash = crypto.createHash('sha512');
  const out = fs.createWriteStream(dest);
  let got = 0;
  try {
    await new Promise((resolve, reject) => {
      res.on('data', (c) => {
        hash.update(c);
        got += c.length;
        onProgress(Math.min(1, got / total));
      });
      res.on('error', reject);
      out.on('error', reject);
      out.on('finish', resolve);
      res.pipe(out);
    });
    if (got !== size || hash.digest('base64') !== sha512) {
      throw httpErr('damaged', 'The download was damaged; nothing was installed.');
    }
  } catch (e) {
    // Close the handle before deleting: Windows refuses to delete an open file.
    await new Promise((r) => {
      if (out.closed) return r();
      out.once('close', r);
      return out.destroy();
    });
    try { await fsp.rm(dest, { force: true }); } catch { /* best effort */ }
    if (e.code === 'timeout' || e.code === 'damaged') throw e;
    throw httpErr('network', e.message);
  }
}

module.exports = { fetchText, fetchJson, downloadVerified };
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npm test`
Expected: PASS. The stall test takes about 300 ms.

- [ ] **Step 5: Commit**

```bash
git add src/main/update-http.js test/update-http.test.js
git commit -m "feat: fetch release files and keep only verified downloads"
```

---

### Task 3: The updater state machine

**Files:**
- Create: `src/main/updater.js`
- Test: `test/updater.test.js`

**Interfaces:**
- Consumes: Task 1's `parseLatestYml`, `isNewer`, `safeAssetName`, `parseReleases`, `feedUrls`. Task 2's functions are injected, not required, so the shapes matter: `fetchText(url) -> Promise<string>`, `fetchJson(url) -> Promise<any>`, `download(url, dest, { sha512, size, onProgress }) -> Promise<void>`.
- Produces: `createUpdater({ fetchText, fetchJson, download, spawn, quit, openExternal, currentVersion, mode, repo, tmpDir }) -> { check(), install(), status(), changelog(), openReleasesPage() }`, and `INSTALL_ARGS`.
  - `status()` → `{ state, current, mode, latest?, progress?, reason?, note? }`, where `state` is one of `idle`, `checking`, `current`, `available`, `check-failed`, `downloading`, `installing`, `failed`, and `mode` is `installed`, `portable` or `source`.
  - `check()` and `install()` resolve to `status()` and never throw.
  - `install()` sets `downloading` synchronously before its first `await`, so a caller that does not await it can return `status()` straight away.
  - `changelog()` → `{ ok: true, releases } | { ok: false, reason }`.

- [ ] **Step 1: Write the failing test**

Create `test/updater.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createUpdater, INSTALL_ARGS } = require('../src/main/updater.js');

const yml = (v) => [
  `version: ${v}`,
  'files:',
  `  - url: Multi-Claude-Setup-${v}.exe`,
  '    sha512: SHA==',
  '    size: 1234',
  `path: Multi-Claude-Setup-${v}.exe`,
  'sha512: SHA==',
  ''
].join('\n');

const TMP = path.join('C:', 'tmp', 'mc-update');

function child(event = 'spawn', err) {
  const c = new EventEmitter();
  c.unref = () => { c.unrefed = true; };
  process.nextTick(() => c.emit(event, err));
  return c;
}

function harness(over = {}) {
  const calls = { fetched: [], downloads: [], spawned: [], quit: 0, opened: [] };
  const deps = {
    fetchText: async (url) => { calls.fetched.push(url); return yml('1.3.0'); },
    fetchJson: async () => [],
    download: async (url, dest, opts) => { calls.downloads.push({ url, dest, opts }); },
    spawn: (exe, args, opts) => { const c = child(); calls.spawned.push({ exe, args, opts, c }); return c; },
    quit: () => { calls.quit += 1; },
    openExternal: (u) => { calls.opened.push(u); },
    currentVersion: '1.2.0',
    mode: 'installed',
    repo: { owner: 'o', repo: 'r' },
    tmpDir: TMP,
    ...over
  };
  return { u: createUpdater(deps), calls };
}

const notFound = () => Object.assign(new Error('The server answered 404.'), { code: 'not_found' });

test('starts idle and reports the running version', () => {
  const { u } = harness();
  assert.deepStrictEqual(u.status(), { state: 'idle', current: '1.2.0', mode: 'installed' });
});

test('check finds a newer version from latest.yml', async () => {
  const { u, calls } = harness();
  const st = await u.check();
  assert.strictEqual(st.state, 'available');
  assert.strictEqual(st.latest, '1.3.0');
  assert.deepStrictEqual(calls.fetched, ['https://github.com/o/r/releases/latest/download/latest.yml']);
});

test('check reports up to date when the latest is not newer', async () => {
  const { u } = harness({ fetchText: async () => yml('1.2.0') });
  assert.strictEqual((await u.check()).state, 'current');
});

test('no release published yet counts as up to date, with a note', async () => {
  const { u } = harness({ fetchText: async () => { throw notFound(); } });
  const st = await u.check();
  assert.strictEqual(st.state, 'current');
  assert.match(st.note, /No release/);
});

test('a failed check says why', async () => {
  const { u } = harness({ fetchText: async () => { throw Object.assign(new Error('offline'), { code: 'network' }); } });
  const st = await u.check();
  assert.strictEqual(st.state, 'check-failed');
  assert.strictEqual(st.reason, 'offline');
});

test('an unusable latest.yml fails the check', async () => {
  const { u } = harness({ fetchText: async () => '<html>' });
  assert.strictEqual((await u.check()).state, 'check-failed');
  const traversal = harness({ fetchText: async () => yml('1.3.0').replace(/Multi-Claude-Setup-1\.3\.0\.exe/g, '..\\evil.exe') });
  assert.strictEqual((await traversal.u.check()).state, 'check-failed');
});

test('install does nothing before an update is found', async () => {
  const { u, calls } = harness();
  await u.install();
  assert.strictEqual(calls.downloads.length, 0);
});

test('install downloads, verifies, runs the installer silently and quits', async () => {
  const { u, calls } = harness();
  await u.check();
  const st = await u.install();

  assert.strictEqual(calls.downloads.length, 1);
  const d = calls.downloads[0];
  assert.strictEqual(d.url, 'https://github.com/o/r/releases/download/v1.3.0/Multi-Claude-Setup-1.3.0.exe');
  assert.strictEqual(d.dest, path.join(TMP, 'Multi-Claude-Setup-1.3.0.exe'));
  assert.strictEqual(d.opts.sha512, 'SHA==');
  assert.strictEqual(d.opts.size, 1234);

  assert.strictEqual(calls.spawned.length, 1);
  const s = calls.spawned[0];
  assert.strictEqual(s.exe, d.dest);
  assert.deepStrictEqual(s.args, ['/S', '--updated', '--force-run']);
  assert.deepStrictEqual(INSTALL_ARGS, ['/S', '--updated', '--force-run']);
  assert.strictEqual(s.opts.detached, true);
  assert.ok(!s.opts.shell, 'never through a shell');
  assert.ok(s.c.unrefed, 'the installer outlives Multi-Claude');

  assert.strictEqual(calls.quit, 1);
  assert.strictEqual(st.state, 'installing');
});

test('install reports downloading straight away, then progress', async () => {
  let release;
  let seen = null;
  const holder = {};
  const { u } = harness({
    download: (url, dest, opts) => new Promise((resolve) => {
      opts.onProgress(0.42);
      seen = holder.u.status();
      release = resolve;
    })
  });
  holder.u = u;
  await u.check();
  const running = u.install();
  assert.strictEqual(u.status().state, 'downloading', 'set before the first await');
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(seen.progress, 0.42);
  release();
  await running;
});

test('a second install while one runs is ignored', async () => {
  let release;
  const { u, calls } = harness({
    download: (url) => new Promise((resolve) => { calls.downloads.push(url); release = resolve; })
  });
  await u.check();
  const first = u.install();
  await u.install();
  assert.strictEqual(calls.downloads.length, 1);
  release();
  await first;
});

test('a failed download leaves Multi-Claude open, with a reason, and can retry', async () => {
  let fail = true;
  const { u, calls } = harness({
    download: async () => {
      if (fail) throw Object.assign(new Error('The download was damaged; nothing was installed.'), { code: 'damaged' });
    }
  });
  await u.check();
  const st = await u.install();
  assert.strictEqual(st.state, 'failed');
  assert.match(st.reason, /damaged/);
  assert.strictEqual(calls.spawned.length, 0);
  assert.strictEqual(calls.quit, 0);

  fail = false;
  assert.strictEqual((await u.install()).state, 'installing', 'Retry runs the install again');
});

test('an installer that will not start leaves Multi-Claude open', async () => {
  const { u, calls } = harness({ spawn: () => child('error', new Error('EACCES')) });
  await u.check();
  const st = await u.install();
  assert.strictEqual(st.state, 'failed');
  assert.match(st.reason, /would not start/);
  assert.strictEqual(calls.quit, 0);
});

test('running from source never installs', async () => {
  const { u, calls } = harness({ mode: 'source' });
  await u.check();
  const st = await u.install();
  assert.strictEqual(st.state, 'available');
  assert.strictEqual(calls.downloads.length, 0);
  assert.strictEqual(calls.spawned.length, 0);
});

test('the portable build opens the release page instead', async () => {
  const { u, calls } = harness({ mode: 'portable' });
  await u.check();
  await u.install();
  assert.deepStrictEqual(calls.opened, ['https://github.com/o/r/releases/tag/v1.3.0']);
  assert.strictEqual(calls.downloads.length, 0);
});

test('changelog lists newer releases', async () => {
  const { u } = harness({
    fetchJson: async () => [{ tag_name: 'v1.3.0', draft: false, prerelease: false, published_at: 'd', body: 'notes' }]
  });
  assert.deepStrictEqual(await u.changelog(), { ok: true, releases: [{ version: '1.3.0', date: 'd', notes: 'notes' }] });
});

test('a changelog that cannot load says why', async () => {
  const { u } = harness({ fetchJson: async () => { throw new Error('rate limited'); } });
  assert.deepStrictEqual(await u.changelog(), { ok: false, reason: 'rate limited' });
});

test('openReleasesPage opens the releases list', () => {
  const { u, calls } = harness();
  u.openReleasesPage();
  assert.deepStrictEqual(calls.opened, ['https://github.com/o/r/releases']);
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `node --test test/updater.test.js`
Expected: FAIL — `Cannot find module '../src/main/updater.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/main/updater.js`:

```js
'use strict';
// In-app updates from GitHub Releases.
//
// Checks once per launch; downloads and installs only on a click. The
// installer is electron-builder's own NSIS installer: with /S it installs
// silently, and with --force-run it starts the app again afterwards
// (app-builder-lib/templates/nsis/installSection.nsh). --updated is what
// electron-builder's own updater passes, so user data is never touched.
//
// Everything with side effects is injected, so this tests without Electron.

const path = require('node:path');
const F = require('./update-feed.js');

const INSTALL_ARGS = Object.freeze(['/S', '--updated', '--force-run']);
const BUSY = ['checking', 'downloading', 'installing'];

function createUpdater({
  fetchText, fetchJson, download, spawn, quit, openExternal,
  currentVersion, mode, repo, tmpDir
}) {
  const urls = F.feedUrls(repo);
  let state = { state: 'idle', current: currentVersion, mode };
  let latest = null; // the parsed latest.yml, once a newer version is known

  const set = (patch) => { state = { current: currentVersion, mode, ...patch }; };
  const status = () => ({ ...state });

  async function check() {
    if (BUSY.includes(state.state)) return status();
    set({ state: 'checking' });

    let text;
    try {
      text = await fetchText(urls.latestYml);
    } catch (e) {
      latest = null;
      if (e && e.code === 'not_found') set({ state: 'current', note: 'No release is published yet.' });
      else set({ state: 'check-failed', reason: (e && e.message) || 'The check failed.' });
      return status();
    }

    const info = F.parseLatestYml(text);
    if (!info || !F.safeAssetName(info.path)) {
      latest = null;
      set({ state: 'check-failed', reason: 'The latest release has no valid update file.' });
      return status();
    }
    if (!F.isNewer(info.version, currentVersion)) {
      latest = null;
      set({ state: 'current' });
      return status();
    }
    latest = info;
    set({ state: 'available', latest: info.version });
    return status();
  }

  async function install() {
    if (!latest || (state.state !== 'available' && state.state !== 'failed')) return status();
    // Installing would replace the installed copy, not the code being run.
    if (mode === 'source') return status();
    // A running portable executable cannot replace itself.
    if (mode === 'portable') {
      openExternal(urls.releasePage(latest.version));
      return status();
    }

    const target = latest;
    const file = path.join(tmpDir, target.path);
    set({ state: 'downloading', latest: target.version, progress: 0 });
    try {
      await download(urls.asset(target.version, target.path), file, {
        sha512: target.sha512,
        size: target.size,
        onProgress: (p) => {
          if (state.state === 'downloading') state = { ...state, progress: p };
        }
      });
    } catch (e) {
      set({ state: 'failed', latest: target.version, reason: (e && e.message) || 'The download failed.' });
      return status();
    }

    set({ state: 'installing', latest: target.version });
    try {
      const child = spawn(file, INSTALL_ARGS, { detached: true, stdio: 'ignore', windowsHide: false });
      await new Promise((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', reject);
      });
      child.unref();
    } catch (e) {
      set({ state: 'failed', latest: target.version, reason: `The installer would not start: ${e && e.message}` });
      return status();
    }
    quit();
    return status();
  }

  async function changelog() {
    try {
      return { ok: true, releases: F.parseReleases(await fetchJson(urls.releasesApi), currentVersion) };
    } catch (e) {
      return { ok: false, reason: (e && e.message) || 'The release notes could not be loaded.' };
    }
  }

  function openReleasesPage() {
    openExternal(urls.releasesPage);
    return { ok: true };
  }

  return { check, install, status, changelog, openReleasesPage };
}

module.exports = { createUpdater, INSTALL_ARGS };
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/updater.js test/updater.test.js
git commit -m "feat: updater state machine - check, download, install"
```

---

### Task 4: Wire the updater into the app

**Files:**
- Modify: `src/main/main.js`
- Modify: `src/main/ipc.js`
- Modify: `src/preload/preload.js`
- Modify: `src/renderer/lib/api.js`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: renderer calls `api.updateStatus()`, `api.updateCheck()`, `api.updateInstall()`, `api.updateChangelog()`, `api.updateOpenPage()`, each resolving to the updater's return value.

**Already established:** quitting Multi-Claude leaves every Claude window running. `launcher.js` spawns Claude Desktop `detached` and `unref()`s it, and the terminal and VS Code launches do the same, so the spec's open question is closed and no warning is needed. The only thing a quit interrupts is a sign-in still in progress (`service.shutdown()` cancels it).

- [ ] **Step 1: Build the updater in `main.js`**

Add beside the other requires:

```js
const { createUpdater } = require('./updater.js');
const updateHttp = require('./update-http.js');
const updateConfig = require('./update-config.js');
```

Add `let updater = null;` beside `let service = null;`, and this function after `buildService`:

```js
  function buildUpdater() {
    const mode = !app.isPackaged
      ? 'source'
      : process.env.PORTABLE_EXECUTABLE_FILE ? 'portable' : 'installed';
    const tmpDir = path.join(os.tmpdir(), 'multi-claude-update');
    // An installer from an earlier update is finished with by now. Best effort:
    // right after an update it may still be exiting, and goes next launch.
    fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});

    return createUpdater({
      fetchText: (url) => updateHttp.fetchText(url),
      fetchJson: (url) => updateHttp.fetchJson(url),
      download: (url, dest, opts) => updateHttp.downloadVerified(url, dest, opts),
      spawn,
      quit: () => app.quit(),
      openExternal: (url) => shell.openExternal(url),
      currentVersion: app.getVersion(),
      mode,
      repo: updateConfig,
      tmpDir
    });
  }
```

In `app.whenReady()`, after the `--launch` shortcut branch, replace

```js
    registerAppProtocol();
    ipc.register(service);
    createWindow();
```

with

```js
    registerAppProtocol();
    updater = buildUpdater();
    ipc.register(service, updater);
    createWindow();
    // Once per launch. Never downloads; the footer shows what it found.
    updater.check();
```

- [ ] **Step 2: Add the channels in `ipc.js`**

Append to `CHANNELS`:

```js
  'updateStatus', 'updateCheck', 'updateInstall', 'updateChangelog', 'updateOpenPage'
```

(after `'loginOpenPage'`, with a comma after it). Change the signature to `function register(service, updater) {` and add to `handlers`:

```js
    updateStatus: () => updater.status(),
    updateCheck: () => updater.check(),
    // Not awaited: the download takes a while and the footer polls
    // updateStatus for progress. install() sets 'downloading' before it awaits.
    updateInstall: () => {
      updater.install().catch(() => {});
      return updater.status();
    },
    updateChangelog: () => updater.changelog(),
    updateOpenPage: () => updater.openReleasesPage(),
```

- [ ] **Step 3: Expose them in `preload.js`**

Add after `accountInfo: call('accountInfo')` (with a comma after it):

```js
  updateStatus: call('updateStatus'),
  updateCheck: call('updateCheck'),
  updateInstall: call('updateInstall'),
  updateChangelog: call('updateChangelog'),
  updateOpenPage: call('updateOpenPage')
```

- [ ] **Step 4: Expose them in `api.js`**

Add to the `api` object:

```js
  updateStatus: () => call('updateStatus'),
  updateCheck: () => call('updateCheck'),
  updateInstall: () => call('updateInstall'),
  updateChangelog: () => call('updateChangelog'),
  updateOpenPage: () => call('updateOpenPage'),
```

- [ ] **Step 5: Verify the chain**

Run: `npm test`
Expected: PASS.

Then confirm every channel is present at all four layers:

```bash
for c in updateStatus updateCheck updateInstall updateChangelog updateOpenPage; do printf '%s ' "$c"; grep -l "$c" src/main/ipc.js src/preload/preload.js src/renderer/lib/api.js | wc -l; done
```

Expected: each name followed by `3`. Also run `grep -n "ipc.register" src/main/main.js` and expect exactly one line, `ipc.register(service, updater);`.

- [ ] **Step 6: Commit**

```bash
git add src/main/main.js src/main/ipc.js src/preload/preload.js src/renderer/lib/api.js
git commit -m "feat: check for updates on launch and expose the updater over IPC"
```

---

### Task 5: The footer line and the What's new dialog

**Files:**
- Create: `src/renderer/lib/release-notes.js`
- Create: `src/renderer/components/UpdateFoot.jsx`
- Create: `src/renderer/components/WhatsNewDialog.jsx`
- Modify: `src/renderer/App.jsx` (the `.sidebar-foot` block, ~line 307)
- Modify: `src/renderer/styles.css`
- Test: `test/release-notes.test.js`

**Interfaces:**
- Consumes: Task 4's `api.update*` calls and the status shape from Task 3.
- Produces: `notesToBlocks(text) -> [{ type: 'h' | 'li' | 'p', text }]`.

- [ ] **Step 1: Write the failing test**

Create `test/release-notes.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');

// The renderer's helpers are ES modules; Node loads them by detecting the syntax.
const load = () => import('../src/renderer/lib/release-notes.js');

test('headings, bullets and paragraphs become blocks', async () => {
  const { notesToBlocks } = await load();
  assert.deepStrictEqual(notesToBlocks("## What's Changed\n- Fixed the **logo** link\n\nThanks!"), [
    { type: 'h', text: "What's Changed" },
    { type: 'li', text: 'Fixed the logo link' },
    { type: 'p', text: 'Thanks!' }
  ]);
});

test('links keep their text and lose the address; HTML is dropped', async () => {
  const { notesToBlocks } = await load();
  assert.deepStrictEqual(notesToBlocks('* See [the PR](https://github.com/o/r/pull/1) <!-- note --> `now`'), [
    { type: 'li', text: 'See the PR  now' }
  ]);
});

test('empty notes give no blocks', async () => {
  const { notesToBlocks } = await load();
  assert.deepStrictEqual(notesToBlocks(''), []);
  assert.deepStrictEqual(notesToBlocks(null), []);
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `node --test test/release-notes.test.js`
Expected: FAIL — cannot find `release-notes.js`.

- [ ] **Step 3: Write `release-notes.js`**

```js
// GitHub release notes, reduced to text blocks the dialog can show.
//
// Never rendered as HTML: a release note is text from the network. Headings
// and bullets keep their shape; links keep their words; markup is dropped.

function plain(s) {
  return s
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/\*\*|__|`/g, '')
    .trim();
}

export function notesToBlocks(text) {
  const blocks = [];
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const h = /^#{1,6}\s+(.*)$/.exec(line);
    const li = /^[-*+]\s+(.*)$/.exec(line);
    if (h) blocks.push({ type: 'h', text: plain(h[1]) });
    else if (li) blocks.push({ type: 'li', text: plain(li[1]) });
    else blocks.push({ type: 'p', text: plain(line) });
  }
  return blocks.filter((b) => b.text);
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `node --test test/release-notes.test.js`
Expected: PASS.

- [ ] **Step 5: Write `WhatsNewDialog.jsx`**

```jsx
import React, { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { notesToBlocks } from '../lib/release-notes.js';

/** Every published version newer than this one, newest first, with its notes. */
export default function WhatsNewDialog({ status, onUpdate, onClose }) {
  const [log, setLog] = useState(null);
  const closeRef = useRef(null);

  useEffect(() => { closeRef.current?.focus(); }, []);
  useEffect(() => {
    let live = true;
    api.updateChangelog().then(
      (r) => { if (live) setLog(r); },
      (e) => { if (live) setLog({ ok: false, reason: e.message }); }
    );
    return () => { live = false; };
  }, []);

  const canUpdate = status.state === 'available' && status.mode !== 'source';

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="modal whats-new"
        role="dialog"
        aria-modal="true"
        onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
      >
        <h2>What&apos;s new</h2>

        {!log && <p>Loading release notes…</p>}

        {log && !log.ok && (
          <>
            <p>The release notes could not be loaded{log.reason ? ` (${log.reason})` : ''}.</p>
            <p><button className="text-btn" onClick={() => api.updateOpenPage()}>Open the releases page</button></p>
          </>
        )}

        {log && log.ok && log.releases.length === 0 && <p>No release notes were published for this version.</p>}

        {log && log.ok && log.releases.map((r) => {
          const blocks = notesToBlocks(r.notes);
          return (
            <section key={r.version} className="release">
              <h3>
                v{r.version}
                {r.date && <span className="release-date"> · {new Date(r.date).toLocaleDateString()}</span>}
              </h3>
              {blocks.length === 0 && <p>No notes for this version.</p>}
              {blocks.map((b, i) => {
                if (b.type === 'h') return <h4 key={i}>{b.text}</h4>;
                if (b.type === 'li') return <p key={i} className="li">• {b.text}</p>;
                return <p key={i}>{b.text}</p>;
              })}
            </section>
          );
        })}

        <div className="buttons">
          <button ref={closeRef} className="ghost" onClick={onClose}>Close</button>
          {canUpdate && <button className="primary" onClick={onUpdate}>Update to v{status.latest}</button>}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Write `UpdateFoot.jsx`**

```jsx
import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../lib/api.js';
import WhatsNewDialog from './WhatsNewDialog.jsx';

// States that change on their own; the line polls only while in one.
const MOVING = ['idle', 'checking', 'downloading', 'installing'];

/**
 * The update line in the sidebar footer. Multi-Claude checks once when it
 * opens; this shows the result and is the only place an update is started.
 */
export default function UpdateFoot() {
  const [st, setSt] = useState(null);
  const [showNotes, setShowNotes] = useState(false);

  const refresh = useCallback(async () => {
    try { setSt(await api.updateStatus()); } catch { /* keep showing the last state */ }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const moving = !st || MOVING.includes(st.state);
  useEffect(() => {
    if (!moving) return undefined;
    const t = setInterval(refresh, 500);
    return () => clearInterval(t);
  }, [moving, refresh]);

  const install = async () => {
    setShowNotes(false);
    try { setSt(await api.updateInstall()); } catch { refresh(); }
  };

  const retry = async () => {
    if (st.state === 'failed') return install();
    setSt({ ...st, state: 'checking' });
    try { setSt(await api.updateCheck()); } catch { refresh(); }
    return undefined;
  };

  if (!st) return null;
  const v = `v${st.current}`;
  let line = null;

  switch (st.state) {
    case 'idle':
    case 'checking':
      line = <span>Checking for updates…</span>;
      break;
    case 'current':
      line = <span title={st.note || undefined}>{v} · Everything is up to date</span>;
      break;
    case 'available':
      line = (
        <>
          <span>
            v{st.latest} available{st.mode === 'source' && ' — update with git pull'}
          </span>
          <button className="text-btn" onClick={() => setShowNotes(true)}>What&apos;s new</button>
          {st.mode !== 'source' && (
            <button
              className="primary"
              onClick={install}
              title={st.mode === 'portable' ? 'Opens the download page' : 'Multi-Claude will close and reopen'}
            >
              Update
            </button>
          )}
        </>
      );
      break;
    case 'downloading':
      line = <span>Downloading v{st.latest}… {Math.round((st.progress || 0) * 100)}%</span>;
      break;
    case 'installing':
      line = <span>Installing — Multi-Claude will restart</span>;
      break;
    case 'check-failed':
      line = (
        <>
          <span title={st.reason}>{v} · Couldn&apos;t check for updates</span>
          <button className="text-btn" onClick={retry}>Retry</button>
        </>
      );
      break;
    case 'failed':
      line = (
        <>
          <span title={st.reason}>Update failed</span>
          <button className="text-btn" onClick={retry}>Retry</button>
        </>
      );
      break;
    default:
      line = null;
  }

  return (
    <div className="update-foot">
      {line}
      {/* The sidebar has a backdrop-filter, which would trap a fixed overlay
          inside it; the dialog renders into <body> instead. */}
      {showNotes && createPortal(
        <WhatsNewDialog status={st} onUpdate={install} onClose={() => setShowNotes(false)} />,
        document.body
      )}
    </div>
  );
}
```

- [ ] **Step 7: Put it in the footer**

In `src/renderer/App.jsx`, add beside the other component imports:

```js
import UpdateFoot from './components/UpdateFoot.jsx';
```

and replace the footer block

```jsx
        <div className="sidebar-foot">
          Not affiliated with, or endorsed by, Anthropic.
        </div>
```

with

```jsx
        <div className="sidebar-foot">
          <div>Not affiliated with, or endorsed by, Anthropic.</div>
          <UpdateFoot />
        </div>
```

- [ ] **Step 8: Style it**

Append to `src/renderer/styles.css`:

```css
/* ------------------------------------------------------------ updates -- */

.update-foot {
  margin-top: 8px;
  display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px;
  color: var(--muted);
}
.update-foot button.primary { padding: 3px 10px; font-size: 11px; }

button.text-btn {
  background: none; border: 0; padding: 0;
  color: var(--accent); font: inherit; cursor: pointer;
  text-decoration: underline; text-underline-offset: 2px;
}
button.text-btn:hover:not(:disabled) { background: none; filter: brightness(1.15); }

.modal.whats-new { max-width: 560px; max-height: 80vh; overflow-y: auto; }
.modal.whats-new .release + .release {
  margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--glass-border-hi);
}
.modal.whats-new h3 { margin: 0 0 6px; font-size: 13px; font-weight: 600; }
.modal.whats-new h4 { margin: 10px 0 4px; font-size: 12px; font-weight: 600; color: var(--text); }
.modal.whats-new .release-date { color: var(--faint); font-weight: 400; }
.modal.whats-new p.li { padding-left: 12px; text-indent: -10px; margin-bottom: 4px; }
```

- [ ] **Step 9: Build, test and commit**

Run: `npm run build:renderer`
Expected: a clean Vite build.

Run: `npm test`
Expected: PASS.

```bash
git add src/renderer/lib/release-notes.js src/renderer/components/UpdateFoot.jsx src/renderer/components/WhatsNewDialog.jsx src/renderer/App.jsx src/renderer/styles.css test/release-notes.test.js
git commit -m "feat: update line and What's new dialog in the sidebar footer"
```

---

### Task 6: Documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Fix the installer name in *Install***

Replace

```markdown
That produces `dist/Multi-Claude Setup <version>.exe` and a portable executable. The build
```

with

```markdown
That produces `dist/Multi-Claude-Setup-<version>.exe` and `dist/Multi-Claude-<version>-portable.exe`. The build
```

- [ ] **Step 2: Add an *Updates* section directly before *Where things live***

```markdown
## Updates

Multi-Claude checks GitHub Releases each time it opens. If a newer version has
been published, the sidebar footer shows it with **What's new** — the release
notes of every version since yours — and **Update**. Otherwise it says
everything is up to date, and there is nothing to click.

**Update** downloads the installer, checks its size and SHA-512 against the
release's `latest.yml`, runs it silently and closes Multi-Claude; the installer
starts the new version when it finishes. A download that does not match is
deleted and never run. Your accounts and settings are kept, and any Claude
window you launched keeps running.

Nothing is downloaded without a click. Run from source, the footer tells you to
`git pull` instead; the portable build's **Update** opens the download page,
since a running portable file cannot replace itself.

### Publishing a release

From an ordinary terminal — not from inside Claude Desktop, see *Build from your
own terminal*:

1. `npm version minor` — bumps the version, commits, and tags it.
2. `git push origin main --follow-tags`
3. With a GitHub token that can create releases, in that terminal only:
   `$env:GH_TOKEN = "<token>"`, then `npm run release`. It builds and uploads
   to a draft release.
4. On GitHub, write the release notes (or use **Generate release notes**) and
   **Publish** the draft. Installed copies see it the next time they open.

Without a token, `npm run dist` and upload `Multi-Claude-Setup-<version>.exe`,
`latest.yml` and the portable `.exe` to a new release by hand.

The version that first adds updates has to be installed by hand once; every
version after it arrives through the button.
```

- [ ] **Step 3: Add a row to *Where things live***

After the `Status-line recorder` row, add:

```markdown
| A downloaded update, until the next launch | `%TEMP%\multi-claude-update` |
```

- [ ] **Step 4: Check the prose**

Run: `grep -c "Multi-Claude Setup <version>" README.md ; grep -c "## Updates" README.md`
Expected: `0` then `1`.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: updating Multi-Claude and publishing a release"
```

---

### After the tasks: the end-to-end check (by the owner, by hand)

Not automatable here; it needs real GitHub releases and an ordinary terminal.

1. Merge, then from your own terminal: `npm version minor` (→ 1.2.0), push with tags, `npm run release`, write notes, publish.
2. Quit any running Multi-Claude, install `Multi-Claude-Setup-1.2.0.exe` by hand. Open it: the footer should read `v1.2.0 · Everything is up to date`.
3. Make any small change, `npm version patch` (→ 1.2.1), push with tags, `npm run release`, publish with a line of notes.
4. Reopen Multi-Claude: `v1.2.1 available`. **What's new** shows the 1.2.1 notes. **Update** should download, close, and reopen as 1.2.1 by itself.
5. Note whether Windows SmartScreen appeared during that silent install.

---

## Self-Review

**Spec coverage.** §1 behaviour: footer states in Task 5, one check per launch in Task 4, What's new in Task 5, source and portable modes in Tasks 3 and 5. §2 facts: `latest.yml` and the releases API in Task 1, the User-Agent in Task 2. §3.1 module: Tasks 1 and 3 (split, see above). §3.2 download: Task 2. §3.3 install args: Task 3. §3.4 wiring: Task 4, five channels (see above). §3.5 UI: Task 5. §4 publishing: Task 1 (`package.json`) and Task 6 (README). §5 every error row: Task 3 tests (no release, failed check, malformed, damaged, installer will not start, never a downgrade via `isNewer`), Task 2 tests (stall, 404), Task 5 (changelog failure). The open item — does quitting close Claude windows — is closed in Task 4. §6 testing: each listed test exists in Tasks 1–3 and 5. §7 out of scope: nothing built.

**Placeholders.** None. Every code step carries its code; every run step its command and expected result.

**Type consistency.** `feedUrls(repo)` returns `latestYml`, `releasesApi`, `releasesPage`, `asset()`, `releasePage()` in Task 1 and is used with exactly those names in Task 3. `download(url, dest, { sha512, size, onProgress })` in Task 3 matches `downloadVerified`'s signature in Task 2, wired in Task 4. `status()`'s `state` values in Task 3 are the ones `UpdateFoot` switches on in Task 5. `changelog()` returns `{ ok, releases | reason }` in Task 3 and is read that way by `WhatsNewDialog`. `openReleasesPage()` in Task 3 is `updateOpenPage` in Task 4 and `api.updateOpenPage()` in Task 5.
