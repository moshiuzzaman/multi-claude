import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './lib/api.js';
import AccountRow from './components/AccountRow.jsx';
import DeleteDialog from './components/DeleteDialog.jsx';
import TextPromptDialog from './components/TextPromptDialog.jsx';

const POLL_MS = 5000;

export default function App() {
  const [accounts, setAccounts] = useState([]);
  const [running, setRunning] = useState([]);
  const [scanOk, setScanOk] = useState(true);
  const [sizes, setSizes] = useState({});
  const [toast, setToast] = useState(null);
  const [exeMissing, setExeMissing] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [renaming, setRenaming] = useState(null);
  const [adding, setAdding] = useState(false);

  const toastTimer = useRef(null);

  const say = useCallback((message, isError = false) => {
    clearTimeout(toastTimer.current);
    setToast({ message, isError });
    toastTimer.current = setTimeout(() => setToast(null), isError ? 6000 : 3000);
  }, []);

  const fail = useCallback((e) => {
    if (e.code === 'no_exe') setExeMissing(true);
    say(e.message, true);
  }, [say]);

  const refreshAccounts = useCallback(async () => {
    try {
      setAccounts(await api.list());
    } catch (e) {
      fail(e);
    }
  }, [fail]);

  const refreshScan = useCallback(async () => {
    try {
      const { running: ids, ok } = await api.scan();
      setRunning(ids);
      setScanOk(ok);
    } catch {
      setScanOk(false);
    }
  }, []);

  const refreshSizes = useCallback(async () => {
    try {
      setSizes(await api.sizes());
    } catch {
      /* sizes are cosmetic; a failure here is not worth a toast */
    }
  }, []);

  // Initial load.
  useEffect(() => {
    refreshAccounts();
    refreshScan();
    refreshSizes();
  }, [refreshAccounts, refreshScan, refreshSizes]);

  // Poll for running state, but only while the window has focus — there is no
  // reason to spawn a PowerShell process every 5s at a window nobody is looking at.
  useEffect(() => {
    let timer = null;
    const start = () => {
      if (timer) return;
      refreshScan();
      timer = setInterval(refreshScan, POLL_MS);
    };
    const stop = () => {
      clearInterval(timer);
      timer = null;
    };

    if (document.hasFocus()) start();
    window.addEventListener('focus', start);
    window.addEventListener('blur', stop);
    return () => {
      stop();
      window.removeEventListener('focus', start);
      window.removeEventListener('blur', stop);
    };
  }, [refreshScan]);

  const onLaunch = async (acct) => {
    try {
      await api.launch(acct.id);
      say(`Opening ${acct.label}…`);
      setTimeout(refreshScan, 1500);
    } catch (e) {
      fail(e);
    }
  };

  const onAdd = async (label) => {
    try {
      const a = await api.add(label);
      setAdding(false);
      await refreshAccounts();
      say(`Created ${a.label}. Sign in to that account in the Claude window.`);
      setTimeout(refreshScan, 1500);
    } catch (e) {
      fail(e);
      throw e;
    }
  };

  const onRename = async (label) => {
    try {
      await api.rename(renaming.id, label);
      setRenaming(null);
      await refreshAccounts();
      say('Renamed. The folder on disk keeps its original name.');
    } catch (e) {
      fail(e);
      throw e;
    }
  };

  const onDelete = async (confirmLabel, unlock) => {
    const acct = deleting;
    await api.remove(acct.id, confirmLabel, unlock);
    setDeleting(null);
    await refreshAccounts();
    await refreshSizes();
    say(`Deleted ${acct.label} from this PC.`);
  };

  const onForget = async (acct) => {
    try {
      await api.forget(acct.id);
      await refreshAccounts();
      say(`Removed ${acct.label} from the list.`);
    } catch (e) {
      fail(e);
    }
  };

  const onOpenFolder = async (acct) => {
    try {
      await api.openFolder(acct.id);
    } catch (e) {
      fail(e);
    }
  };

  const onShortcut = async (acct) => {
    try {
      await api.createShortcut(acct.id);
      say(`Desktop shortcut created for ${acct.label}.`);
    } catch (e) {
      fail(e);
    }
  };

  const onLocateExe = async () => {
    try {
      const { path } = await api.locateExe();
      if (path) {
        setExeMissing(false);
        say('Saved. Try launching again.');
      }
    } catch (e) {
      fail(e);
    }
  };

  return (
    <div className="app">
      <header className="header">
        <h1>Multi-Claude</h1>
        <span className="count">
          {accounts.length} {accounts.length === 1 ? 'account' : 'accounts'}
        </span>
        <span className="spacer" />
        <button className="primary" onClick={() => setAdding(true)}>
          + Add account
        </button>
      </header>

      {exeMissing && (
        <div className="banner">
          <span>Could not find claude.exe automatically.</span>
          <span className="spacer" />
          <button onClick={onLocateExe}>Locate claude.exe…</button>
        </div>
      )}

      <div className="list">
        {accounts.length === 0 && <div className="empty">No accounts yet.</div>}
        {accounts.map((a) => (
          <AccountRow
            key={a.id}
            account={a}
            running={running.includes(a.id)}
            scanOk={scanOk}
            size={sizes[a.id]}
            onLaunch={() => onLaunch(a)}
            onOpenFolder={() => onOpenFolder(a)}
            onShortcut={() => onShortcut(a)}
            onRename={() => setRenaming(a)}
            onDelete={() => setDeleting(a)}
            onForget={() => onForget(a)}
          />
        ))}
      </div>

      <footer className="footer">
        <span>Not affiliated with, or endorsed by, Anthropic.</span>
      </footer>

      {adding && (
        <TextPromptDialog
          title="Add an account"
          description="A new, empty Claude profile is created and opened. Sign in to the account you want to use there."
          label="Account name"
          placeholder="Personal"
          confirmText="Create and open"
          onConfirm={onAdd}
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
          onConfirm={onRename}
          onCancel={() => setRenaming(null)}
        />
      )}

      {deleting && (
        <DeleteDialog
          account={deleting}
          onConfirm={onDelete}
          onCancel={() => setDeleting(null)}
        />
      )}

      {toast && (
        <div className={toast.isError ? 'toast error' : 'toast'}>{toast.message}</div>
      )}
    </div>
  );
}
