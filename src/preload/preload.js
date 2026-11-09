'use strict';
// The entire bridge between the renderer and the main process.
//
// Note what is NOT here: no filesystem access, no child_process, no path
// handling. Each call sends an account id and gets a structured result back.

const { contextBridge, ipcRenderer } = require('electron');

const call = (channel) => (payload) => ipcRenderer.invoke(`mc:${channel}`, payload);

contextBridge.exposeInMainWorld('multiClaude', {
  list: call('list'),
  add: call('add'),
  rename: call('rename'),
  launch: call('launch'),
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
  accountInfo: call('accountInfo')
});
