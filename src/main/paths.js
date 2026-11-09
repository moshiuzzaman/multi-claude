'use strict';
// Path normalisation and the primitives the delete guards are built from.
// Everything here is pure except isReparsePoint, which touches the filesystem.

const path = require('node:path');
const fsp = require('node:fs/promises');

/**
 * Canonical form of a directory path for comparison: unquoted, resolved,
 * lowercased, with trailing separators removed. Returns null for anything
 * that is not a usable path string.
 */
function normalizeDir(p) {
  if (typeof p !== 'string') return null;
  let v = p.trim();
  if (v === '') return null;
  v = v.replace(/^"+/, '').replace(/"+$/, '').trim();
  if (v === '') return null;
  v = path.resolve(v);
  v = v.replace(/[\\/]+$/, '');
  if (/^[a-zA-Z]:$/.test(v)) v += '\\'; // keep the separator on a bare drive root
  return v.toLowerCase();
}

function samePath(a, b) {
  const na = normalizeDir(a);
  const nb = normalizeDir(b);
  return na !== null && nb !== null && na === nb;
}

/** True when child sits strictly below parent. Equal paths return false. */
function isInside(child, parent) {
  const c = normalizeDir(child);
  const pa = normalizeDir(parent);
  if (c === null || pa === null || c === pa) return false;
  const prefix = pa.endsWith('\\') ? pa : pa + '\\';
  return c.startsWith(prefix);
}

/** Number of path segments below the drive root. "C:\\Users\\Bob" is 2. */
function segmentCount(p) {
  const n = normalizeDir(p);
  if (n === null) return 0;
  const root = path.parse(n).root;
  const rest = n.slice(root.length);
  return rest === '' ? 0 : rest.split('\\').filter(Boolean).length;
}

function isDriveRoot(p) {
  const n = normalizeDir(p);
  return n !== null && n === path.parse(n).root.toLowerCase();
}

/**
 * True for junctions and symbolic links. Node's lstat reports Windows
 * junctions as symbolic links, which is what we need: we must never delete
 * through a reparse point into whatever it targets.
 */
async function isReparsePoint(p) {
  const st = await fsp.lstat(p);
  return st.isSymbolicLink();
}

module.exports = { normalizeDir, samePath, isInside, segmentCount, isDriveRoot, isReparsePoint };
