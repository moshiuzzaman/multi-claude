'use strict';
// Desktop shortcuts for individual accounts.
//
// The shortcut targets Multi-Claude itself rather than claude.exe, because the
// Store build's executable path contains its version number and changes on
// every update. Going through Multi-Claude means the path is resolved fresh on
// each launch, so a pinned shortcut never goes stale.

const path = require('node:path');

function shortcutName(label) {
  const clean = String(label == null ? '' : label).replace(/[\\/:*?"<>|]/g, '').trim();
  return `Claude - ${clean === '' ? 'account' : clean}.lnk`;
}

/**
 * argsPrefix exists for development runs, where the target is electron.exe and
 * the project directory has to precede the flag. It is empty in a packaged
 * build, where the target is Multi-Claude.exe itself.
 */
function createShortcut({ shell, desktopDir, exePath, account, argsPrefix = '', iconFile = null }) {
  const target = path.join(desktopDir, shortcutName(account.label));

  const ok = shell.writeShortcutLink(target, 'create', {
    target: exePath,
    args: `${argsPrefix}--launch ${account.id}`,
    // The account's own icon in its colour, or Multi-Claude's.
    icon: iconFile || exePath,
    iconIndex: 0,
    description: `Open Claude with the ${account.label} profile`
  });

  if (!ok) {
    const e = new Error('Windows refused to write the shortcut.');
    e.code = 'shortcut_failed';
    throw e;
  }
  return target;
}

module.exports = { shortcutName, createShortcut };
