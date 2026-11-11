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
 * Is going from `current` to `latest` a major update — the first number
 * (1.x.x → 2.x.x) goes up? A major update must be installed; anything else
 * is a minor update the user may skip.
 */
function isMajorUpdate(latest, current) {
  const x = parseVersion(latest);
  const y = parseVersion(current);
  return !!x && !!y && !x.pre && x.nums[0] > y.nums[0];
}

/**
 * The installer's file name is the one part of a download URL that comes from
 * the network, so it must be a plain .exe name: no path, no traversal.
 */
function safeAssetName(name) {
  return typeof name === 'string' && /^[A-Za-z0-9._-]+\.exe$/i.test(name) && !name.includes('..');
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

module.exports = { parseLatestYml, isNewer, isMajorUpdate, safeAssetName, parseReleases, feedUrls };
