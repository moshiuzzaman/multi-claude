import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './lib/api.js';
import Icon from './components/Icon.jsx';
import DeleteDialog from './components/DeleteDialog.jsx';
import TextPromptDialog from './components/TextPromptDialog.jsx';
import Dashboard from './views/Dashboard.jsx';
import Accounts from './views/Accounts.jsx';
import Usage from './views/Usage.jsx';
import History from './views/History.jsx';
import Storage from './views/Storage.jsx';

const POLL_MS = 5000;

const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { id: 'accounts', label: 'Accounts', icon: 'accounts' },
  { id: 'usage', label: 'Usage', icon: 'usage' },
  { id: 'history', label: 'History', icon: 'history' },
  { id: 'storage', label: 'Storage', icon: 'storage' }
];

export default function App() {
  const [view, setView] = useState('dashboard');

  const [accounts, setAccounts] = useState([]);
  const [running, setRunning] = useState([]);
  const [scanOk, setScanOk] = useState(true);

  const [usage, setUsage] = useState(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [activity, setActivity] = useState(null);
  const [storage, setStorage] = useState(null);
  const [days, setDays] = useState(30);

  const [toast, setToast] = useState(null);
  const [exeMissing, setExeMissing] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [renaming, setRenaming] = useState(null);
  const [adding, setAdding] = useState(false);

  const toastTimer = useRef(null);

  const say = useCallback((message, isError = false) => {
    clearTimeout(toastTimer.current);
    setToast({ message, isError });
    toastTimer.current = setTimeout(() => setToast(null), isError ? 6500 : 3200);
  }, []);

  const fail = useCallback((e) => {
    if (e.code === 'no_exe') setExeMissing(true);
    say(e.message, true);
  }, [say]);

  // ---- loaders -------------------------------------------------------------

  const loadAccounts = useCallback(async () => {
    try { setAccounts(await api.list()); } catch (e) { fail(e); }
  }, [fail]);

  const loadScan = useCallback(async () => {
    try {
      const { running: ids, ok } = await api.scan();
      setRunning(ids);
      setScanOk(ok);
    } catch { setScanOk(false); }
  }, []);

  // Per-account sizes come from the storage breakdown rather than a second
  // directory walk — these profiles are ~10 GB each and one pass is enough.
  const sizes = React.useMemo(
    () => (storage ? Object.fromEntries(storage.map((s) => [s.id, s.total])) : {}),
    [storage]
  );

  const loadUsage = useCallback(async (d) => {
    setUsageLoading(true);
    try {
      setUsage(await api.usage({ days: d }));
    } catch (e) {
      if (e.code !== 'no_usage_source') fail(e);
      setUsage({ unavailable: true, message: e.message });
    } finally {
      setUsageLoading(false);
    }
  }, [fail]);

  const loadActivity = useCallback(async (d) => {
    try { setActivity(await api.activity({ days: d })); } catch (e) { fail(e); }
  }, [fail]);

  // Measuring these profiles means walking ~23 GB. Two concurrent walks thrash
  // the disk and take far longer than one, so in-flight requests are shared.
  const storageInFlight = useRef(null);

  const loadStorage = useCallback(async (force = false) => {
    if (storageInFlight.current) return storageInFlight.current;
    const p = (async () => {
      try {
        setStorage(await api.storage({ force }));
      } catch (e) {
        fail(e);
      } finally {
        storageInFlight.current = null;
      }
    })();
    storageInFlight.current = p;
    return p;
  }, [fail]);

  useEffect(() => {
    loadAccounts();
    loadScan();
    loadStorage();
  }, [loadAccounts, loadScan, loadStorage]);

  // The usage scan is the expensive one (a cold parse of ~80k records), so it
  // only runs for the views that actually show it, and only once per range.
  useEffect(() => {
    if ((view === 'dashboard' || view === 'usage') && !usage && !usageLoading) loadUsage(days);
  }, [view, usage, usageLoading, days, loadUsage]);

  useEffect(() => {
    if ((view === 'dashboard' || view === 'history') && !activity) loadActivity(days);
  }, [view, activity, days, loadActivity]);


  const changeRange = (d) => {
    setDays(d);
    setUsage(null);
    setActivity(null);
  };

  // Poll only while focused: each scan spawns a PowerShell process.
  useEffect(() => {
    let timer = null;
    const start = () => { if (!timer) { loadScan(); timer = setInterval(loadScan, POLL_MS); } };
    const stop = () => { clearInterval(timer); timer = null; };
    if (document.hasFocus()) start();
    window.addEventListener('focus', start);
    window.addEventListener('blur', stop);
    return () => { stop(); window.removeEventListener('focus', start); window.removeEventListener('blur', stop); };
  }, [loadScan]);

  // ---- actions -------------------------------------------------------------

  const actions = {
    launch: async (a) => {
      try {
        await api.launch(a.id);
        say(`Opening ${a.label}…`);
        setTimeout(loadScan, 1500);
      } catch (e) { fail(e); }
    },
    add: async (label) => {
      try {
        const a = await api.add(label);
        setAdding(false);
        await loadAccounts();
        setActivity(null);
        say(`Created ${a.label}. Sign in to that account in the Claude window.`);
        setTimeout(loadScan, 1500);
      } catch (e) { fail(e); throw e; }
    },
    rename: async (label) => {
      try {
        await api.rename(renaming.id, label);
        setRenaming(null);
        await loadAccounts();
        setActivity(null);
        say('Renamed. The folder on disk keeps its original name.');
      } catch (e) { fail(e); throw e; }
    },
    remove: async (confirmLabel, unlock) => {
      const a = deleting;
      await api.remove(a.id, confirmLabel, unlock);
      setDeleting(null);
      await loadAccounts();
      loadStorage(true);
      say(`Deleted ${a.label} from this PC.`);
    },
    forget: async (a) => {
      try {
        await api.forget(a.id);
        await loadAccounts();
        say(`Removed ${a.label} from the list.`);
      } catch (e) { fail(e); }
    },
    openFolder: async (a) => { try { await api.openFolder(a.id); } catch (e) { fail(e); } },
    shortcut: async (a) => {
      try {
        await api.createShortcut(a.id);
        say(`Desktop shortcut created for ${a.label}.`);
      } catch (e) { fail(e); }
    },
    purgeCache: async (a) => {
      try {
        const { freed } = await api.purgeCache(a.id);
        loadStorage(true);
        say(freed > 0 ? `Freed ${(freed / 1048576).toFixed(0)} MB from ${a.label}.` : 'No cache to clear.');
      } catch (e) { fail(e); }
    },
    startRename: setRenaming,
    startDelete: setDeleting,
    refreshUsage: () => { setUsage(null); },
    refreshStorage: () => { setStorage(null); loadStorage(true); }
  };

  const shared = {
    accounts, running, scanOk, sizes, usage, usageLoading, activity, storage,
    days, setDays: changeRange, actions, setView
  };

  const onLocateExe = async () => {
    try {
      const { path } = await api.locateExe();
      if (path) { setExeMissing(false); say('Saved. Try launching again.'); }
    } catch (e) { fail(e); }
  };

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark" />
          <div className="brand-name">Multi-Claude</div>
        </div>

        {NAV.map((n) => (
          <button
            key={n.id}
            className={view === n.id ? 'nav-item active' : 'nav-item'}
            onClick={() => setView(n.id)}
          >
            <Icon name={n.icon} />
            {n.label}
          </button>
        ))}

        <div className="sidebar-foot">
          Not affiliated with, or endorsed by, Anthropic.
        </div>
      </aside>

      <main className="main">
        {exeMissing && (
          <div className="banner">
            <span>Could not find claude.exe automatically.</span>
            <span className="spacer" />
            <button onClick={onLocateExe}>Locate claude.exe…</button>
          </div>
        )}

        {view === 'dashboard' && <Dashboard {...shared} />}
        {view === 'accounts' && <Accounts {...shared} onAdd={() => setAdding(true)} />}
        {view === 'usage' && <Usage {...shared} />}
        {view === 'history' && <History {...shared} />}
        {view === 'storage' && <Storage {...shared} />}
      </main>

      {adding && (
        <TextPromptDialog
          title="Add an account"
          description="A new, empty Claude profile is created and opened. Sign in to the account you want to use there."
          label="Account name"
          placeholder="Personal"
          confirmText="Create and open"
          onConfirm={actions.add}
          onCancel={() => setAdding(false)}
        />
      )}

      {renaming && (
        <TextPromptDialog
          title={`Rename "${renaming.label}"`}
          description="This changes the name shown here only. The folder on disk keeps its original name."
          label="Account name"
          initialValue={renaming.label}
          confirmText="Rename"
          onConfirm={actions.rename}
          onCancel={() => setRenaming(null)}
        />
      )}

      {deleting && (
        <DeleteDialog account={deleting} onConfirm={actions.remove} onCancel={() => setDeleting(null)} />
      )}

      {toast && <div className={toast.isError ? 'toast error' : 'toast'}>{toast.message}</div>}
    </div>
  );
}
