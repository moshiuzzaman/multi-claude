'use strict';
// Runs Anthropic's own `claude auth login` with no visible terminal, so the
// sign-in can be shown inside Multi-Claude.
//
// What this is, precisely: a terminal with no window. The unmodified Claude
// Code binary still runs Anthropic's sign-in flow — it opens the browser, and
// either receives the result itself or reads a code the user pastes. When the
// user pastes a code into Multi-Claude, it is written straight to the CLI's
// stdin, exactly as typing it into a terminal would, and then forgotten: it is
// never stored, logged, returned, or exchanged by this app. The CLI exchanges
// it and keeps its own credentials in the account's config dir.

const { spawn } = require('node:child_process');

const OUTPUT_CAP = 16 * 1024;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

// Only ever open sign-in pages on Anthropic's own hosts.
const ALLOWED_HOSTS = ['claude.com', 'claude.ai', 'anthropic.com'];

function hostAllowed(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    return ALLOWED_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith('.' + h));
  } catch {
    return false;
  }
}

/** The fallback sign-in URL the CLI prints. */
function extractUrl(text) {
  const m = /https:\/\/\S+\/oauth\/authorize\?\S+/.exec(String(text));
  return m && hostAllowed(m[0]) ? m[0] : null;
}

/** A user-readable failure line, with any URL removed. */
function failureMessage(text) {
  const lines = String(text)
    .split(/\r?\n/)
    .map((l) => l.replace(/https?:\/\/\S+/g, '').trim())
    .filter(Boolean);
  const failed = lines.reverse().find((l) => /login failed|error/i.test(l));
  if (!failed) return "Sign-in didn't complete.";
  // The CLI prints its error on the same line as its "Paste code here >"
  // prompt; keep only the message itself.
  const at = failed.search(/login failed|error/i);
  return failed.slice(at).trim();
}

/**
 * Basic shape check before anything reaches the CLI. Rejects line breaks so a
 * paste can never inject a second line of input.
 */
function validCode(code) {
  if (typeof code !== 'string') return false;
  const c = code.trim();
  return c.length > 0 && c.length <= 2048 && !/[\r\n]/.test(c);
}

function createLoginManager({ spawnImpl = spawn, openExternal, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const sessions = new Map(); // account id -> session

  function publicStatus(s) {
    if (!s) return { state: 'idle' };
    return { state: s.state, message: s.message || null, hasPage: !!s.url };
  }

  function end(s) {
    if (s.timer) clearTimeout(s.timer);
    s.timer = null;
  }

  function cancel(id) {
    const s = sessions.get(id);
    if (!s) return { state: 'idle' };
    if (s.state === 'waiting' || s.state === 'checking') {
      s.state = 'cancelled';
      end(s);
      try { s.child.kill(); } catch { /* already gone */ }
    }
    return publicStatus(s);
  }

  return {
    start(id, { cliPath, configDir, email } = {}) {
      cancel(id);

      const args = ['auth', 'login'];
      if (email) args.push('--email', email);

      const child = spawnImpl(cliPath, args, {
        env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      });

      const s = { child, state: 'waiting', url: null, message: null, out: '', timer: null };
      sessions.set(id, s);

      const onData = (d) => {
        if (s.out.length < OUTPUT_CAP) s.out += String(d);
        if (!s.url) s.url = extractUrl(s.out);
      };
      if (child.stdout) child.stdout.on('data', onData);
      if (child.stderr) child.stderr.on('data', onData);

      child.on('error', () => {
        if (s.state === 'cancelled') return;
        s.state = 'failed';
        s.message = 'Claude Code could not be started.';
        end(s);
      });

      child.on('exit', (code) => {
        if (s.state === 'cancelled') return;
        end(s);
        if (code === 0) {
          s.state = 'done';
          s.message = null;
        } else {
          s.state = 'failed';
          s.message = failureMessage(s.out);
        }
      });

      s.timer = setTimeout(() => {
        if (s.state !== 'waiting' && s.state !== 'checking') return;
        s.state = 'failed';
        s.message = 'Sign-in timed out. Start it again when you are ready.';
        try { child.kill(); } catch { /* gone */ }
      }, timeoutMs);
      if (s.timer.unref) s.timer.unref();

      return publicStatus(s);
    },

    status(id) {
      return publicStatus(sessions.get(id));
    },

    /** Hand a pasted code to the CLI. The code is not kept anywhere. */
    submit(id, code) {
      const s = sessions.get(id);
      if (!s || (s.state !== 'waiting' && s.state !== 'checking')) {
        const e = new Error('There is no sign-in waiting for a code. Start it again.');
        e.code = 'no_login';
        throw e;
      }
      if (!validCode(code)) {
        const e = new Error('That does not look like a sign-in code.');
        e.code = 'bad_code';
        throw e;
      }
      s.state = 'checking';
      s.child.stdin.write(code.trim() + '\n');
      return publicStatus(s);
    },

    cancel,

    /** Re-open the sign-in page. The URL never comes from the renderer. */
    openPage(id) {
      const s = sessions.get(id);
      if (!s || !s.url || !hostAllowed(s.url) || !openExternal) {
        const e = new Error('The sign-in page is not available. Start the sign-in again.');
        e.code = 'no_page';
        throw e;
      }
      openExternal(s.url);
      return { ok: true };
    },

    cancelAll() {
      for (const id of sessions.keys()) cancel(id);
    }
  };
}

module.exports = { createLoginManager, extractUrl, failureMessage, validCode, hostAllowed };
