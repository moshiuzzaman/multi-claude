'use strict';
// Desktop shortcuts for individual accounts.
//
// The shortcut targets Multi-Claude itself rather than claude.exe, because the
// Store build's executable path contains its version number and changes on
// every update. Going through Multi-Claude means the path is resolved fresh on
// each launch, so a pinned shortcut never goes stale.
//
// Taskbar identity: Multi-Claude's window uses APP_USER_MODEL_ID (the build's
// appId, also on the installer's Start menu shortcut), and each account
// shortcut gets an id of its own. So an account's coloured icon only ever
// shows on its own shortcut (or its own pinned taskbar button) and never
// replaces Multi-Claude's logo on Multi-Claude's taskbar button.

const path = require('node:path');

/** Must match "appId" in package.json's build section (a test checks). */
const APP_USER_MODEL_ID = 'dev.multiclaude.app';

function shortcutAppId(accountId) {
  return `${APP_USER_MODEL_ID}.shortcut.${String(accountId).replace(/[^A-Za-z0-9]/g, '')}`;
}

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
    appUserModelId: shortcutAppId(account.id),
    description: `Open Claude with the ${account.label} profile`
  });

  if (!ok) {
    const e = new Error('Windows refused to write the shortcut.');
    e.code = 'shortcut_failed';
    throw e;
  }
  return target;
}

module.exports = { APP_USER_MODEL_ID, shortcutAppId, shortcutName, createShortcut };
