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
        got += c.length;
        // Never write more than was promised.
        if (got > size) return res.destroy(httpErr('damaged', 'The download was damaged; nothing was installed.'));
        hash.update(c);
        onProgress(Math.min(1, got / total));
        return undefined;
      });
      res.on('error', reject);
      out.on('error', reject);
      // 'close', not 'finish': Windows will not start a file that still has an
      // open write handle, and the handle closes after the last flush.
      out.on('close', resolve);
      res.pipe(out);
    });
    if (got !== size || hash.digest('base64') !== sha512) {
      throw httpErr('damaged', 'The download was damaged; nothing was installed.');
    }
  } catch (e) {
    res.destroy();
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
