'use strict';
// Reads token-usage metadata out of Claude Code's session logs.
//
// SCOPE, deliberately narrow: this module extracts counts, timestamps, model
// names, project folder paths and recorded cost. It never reads, stores or
// returns message text, prompts, replies, titles or tool arguments. If you are
// extending it, keep it that way — the only reason the app is allowed near
// this directory at all is that it looks exclusively at metadata.
//
// Shape of the data (verified against 226 real session files, 81,866 records):
//   - every message record may carry  message.usage.{input_tokens, output_tokens,
//     cache_read_input_tokens, cache_creation_input_tokens, output_tokens_details.thinking_tokens}
//   - a minority of sessions (28/226) also carry one "cost-state" record with a
//     pre-aggregated totalCostUSD and modelUsage map
//   - about a third carry an "attachment" record with organizationUuid, which is
//     the only usable per-account signal; the rest are genuinely unattributable

const fs = require('node:fs');
const path = require('node:path');

/** Cheap substring prefilter: JSON.parse on 80k lines is the expensive part. */
const INTERESTING = ['"usage"', '"cost-state"', '"organizationUuid"', '"session-owner"', '"cwd"'];

function isInteresting(line) {
  for (const needle of INTERESTING) if (line.includes(needle)) return true;
  return false;
}

function dayKey(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function emptyBucket() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, thinking: 0, messages: 0 };
}

function addUsage(bucket, u) {
  bucket.input += u.input_tokens || 0;
  bucket.output += u.output_tokens || 0;
  bucket.cacheRead += u.cache_read_input_tokens || 0;
  bucket.cacheWrite += u.cache_creation_input_tokens || 0;
  bucket.thinking += (u.output_tokens_details && u.output_tokens_details.thinking_tokens) || 0;
  bucket.messages += 1;
}

/**
 * Summarise one .jsonl session file.
 * Returns null when the file contains no usable usage data.
 */
function summariseSession(text, filePath) {
  const session = {
    file: filePath,
    sessionId: null,
    project: null,
    org: null,
    accountUuid: null,
    firstTs: null,
    lastTs: null,
    costUSD: null,
    costRecorded: false,
    totals: emptyBucket(),
    byModel: {},
    byDay: {}
  };

  let sawUsage = false;

  for (const line of text.split('\n')) {
    if (!line || !isInteresting(line)) continue;

    let o;
    try { o = JSON.parse(line); } catch { continue; }

    if (!session.sessionId && typeof o.sessionId === 'string') session.sessionId = o.sessionId;
    if (!session.project && typeof o.cwd === 'string') session.project = o.cwd;

    if (o.type === 'session-owner') {
      if (o.organizationUuid) session.org = o.organizationUuid;
      if (o.accountUuid) session.accountUuid = o.accountUuid;
    }

    if (!session.org && o.attachment && o.attachment.organizationUuid) {
      session.org = o.attachment.organizationUuid;
    }

    if (o.type === 'cost-state') {
      if (typeof o.totalCostUSD === 'number') {
        session.costUSD = o.totalCostUSD;
        session.costRecorded = true;
      }
      continue; // its modelUsage duplicates what we sum from the messages
    }

    const u = o.message && o.message.usage;
    if (!u) continue;

    sawUsage = true;
    const ts = o.timestamp ? Date.parse(o.timestamp) : null;
    if (ts && !Number.isNaN(ts)) {
      if (session.firstTs === null || ts < session.firstTs) session.firstTs = ts;
      if (session.lastTs === null || ts > session.lastTs) session.lastTs = ts;
    }

    addUsage(session.totals, u);

    const model = (o.message && o.message.model) || 'unknown';
    if (model !== '<synthetic>') {
      if (!session.byModel[model]) session.byModel[model] = emptyBucket();
      addUsage(session.byModel[model], u);
    }

    const day = ts ? dayKey(ts) : null;
    if (day) {
      if (!session.byDay[day]) session.byDay[day] = emptyBucket();
      addUsage(session.byDay[day], u);
    }
  }

  if (!sawUsage && !session.costRecorded) return null;
  return session;
}

function listSessionFiles(root, fsImpl = fs) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try { entries = fsImpl.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.jsonl')) out.push(p);
    }
  };
  walk(root);
  return out;
}

/**
 * Scan every session file, reusing cached summaries for files whose size and
 * mtime are unchanged. The first scan of ~80k records takes a few seconds;
 * later scans only touch files that actually changed.
 *
 * cache: { [filePath]: { mtimeMs, size, session } }
 */
async function scanUsage({ projectsRoot, cache = {}, fsImpl = fs, onProgress, yieldEvery = 10 }) {
  const files = listSessionFiles(projectsRoot, fsImpl);
  const nextCache = {};
  const sessions = [];
  let parsed = 0;
  let reused = 0;

  for (let i = 0; i < files.length; i++) {
    // A cold scan parses ~80k records. Yield to the event loop periodically so
    // the window stays responsive instead of freezing for several seconds.
    if (yieldEvery > 0 && i > 0 && i % yieldEvery === 0) {
      await new Promise((r) => setImmediate(r));
    }

    const f = files[i];
    let st;
    try { st = fsImpl.statSync(f); } catch { continue; }

    const hit = cache[f];
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) {
      nextCache[f] = hit;
      if (hit.session) sessions.push(hit.session);
      reused++;
    } else {
      let text;
      try { text = fsImpl.readFileSync(f, 'utf8'); } catch { continue; }
      const session = summariseSession(text, f);
      nextCache[f] = { mtimeMs: st.mtimeMs, size: st.size, session };
      if (session) sessions.push(session);
      parsed++;
    }

    if (onProgress && i % 20 === 0) onProgress({ done: i + 1, total: files.length });
  }

  return { sessions, cache: nextCache, parsed, reused, files: files.length };
}

module.exports = {
  summariseSession,
  listSessionFiles,
  scanUsage,
  emptyBucket,
  addUsage,
  dayKey
};
