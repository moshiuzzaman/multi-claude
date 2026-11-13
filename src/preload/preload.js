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
  loginStatus: call('loginStatus'),
  loginSubmit: call('loginSubmit'),
  loginCancel: call('loginCancel'),
  loginOpenPage: call('loginOpenPage'),
  remove: call('remove'),
  forget: call('forget'),
  openFolder: call('openFolder'),
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
