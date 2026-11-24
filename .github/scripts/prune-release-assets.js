'use strict';
// Keeps download files only on the newest release.
//
// Every older published release keeps its title, notes, date and tag, but its
// files (installers, .dmg, latest.yml, ...) are deleted. Drafts and pre-releases
// are never touched. Nothing is deleted unless the newest release itself has an
// installer and latest.yml, so there is always something to download and the
// in-app updater keeps working (it only reads the newest release's files).
//
// Run by .github/workflows/prune-old-assets.yml. Locally:
//   GH_TOKEN=... node .github/scripts/prune-release-assets.js --dry-run

const REPO = process.env.GITHUB_REPOSITORY || 'moshiuzzaman/multi-claude';
const API = `https://api.github.com/repos/${REPO}`;

/** True when the release has what users and the updater need. */
function isComplete(release) {
  const names = (release?.assets || []).map((a) => a.name);
  return names.includes('latest.yml') && names.some((n) => /^Multi-Claude-Setup.*\.exe$/i.test(n) && !n.endsWith('.blockmap'));
}

/**
 * What to delete: every asset of every published, non-pre-release release
 * other than `latest`. { ok, reason, deletions: [{ tag, assetId, name }] }.
 */
function planPrune(releases, latest) {
  if (!latest || latest.draft || latest.prerelease) {
    return { ok: false, reason: 'There is no published latest release.', deletions: [] };
  }
  if (!isComplete(latest)) {
    return { ok: false, reason: `The latest release ${latest.tag_name} has no installer or latest.yml, so nothing was deleted.`, deletions: [] };
  }
  const deletions = [];
  for (const r of releases || []) {
    if (!r || r.id === latest.id || r.draft || r.prerelease) continue;
    for (const a of r.assets || []) deletions.push({ tag: r.tag_name, assetId: a.id, name: a.name });
  }
  return { ok: true, reason: '', deletions };
}

/** Plans, then deletes (unless dryRun). Throws when the plan is refused. */
async function prune(api, { dryRun = true, log = console.log } = {}) {
  const [latest, releases] = await Promise.all([api.latest(), api.list()]);
  const plan = planPrune(releases, latest);
  if (!plan.ok) throw new Error(plan.reason);
  log(`Latest release: ${latest.tag_name} (keeps its ${latest.assets.length} files)`);
  if (!plan.deletions.length) log('Older releases have no files left. Nothing to do.');
  let deleted = 0;
  for (const d of plan.deletions) {
    if (dryRun) { log(`would delete  ${d.tag}  ${d.name}`); continue; }
    await api.deleteAsset(d.assetId);
    deleted++;
    log(`deleted  ${d.tag}  ${d.name}`);
  }
  log(dryRun ? `Dry run: ${plan.deletions.length} files would be deleted.` : `Deleted ${deleted} files.`);
  return { planned: plan.deletions.length, deleted };
}

/** A tiny GitHub REST client using the workflow's token. */
function githubApi(token) {
  const headers = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' };
  const call = async (method, url) => {
    const res = await fetch(url, { method, headers });
    if (!res.ok && !(method === 'DELETE' && res.status === 404)) throw new Error(`${method} ${url} → ${res.status}`);
    return res.status === 204 ? null : res.json();
  };
  return {
    latest: () => call('GET', `${API}/releases/latest`),
    list: async () => {
      const all = [];
      for (let page = 1; page < 50; page++) {
        const batch = await call('GET', `${API}/releases?per_page=100&page=${page}`);
        all.push(...batch);
        if (batch.length < 100) break;
      }
      return all;
    },
    deleteAsset: (id) => call('DELETE', `${API}/releases/assets/${id}`)
  };
}

if (require.main === module) {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const dryRun = process.argv.includes('--dry-run') || process.env.DRY_RUN === 'true';
  if (!token) { console.error('Set GH_TOKEN.'); process.exit(1); }
  prune(githubApi(token), { dryRun }).catch((e) => { console.error(e.message); process.exit(1); });
}

module.exports = { planPrune, prune, isComplete, githubApi };
