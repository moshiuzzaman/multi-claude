'use strict';
// The IPC surface. Every handler returns a structured result rather than
// throwing across the boundary, so the renderer always gets something it can
// render: { ok: true, value } or { ok: false, code, message }.

const { ipcMain, dialog } = require('electron');

const CHANNELS = [
  'list', 'add', 'rename', 'launch', 'remove', 'forget',
  'openFolder', 'createShortcut', 'locateExe', 'scan', 'sizes',
  'usage', 'activity', 'storage', 'purgeCache', 'accountInfo', 'closeAccount',
  'limits', 'connectAccount', 'openClaudeCode', 'openVsCode',
  'loginStatus', 'loginSubmit', 'loginCancel', 'loginOpenPage'
];

function register(service) {
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
    closeAccount: (p) => service.closeAccount(p),
    limits: (p) => service.limits(p),
    connectAccount: (p) => service.connectAccount(p),
    openClaudeCode: (p) => service.openClaudeCode(p),
    openVsCode: (p) => service.openVsCode(p),
    loginStatus: (p) => service.loginStatus(p),
    loginSubmit: (p) => service.loginSubmit(p),
    loginCancel: (p) => service.loginCancel(p),
    loginOpenPage: (p) => service.loginOpenPage(p),
    remove: (p) => service.remove(p),
    forget: (p) => service.forget(p),
    openFolder: (p) => service.openFolder(p),
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
        title: 'Locate claude.exe',
        properties: ['openFile'],
        filters: [{ name: 'Claude', extensions: ['exe'] }]
      });
      if (r.canceled || r.filePaths.length === 0) return { path: null };
      await service.setExePath(r.filePaths[0]);
      return { path: r.filePaths[0] };
    }
  };

  for (const c of CHANNELS) ipcMain.handle(`mc:${c}`, wrap(handlers[c]));
}

module.exports = { register, CHANNELS };
