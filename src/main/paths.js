'use strict';
// Path normalisation and the primitives the delete guards are built from.
// Everything here is pure except isReparsePoint, which touches the filesystem.
//
// The guards follow the platform's own path rules: Windows paths and "\" on
// Windows, POSIX paths and "/" on a Mac. makePaths(pathImpl) builds the same
// set for either, so the Mac rules are tested on Windows too.

const nodePath = require('node:path');
const fsp = require('node:fs/promises');

function makePaths(path = nodePath) {
  const sep = path.sep;
  const win = sep === '\\';

  /**
   * Canonical form of a directory path for comparison: unquoted, resolved,
   * lowercased, with trailing separators removed. Returns null for anything
   * that is not a usable path string. Lowercased on both platforms: Windows
   * and a Mac's default disk format both ignore case in names.
   */
  function normalizeDir(p) {
    if (typeof p !== 'string') return null;
    let v = p.trim();
    if (v === '') return null;
    v = v.replace(/^"+/, '').replace(/"+$/, '').trim();
    if (v === '') return null;
    v = path.resolve(v);
    if (win) {
      v = v.replace(/[\\/]+$/, '');
      if (/^[a-zA-Z]:$/.test(v)) v += '\\'; // keep the separator on a bare drive root
    } else {
      v = v.replace(/\/+$/, '');
      if (v === '') v = '/';
    }
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
    const prefix = pa.endsWith(sep) ? pa : pa + sep;
    return c.startsWith(prefix);
  }

  /** Number of path segments below the root. "C:\\Users\\Bob" and "/Users/bob" are 2. */
  function segmentCount(p) {
    const n = normalizeDir(p);
    if (n === null) return 0;
    const root = path.parse(n).root;
    const rest = n.slice(root.length);
    return rest === '' ? 0 : rest.split(sep).filter(Boolean).length;
  }

  /** A drive root on Windows, "/" on a Mac. */
  function isDriveRoot(p) {
    const n = normalizeDir(p);
    return n !== null && n === path.parse(n).root.toLowerCase();
  }

  return { normalizeDir, samePath, isInside, segmentCount, isDriveRoot };
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

module.exports = { ...makePaths(nodePath), makePaths, isReparsePoint };
