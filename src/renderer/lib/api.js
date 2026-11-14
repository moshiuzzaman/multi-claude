// Thin wrapper over the preload bridge.
//
// The main process never throws across IPC: it answers { ok, value } or
// { ok: false, code, message }. This turns the failure shape back into a
// real Error so callers can use try/catch normally.

const bridge = window.multiClaude;

async function call(name, payload) {
  const res = await bridge[name](payload);
  if (!res || res.ok !== true) {
    const e = new Error((res && res.message) || 'Something went wrong.');
    e.code = (res && res.code) || 'error';
    throw e;
  }
  return res.value;
}

/** True on a Mac. A few labels differ there; nothing else does. */
export const isMac = !!(bridge && bridge.os === 'darwin');

export const api = {
  list: () => call('list'),
  add: (label) => call('add', { label }),
  rename: (id, label) => call('rename', { id, label }),
  launch: (id) => call('launch', { id }),
  show: (id) => call('show', { id }),
  closeAccount: (id) => call('closeAccount', { id }),
  limits: (opts) => call('limits', opts),
  connectAccount: (id) => call('connectAccount', { id }),
  openClaudeCode: (id) => call('openClaudeCode', { id }),
  useVsCodeAccount: (id) => call('useVsCodeAccount', { id }),
  ccInstallStart: () => call('ccInstallStart'),
  ccInstallStatus: () => call('ccInstallStatus'),
  openGmail: () => call('openGmail'),
  setFreePlan: (id, free) => call('setFreePlan', { id, free }),
  loginStatus: (id) => call('loginStatus', { id }),
  loginSubmit: (id, code) => call('loginSubmit', { id, code }),
  loginCancel: (id) => call('loginCancel', { id }),
  loginOpenPage: (id) => call('loginOpenPage', { id }),
  remove: (id, confirmLabel, unlockOutsideRoot) =>
    call('remove', { id, confirmLabel, unlockOutsideRoot }),
  forget: (id) => call('forget', { id }),
  createShortcut: (id, icon) => call('createShortcut', { id, ...(icon || {}) }),
  setColor: (id, color, icon) => call('setColor', { id, color, ...(icon || {}) }),
  saveIcon: (id, icon) => call('saveIcon', { id, ...icon }),
  settings: () => call('settings'),
  setTaskbarGroups: (on) => call('setTaskbarGroups', { on }),
  setAlerts: (opts) => call('setAlerts', opts),
  setMuteAlerts: (id, mute) => call('setMuteAlerts', { id, mute }),
  testAlert: () => call('testAlert'),
  /** Run fn(id) when a clicked limit alert asks for an account's page. */
  onOpenAccount: (fn) => (bridge && bridge.onOpenAccount ? bridge.onOpenAccount(fn) : () => {}),
  locateExe: () => call('locateExe'),
  scan: () => call('scan'),
  sizes: () => call('sizes'),
  usage: (opts) => call('usage', opts),
  activity: (opts) => call('activity', opts),
  storage: (opts) => call('storage', opts),
  purgeCache: (id) => call('purgeCache', { id }),
  accountInfo: () => call('accountInfo'),
  updateStatus: () => call('updateStatus'),
  updateCheck: () => call('updateCheck'),
  updateInstall: () => call('updateInstall'),
  updateChangelog: () => call('updateChangelog'),
  updateOpenPage: () => call('updateOpenPage'),
  updateQuit: () => call('updateQuit')
};
