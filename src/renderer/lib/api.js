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

export const api = {
  list: () => call('list'),
  add: (label) => call('add', { label }),
  rename: (id, label) => call('rename', { id, label }),
  launch: (id) => call('launch', { id }),
  remove: (id, confirmLabel, unlockOutsideRoot) =>
    call('remove', { id, confirmLabel, unlockOutsideRoot }),
  forget: (id) => call('forget', { id }),
  openFolder: (id) => call('openFolder', { id }),
  createShortcut: (id) => call('createShortcut', { id }),
  locateExe: () => call('locateExe'),
  scan: () => call('scan'),
  sizes: () => call('sizes')
};

export function formatSize(bytes) {
  if (typeof bytes !== 'number' || bytes <= 0) return '';
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return '<1 MB';
  if (mb < 1024) return `${Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}
