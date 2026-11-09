'use strict';
// Parses the --launch <id> argument used by desktop shortcuts.
//
// The id is validated against the exact shape profiles.newId() produces
// (8 lowercase hex characters). Anything else is rejected outright, so a
// crafted shortcut cannot smuggle a path or a flag through this entry point.

function parseLaunchArg(argv) {
  const args = Array.isArray(argv) ? argv : [];
  let raw = null;

  for (let i = 0; i < args.length; i++) {
    const a = String(args[i]);
    if (a.startsWith('--launch=')) {
      raw = a.slice('--launch='.length);
      break;
    }
    if (a === '--launch') {
      raw = i + 1 < args.length ? String(args[i + 1]) : null;
      break;
    }
  }

  if (!raw || !/^[0-9a-f]{8}$/.test(raw)) return null;
  return raw;
}

module.exports = { parseLaunchArg };
