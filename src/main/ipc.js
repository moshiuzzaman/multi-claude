'use strict';
// The IPC surface. Every handler returns a structured result rather than
// throwing across the boundary, so the renderer always gets something it can
// render: { ok: true, value } or { ok: false, code, message }.

const { ipcMain, dialog } = require('electron');

const CHANNELS = [
  'list', 'add', 'rename', 'launch', 'show', 'remove', 'forget',
  'createShortcut', 'locateExe', 'scan', 'sizes',
  'usage', 'activity', 'storage', 'purgeCache', 'accountInfo', 'closeAccount',
  'limits', 'connectAccount', 'openClaudeCode', 'useVsCodeAccount',
  'loginStatus', 'loginSubmit', 'loginCancel', 'loginOpenPage',
  'ccInstallStart', 'ccInstallStatus', 'openGmail', 'setFreePlan', 'setColor', 'saveIcon', 'settings', 'setTaskbarGroups',
  'setAlerts', 'setMuteAlerts', 'testAlert', 'usageHistory', 'setCloseToTray',
  'updateStatus', 'updateCheck', 'updateInstall', 'updateChangelog', 'updateOpenPage', 'updateQuit'
];

function register(service, updater, { exeLabel = 'claude.exe', exeFilter = { name: 'Claude', extensions: ['exe'] } } = {}) {
  const wrap = (fn) => async (_event, payload) => {
    try {
      return { ok: true, value: await fn(payload || {}) };
    } catch (e) {
      return { ok: false, code: e.code || 'error', message: e.message };
    }
  };

  const handlers = {
    list: () => service.list(),
    add: (p) => service.add(p),
    rename: (p) => service.rename(p),
    launch: (p) => service.launch(p),
    show: (p) => service.show(p),
    closeAccount: (p) => service.closeAccount(p),
    limits: (p) => service.limits(p),
    connectAccount: (p) => service.connectAccount(p),
    openClaudeCode: (p) => service.openClaudeCode(p),
    useVsCodeAccount: (p) => service.useVsCodeAccount(p),
    ccInstallStart: () => service.ccInstallStart(),
    ccInstallStatus: () => service.ccInstallStatus(),
    openGmail: () => service.openGmail(),
    setFreePlan: (p) => service.setFreePlan(p),
    setColor: (p) => service.setColor(p),
    saveIcon: (p) => service.saveIcon(p),
    settings: () => service.settings(),
    setTaskbarGroups: (p) => service.setTaskbarGroups(p),
    setAlerts: (p) => service.setAlerts(p),
    setMuteAlerts: (p) => service.setMuteAlerts(p),
    testAlert: () => service.testAlert(),
    usageHistory: (p) => service.usageHistory(p),
    setCloseToTray: (p) => service.setCloseToTray(p),
    loginStatus: (p) => service.loginStatus(p),
    loginSubmit: (p) => service.loginSubmit(p),
    loginCancel: (p) => service.loginCancel(p),
    loginOpenPage: (p) => service.loginOpenPage(p),
    updateStatus: () => updater.status(),
    updateCheck: () => updater.check(),
    // Not awaited: the download takes a while and the footer polls
    // updateStatus for progress. install() sets 'downloading' before it awaits.
    updateInstall: () => {
      updater.install().catch(() => {});
      return updater.status();
    },
    updateChangelog: () => updater.changelog(),
    updateOpenPage: () => updater.openReleasesPage(),
    updateQuit: () => updater.quitApp(),
    remove: (p) => service.remove(p),
    forget: (p) => service.forget(p),
    createShortcut: (p) => service.createShortcut(p),
    scan: () => service.scan(),
    sizes: () => service.sizes(),
    usage: (p) => service.usage(p),
    activity: (p) => service.activity(p),
    storage: () => service.storage(),
    purgeCache: (p) => service.purgeCache(p),
    accountInfo: () => service.accountInfo(),

    // The only path that ever enters the main process from the UI, and it
    // comes from a native file dialog rather than from renderer script.
    locateExe: async () => {
      const r = await dialog.showOpenDialog({
        title: `Locate ${exeLabel}`,
        properties: ['openFile'],
        filters: [exeFilter]
      });
      if (r.canceled || r.filePaths.length === 0) return { path: null };
      await service.setExePath(r.filePaths[0]);
      return { path: r.filePaths[0] };
    }
  };

  for (const c of CHANNELS) ipcMain.handle(`mc:${c}`, wrap(handlers[c]));
}

module.exports = { register, CHANNELS };
