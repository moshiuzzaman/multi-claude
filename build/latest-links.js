'use strict';
// electron-builder "afterAllArtifactBuild" hook.
//
// GitHub serves the newest release's file at a link that never changes:
//   https://github.com/moshiuzzaman/multi-claude/releases/latest/download/<file>
// That only works when <file> has the same name in every release, and our
// installers carry the version in their names. So, next to each versioned
// installer, this adds a copy without the version (Multi-Claude-Setup.exe,
// Multi-Claude-portable.exe, Multi-Claude-arm64.dmg, Multi-Claude-x64.dmg) and
// returns them, so `--publish` uploads them to the release too.
//
// The versioned files stay as they are: the in-app updater reads latest.yml,
// which still points at the versioned installer.
const fs = require('node:fs');
const path = require('node:path');

const RULES = [
  [/^Multi-Claude-Setup-\d+\.\d+\.\d+[^/\\]*\.exe$/i, 'Multi-Claude-Setup.exe'],
  [/^Multi-Claude-\d+\.\d+\.\d+[^/\\]*-portable\.exe$/i, 'Multi-Claude-portable.exe'],
  [/^Multi-Claude-\d+\.\d+\.\d+[^/\\]*-(arm64|x64)\.dmg$/i, (m) => `Multi-Claude-${m[1].toLowerCase()}.dmg`]
];

/** The fixed name for a versioned installer, or null for any other file. */
function fixedName(fileName) {
  for (const [re, to] of RULES) {
    const m = re.exec(fileName);
    if (m) return typeof to === 'function' ? to(m) : to;
  }
  return null;
}

/** Copies each versioned installer to its fixed name; returns the copies to publish. */
async function addFixedNameCopies(buildResult = {}) {
  const extra = [];
  for (const file of buildResult.artifactPaths || []) {
    const name = fixedName(path.basename(file));
    if (!name) continue;
    const copy = path.join(path.dirname(file), name);
    await fs.promises.copyFile(file, copy);
    extra.push(copy);
  }
  return extra;
}

module.exports = addFixedNameCopies;
module.exports.addFixedNameCopies = addFixedNameCopies;
module.exports.fixedName = fixedName;
