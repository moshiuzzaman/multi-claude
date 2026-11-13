import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, isMac } from './lib/api.js';
import Icon from './components/Icon.jsx';
import DeleteDialog from './components/DeleteDialog.jsx';
import QuitDialog from './components/QuitDialog.jsx';
import SignInDialog from './components/SignInDialog.jsx';
import ClaudeSignInGuide from './components/ClaudeSignInGuide.jsx';
import TextPromptDialog from './components/TextPromptDialog.jsx';
import Dashboard from './views/Dashboard.jsx';
import Accounts from './views/Accounts.jsx';
import History from './views/History.jsx';
import Storage from './views/Storage.jsx';
import AccountDetail from './views/AccountDetail.jsx';
import UpdateFoot from './components/UpdateFoot.jsx';
import logoMark from './assets/logo-mark.png';
import { drawAccountIcon } from './lib/accountIcon.js';

const POLL_MS = 5000;

const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { id: 'accounts', label: 'Accounts', icon: 'accounts' },
  { id: 'history', label: 'History', icon: 'history' },
  { id: 'storage', label: 'Storage', icon: 'storage' }
];

export default function App() {
  const [view, setView] = useState('dashboard');
  const [detailId, setDetailId] = useState(null); // account shown on the 'detail' page

  const [accounts, setAccounts] = useState([]);
  const [running, setRunning] = useState([]);
  const [scanOk, setScanOk] = useState(true);

  const [activity, setActivity] = useState(null);
  const [storage, setStorage] = useState(null);
  const [limits, setLimits] = useState(null);
  const [limitsLoading, setLimitsLoading] = useState(false);
  const [guiding, setGuiding] = useState(null); // added account being walked through its Claude sign-in
  const [days, setDays] = useState(30);

  const [toast, setToast] = useState(null);
  const [exeMissing, setExeMissing] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [quitting, setQuitting] = useState(null);
  const [signingIn, setSigningIn] = useState(null); // { id, label } while connecting
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

  // Plan limits per account. Cheap to refresh: the auth status is cached in the
  // main process and the limits themselves are a small file per account.
  const loadLimits = useCallback(async (force = false) => {
    setLimitsLoading(true);
    try {
      // Paint rows straight away from what is already known, then fetch.
      // The full fetch starts Claude Code once per account and takes a few
      // seconds, so the panel should never sit empty while it runs.
      const quick = await api.limits({ cachedOnly: true });
      setLimits((prev) => prev || quick);
      setLimits(await api.limits({ force }));
    }
    catch (e) { fail(e); }
    finally { setLimitsLoading(false); }
  }, [fail]);

  useEffect(() => {
    loadAccounts();
    loadScan();
    loadStorage();
  }, [loadAccounts, loadScan, loadStorage]);

  useEffect(() => {
    if ((view === 'dashboard' || view === 'history' || view === 'detail') && !activity) loadActivity(days);
  }, [view, activity, days, loadActivity]);


  const changeRange = (d) => {
    setDays(d);
    setActivity(null);
  };

  const openAccount = (id) => { setDetailId(id); setView('detail'); };

  // Limits are shown on the Dashboard cards and on each account's page. While
  // either is open and focused, re-read every 20 s; the main process caches the
  // real /usage fetch for 90 s, so this rarely starts Claude Code.
  useEffect(() => {
    if (view !== 'dashboard' && view !== 'detail') return undefined;
    loadLimits(false);
    const t = setInterval(() => { if (document.hasFocus()) loadLimits(false); }, 20000);
    return () => clearInterval(t);
  }, [view, loadLimits]);

  // Poll only while focused: each scan spawns a PowerShell process.
  useEffect(() => {
    let timer = null;
    // Coming back to the window also re-reads the accounts, so a Claude
    // window that was just signed in shows as signed in.
    const start = () => { if (!timer) { loadScan(); loadAccounts(); timer = setInterval(loadScan, POLL_MS); } };
    const stop = () => { clearInterval(timer); timer = null; };
    if (document.hasFocus()) start();
    window.addEventListener('focus', start);
    window.addEventListener('blur', stop);
    return () => { stop(); window.removeEventListener('focus', start); window.removeEventListener('blur', stop); };
  }, [loadScan, loadAccounts]);

  // ---- actions -------------------------------------------------------------

  const actions = {
    launch: async (a) => {
      try {
        await api.launch(a.id);
        // A window that isn't signed in would only show Get started, so the
        // one-time sign-in steps come up with it. Signed in: it just opens.
        if (a.signedIn === false) setGuiding({ id: a.id, label: a.label });
        else say(`Opening ${a.label}…`);
        setTimeout(loadScan, 1500);
      } catch (e) { fail(e); }
    },
    // Show brings a running account's window forward, from the tray or
    // minimised. Claude does the showing itself, so there is nothing to wait for.
    show: async (a) => {
      try {
        await api.show(a.id);
      } catch (e) { fail(e); }
    },
    // Close asks first: quitting ends the whole process, which also stops
    // anything running inside that profile.
    close: (a) => setQuitting(a),
    confirmQuit: async () => {
      const a = quitting;
      try {
        const { closed, stillRunning } = await api.closeAccount(a.id);
        setQuitting(null);
        if (closed === 0) say(`${a.label} was not running.`);
        else if (stillRunning) say(`${a.label} is still running. Try again, or end it from ${isMac ? 'Activity Monitor' : 'Task Manager'}.`, true);
        else say(`${a.label} closed.`);
      } catch (e) {
        setQuitting(null);
        fail(e);
      } finally {
        // The service already waited for the scan to agree; this just refreshes
        // the row so the button flips to Launch immediately.
        loadScan();
      }
    },
    add: async (label) => {
      let a;
      try {
        a = await api.add(label);
      } catch (e) { fail(e); throw e; }

      setAdding(false);
      await loadAccounts();
      setActivity(null);

      // The one sign-in happens now: the account's own Claude window, by
      // email code. Claude keeps it, so Launch opens it signed in from then
      // on, and its usage limits come from what that window records.
      setGuiding({ id: a.id, label: a.label, first: true });
    },
    signInHelp: (a) => setGuiding({ id: a.id, label: a.label }),
    finishGuide: async (signedIn) => {
      const g = guiding;
      setGuiding(null);
      const list = await api.list().catch(() => null);
      if (list) setAccounts(list);
      const now = list && list.find((x) => x.id === g.id);
      if (signedIn && now && now.signedIn === false) {
        say(`${g.label}'s Claude window doesn't look signed in yet. Finish the email code there, then it stays signed in.`, true);
      } else if (signedIn) {
        say(`${g.label} is signed in. Launch opens it signed in from now on.`);
      } else {
        say(`Sign in to ${g.label} whenever you're ready: Launch shows the steps again.`);
      }
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
      if (view === 'detail' && detailId === a.id) setView('dashboard');
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
        // The icon is the account's colour and letter; if it can't be drawn,
        // the shortcut still works with Multi-Claude's own icon.
        let icon = null;
        try { icon = await drawAccountIcon(a); } catch { /* plain icon */ }
        await api.createShortcut(a.id, icon);
        say(`Desktop shortcut created for ${a.label}.`);
      } catch (e) { fail(e); }
    },
    setColor: async (a, color) => {
      try {
        let icon = null;
        try { icon = await drawAccountIcon({ ...a, color }); } catch { /* shortcut keeps its icon */ }
        const r = await api.setColor(a.id, color, icon);
        await loadAccounts();
        say(r && r.shortcutUpdated ? `${a.label}'s colour and desktop shortcut updated.` : `${a.label}'s colour updated.`);
      } catch (e) { fail(e); }
    },
    useVsCodeAccount: async (a) => {
      try {
        const r = await api.useVsCodeAccount(a.id);
        if (r && r.switched === false) {
          say('VS Code still has your own claudeCode.environmentVariables setting, so it is in control. Remove it to let Multi-Claude switch accounts.', true);
        } else if (r && r.notFound) {
          say(`VS Code will use ${a.label} next time it starts. It was not found in the usual install locations, so it was not opened.`);
        } else if (r && r.launched) {
          say(`VS Code is opening, using ${a.label}.`);
        } else {
          say(`VS Code is now using ${a.label}.`);
        }
      } catch (e) { fail(e); }
    },
    openTerminal: async (a) => {
      try {
        await api.openClaudeCode(a.id);
        say(`Opening a Claude Code terminal for ${a.label}.`);
      } catch (e) { fail(e); }
    },
    purgeCache: async (a) => {
      try {
        const { freed } = await api.purgeCache(a.id);
        loadStorage(true);
        say(freed > 0 ? `Freed ${(freed / 1048576).toFixed(0)} MB from ${a.label}.` : 'No cache to clear.');
      } catch (e) { fail(e); }
    },
    // Sign-in runs inside the app: no terminal window. See SignInDialog.
    connect: (row) => setSigningIn({ id: row.id, label: row.label }),
    refreshLimits: (force) => loadLimits(force),
    // Free Claude plans can't connect to Claude Code, so they never show limits.
    setFreePlan: async (a, free) => {
      try {
        await api.setFreePlan(a.id, free);
        say(free
          ? `${a.label} is marked as a free plan. It won't ask to connect for usage limits.`
          : `${a.label} is no longer marked as a free plan. Connect it to see its usage limits.`);
        loadLimits(false);
      } catch (e) { fail(e); }
    },
    startRename: setRenaming,
    startDelete: setDeleting,
    refreshStorage: () => { setStorage(null); loadStorage(true); }
  };

  const shared = {
    accounts, running, scanOk, sizes, activity, storage,
    limits, limitsLoading,
    days, setDays: changeRange, actions, setView, openAccount
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
          <img className="brand-mark" src={logoMark} alt="" />
          <div className="brand-name">Multi-Claude</div>
        </div>

        {NAV.map((n) => (
          <button
            key={n.id}
            className={view === n.id || (view === 'detail' && n.id === 'dashboard') ? 'nav-item active' : 'nav-item'}
            onClick={() => setView(n.id)}
          >
            <Icon name={n.icon} />
            {n.label}
          </button>
        ))}

        <div className="sidebar-foot">
          <div>Not affiliated with, or endorsed by, Anthropic.</div>
          <UpdateFoot />
        </div>
      </aside>

      <main className="main">
        {exeMissing && (
          <div className="banner">
            <span>Could not find {isMac ? 'Claude.app' : 'claude.exe'} automatically.</span>
            <span className="spacer" />
            <button onClick={onLocateExe}>Locate {isMac ? 'Claude.app' : 'claude.exe'}…</button>
          </div>
        )}

        {view === 'dashboard' && <Dashboard {...shared} onAdd={() => setAdding(true)} />}
        {view === 'accounts' && <Accounts {...shared} onAdd={() => setAdding(true)} />}
        {view === 'detail' && <AccountDetail {...shared} accountId={detailId} />}
        {view === 'history' && <History {...shared} />}
        {view === 'storage' && <Storage {...shared} />}
      </main>

      {adding && (
        <TextPromptDialog
          title="Add an account"
          description="A new Claude profile is created and you sign in to it once, right now, with an email code. That one sign-in is all it needs: Launch opens it signed in, and its usage limits show here."
          label="Account name"
          placeholder="Personal"
          confirmText="Create account"
          onConfirm={(label) => actions.add(label)}
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

      {guiding && (
        <ClaudeSignInGuide
          account={guiding}
          onOpenClaude={() => {
            api.launch(guiding.id).then(() => setTimeout(loadScan, 1500)).catch(fail);
          }}
          onOpenGmail={() => api.openGmail().catch(fail)}
          onDone={() => actions.finishGuide(true)}
          onLater={() => actions.finishGuide(false)}
        />
      )}

      {signingIn && (
        <SignInDialog
          account={signingIn}
          onDone={(acct) => {
            setSigningIn(null);
            say(`${acct.label} is connected. Loading its limits…`);
            loadLimits(true);
          }}
          onClose={() => { setSigningIn(null); loadLimits(true); }}
          onFreePlan={(acct) => { setSigningIn(null); actions.setFreePlan(acct, true); }}
        />
      )}

      {quitting && (
        <QuitDialog account={quitting} onConfirm={actions.confirmQuit} onCancel={() => setQuitting(null)} />
      )}

      {deleting && (
        <DeleteDialog account={deleting} onConfirm={actions.remove} onCancel={() => setDeleting(null)} />
      )}

      {toast && <div className={toast.isError ? 'toast error' : 'toast'}>{toast.message}</div>}
    </div>
  );
}
