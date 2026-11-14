'use strict';
// The entire bridge between the renderer and the main process.
//
// Note what is NOT here: no filesystem access, no child_process, no path
// handling. Each call sends an account id and gets a structured result back.

const { contextBridge, ipcRenderer } = require('electron');

const call = (channel) => (payload) => ipcRenderer.invoke(`mc:${channel}`, payload);

contextBridge.exposeInMainWorld('multiClaude', {
  // 'win32' or 'darwin', for the few words that differ (claude.exe, Task Manager).
  os: process.platform,
  list: call('list'),
  add: call('add'),
  rename: call('rename'),
  launch: call('launch'),
  show: call('show'),
  closeAccount: call('closeAccount'),
  limits: call('limits'),
  connectAccount: call('connectAccount'),
  openClaudeCode: call('openClaudeCode'),
  useVsCodeAccount: call('useVsCodeAccount'),
  ccInstallStart: call('ccInstallStart'),
  ccInstallStatus: call('ccInstallStatus'),
  openGmail: call('openGmail'),
  setFreePlan: call('setFreePlan'),
  setColor: call('setColor'),
  saveIcon: call('saveIcon'),
  settings: call('settings'),
  setTaskbarGroups: call('setTaskbarGroups'),
  setAlerts: call('setAlerts'),
  setMuteAlerts: call('setMuteAlerts'),
  testAlert: call('testAlert'),
  usageHistory: call('usageHistory'),
  setCloseToTray: call('setCloseToTray'),
  // A clicked limit alert asks for its account's page. Only an account id
  // comes through; returns a function that stops listening.
  onOpenAccount: (fn) => {
    const h = (_e, id) => { if (typeof id === 'string') fn(id); };
    ipcRenderer.on('mc:open-account', h);
    return () => ipcRenderer.removeListener('mc:open-account', h);
  },
  loginStatus: call('loginStatus'),
  loginSubmit: call('loginSubmit'),
  loginCancel: call('loginCancel'),
  loginOpenPage: call('loginOpenPage'),
  remove: call('remove'),
  forget: call('forget'),
  createShortcut: call('createShortcut'),
  locateExe: call('locateExe'),
  scan: call('scan'),
  sizes: call('sizes'),
  usage: call('usage'),
  activity: call('activity'),
  storage: call('storage'),
  purgeCache: call('purgeCache'),
  accountInfo: call('accountInfo'),
  updateStatus: call('updateStatus'),
  updateCheck: call('updateCheck'),
  updateInstall: call('updateInstall'),
  updateChangelog: call('updateChangelog'),
  updateOpenPage: call('updateOpenPage'),
  updateQuit: call('updateQuit')
});
