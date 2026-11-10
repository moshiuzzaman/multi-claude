'use strict';
// Multi-Claude entry point.
//
// Two modes:
//   normal          -> opens the manager window
//   --launch <id>   -> starts that profile and exits without ever showing a window
//
// The renderer is served over a custom app:// protocol rather than file://,
// because ES modules are blocked by CORS on file:// and because a real origin
// lets the Content-Security-Policy stay at 'self'.

const { app, BrowserWindow, shell, protocol } = require('electron');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { spawn } = require('node:child_process');

const { createService } = require('./service.js');
const { createLocator, resolveDefaultProfileDir } = require('./claude-locator.js');
const { createLauncher } = require('./launcher.js');
const { createScanner } = require('./scanner.js');
const { createCloser } = require('./closer.js');
const { runPowerShell } = require('./run-powershell.js');
const { parseLaunchArg } = require('./argv.js');
const ipc = require('./ipc.js');

if (process.platform !== 'win32') {
  console.error('Multi-Claude is Windows-only.');
  app.exit(1);
}

const RENDERER_DIR = path.join(__dirname, '..', '..', 'dist-renderer');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

if (!app.requestSingleInstanceLock()) {
  // Another instance owns the lock; it will handle our argv via 'second-instance'.
  app.quit();
} else {
  let win = null;
  let service = null;

  async function buildService() {
    const userProfile = os.homedir();
    const defaultProfileDir = await resolveDefaultProfileDir({
      fsImpl: fs, env: process.env, runPowerShell
    });

    const appDir = path.join(app.getPath('appData'), 'multi-claude');

    return createService({
      configFile: path.join(appDir, 'accounts.json'),
      usageCacheFile: path.join(appDir, 'usage-cache.json'),
      storageCacheFile: path.join(appDir, 'storage-cache.json'),
      // One Claude Code config dir per account, each with its own official sign-in.
      ccRoot: path.join(appDir, 'cc'),
      // One VS Code profile per account. Separate processes are the only way a
      // per-account CLAUDE_CONFIG_DIR survives VS Code's single-instance handoff.
      vscodeRoot: path.join(appDir, 'vscode'),
      vscodeUserDir: path.join(app.getPath('appData'), 'Code', 'User'),
      recorderFile: path.join(appDir, 'limits-recorder.ps1'),
      activityFile: path.join(appDir, 'activity.jsonl'),
      // Claude Code's session logs. Home-based, so shared by every profile.
      claudeProjectsRoot: path.join(userProfile, '.claude', 'projects'),
      claudeConfigFile: path.join(userProfile, '.claude.json'),
      profilesRoot: path.join(userProfile, 'ClaudeProfiles'),
      userProfile,
      defaultProfileDir,
      locator: createLocator({ fsImpl: fs, env: process.env, runPowerShell }),
      launcher: createLauncher({ spawnImpl: spawn }),
      scanner: createScanner({ runPowerShell }),
      closer: createCloser({ runPowerShell }),
      shellImpl: shell,
      desktopDir: app.getPath('desktop'),
      appExePath: process.execPath,
      // In a dev run the target is electron.exe, which needs the project path first.
      shortcutArgsPrefix: app.isPackaged ? '' : `"${app.getAppPath()}" `
    });
  }

  const MIME = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2'
  };

  function registerAppProtocol() {
    protocol.handle('app', async (request) => {
      const url = new URL(request.url);
      let rel = decodeURIComponent(url.pathname);
      if (rel === '/' || rel === '') rel = '/index.html';

      const file = path.normalize(path.join(RENDERER_DIR, rel));
      if (file !== RENDERER_DIR && !file.startsWith(RENDERER_DIR + path.sep)) {
        return new Response('Forbidden', { status: 403 });
      }

      // Read through fs rather than net.fetch(file://): in a packaged build
      // these files live inside app.asar, and only fs is asar-aware.
      try {
        const data = await fsp.readFile(file);
        return new Response(data, {
          headers: {
            'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream'
          }
        });
      } catch {
        return new Response('Not found', { status: 404 });
      }
    });
  }

  function createWindow() {
    win = new BrowserWindow({
      width: 1140, height: 760, minWidth: 840, minHeight: 560,
      backgroundColor: '#1f1e1d',
      show: false,
      title: 'Multi-Claude',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        // The dashboard keeps polling and animating while in the background;
        // throttling it makes the running indicators go stale.
        backgroundThrottling: false,
        preload: path.join(__dirname, '..', 'preload', 'preload.js')
      }
    });

    win.removeMenu();
    win.once('ready-to-show', () => win.show());

    // The window only ever shows our own bundled UI.
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    // Diagnostics. A packaged Windows GUI app has no console to print to, so
    // MULTI_CLAUDE_DEBUG=1 sends the same lines to a file instead.
    if (!app.isPackaged || process.env.MULTI_CLAUDE_DEBUG) {
      const logFile = process.env.MULTI_CLAUDE_DEBUG
        ? path.join(os.tmpdir(), 'multi-claude-debug.log')
        : null;
      const log = (line) => {
        if (logFile) {
          try { fs.appendFileSync(logFile, line + '\n'); } catch { /* best effort */ }
        } else {
          console.log(line);
        }
      };

      win.webContents.on('console-message', (_e, _level, message, line, source) => {
        log(`[renderer] ${message} (${source}:${line})`);
      });
      win.webContents.on('did-fail-load', (_e, code, desc, url) => {
        log(`[renderer] FAILED to load ${url}: ${desc} (${code})`);
      });
      win.webContents.on('did-finish-load', async () => {
        log('[renderer] loaded');
        // The list arrives asynchronously over IPC, so poll briefly rather
        // than sampling once at load and reporting a meaningless zero.
        for (let i = 0; i < 48; i++) {
          try {
            const r = await win.webContents.executeJavaScript(
              'JSON.stringify({panels:document.querySelectorAll(".panel").length,' +
              'accts:document.querySelectorAll(".acct").length,' +
              'nav:document.querySelectorAll(".nav-item").length,' +
              'svg:document.querySelectorAll(".chart-svg").length,' +
              'bars:document.querySelectorAll(".bar-row").length,' +
              'skeleton:document.querySelectorAll(".skeleton").length})'
            );
            const got = JSON.parse(r);
            // Wait for real data, not merely a mounted shell: bars only render
            // once the usage scan has returned.
            const ready = got.panels > 0 && got.skeleton === 0 && got.bars > 0 && got.svg > 0;
            if (ready || i === 47) {
              log(`[renderer] rendered after ${(i + 1) * 250}ms: ${r}`);
              if (process.env.MULTI_CLAUDE_SHOT) {
                try {
                  // An occluded window is not recomposited, so capturePage
                  // would hand back a stale frame. Front it and let it paint.
                  win.show();
                  win.focus();
                  const base = process.env.MULTI_CLAUDE_SHOT.replace(/\.png$/i, '');

                  const views = await win.webContents.executeJavaScript(
                    "document.querySelectorAll('.nav-item').length"
                  );
                  for (let n = 0; n < views; n++) {
                    if (n > 0) {
                      await win.webContents.executeJavaScript(
                        `document.querySelectorAll('.nav-item')[${n}].click()`
                      );
                    }
                    await new Promise((r) => setTimeout(r, Number(process.env.MULTI_CLAUDE_SHOT_WAIT) || 1400));
                    const name = await win.webContents.executeJavaScript(
                      "document.querySelector('.page-head h1')?.textContent || 'view'"
                    );
                    const img = await win.webContents.capturePage();
                    const out = `${base}-${n}-${String(name).toLowerCase()}.png`;
                    await fsp.writeFile(out, img.toPNG());
                    log(`[renderer] screenshot -> ${out}`);
                  }

                  // Capture one account's own page (Dashboard -> first card).
                  await win.webContents.executeJavaScript("document.querySelectorAll('.nav-item')[0].click()");
                  await new Promise((r) => setTimeout(r, 800));
                  await win.webContents.executeJavaScript("document.querySelector('.acct-card')?.click()");
                  await new Promise((r) => setTimeout(r, Number(process.env.MULTI_CLAUDE_SHOT_WAIT) || 1400));
                  await fsp.writeFile(`${base}-detail.png`, (await win.webContents.capturePage()).toPNG());
                  log(`[renderer] screenshot -> ${base}-detail.png`);

                  // Also capture the Add dialog, which no view shows on its own.
                  await win.webContents.executeJavaScript(
                    "document.querySelectorAll('.nav-item')[1].click()"
                  );
                  await new Promise((r) => setTimeout(r, 800));
                  await win.webContents.executeJavaScript(
                    "[...document.querySelectorAll('button')].find(b => b.textContent.includes('Add account'))?.click()"
                  );
                  await new Promise((r) => setTimeout(r, 800));
                  const dlg = await win.webContents.capturePage();
                  await fsp.writeFile(`${base}-dialog-add.png`, dlg.toPNG());
                  log(`[renderer] screenshot -> ${base}-dialog-add.png`);
                  // Close it without creating anything.
                  await win.webContents.executeJavaScript(
                    "[...document.querySelectorAll('.modal button')].find(b => b.textContent === 'Cancel')?.click()"
                  );

                  // Opt-in: exercise the real in-app sign-in with a deliberately
                  // invalid code. Never completes a sign-in.
                  if (process.env.MULTI_CLAUDE_SHOT_SIGNIN) {
                    const js = (code) => win.webContents.executeJavaScript(code);
                    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
                    await js("[...document.querySelectorAll('.nav-item')].find(b => b.textContent.includes('Account') && !b.textContent.includes('Accounts'))?.click()");
                    await wait(1500);
                    await js("[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Connect')?.click()");
                    await wait(6000);
                    await fsp.writeFile(`${base}-signin-1-waiting.png`, (await win.webContents.capturePage()).toPNG());
                    await js("[...document.querySelectorAll('button')].find(b => b.textContent.includes(\"didn't open\"))?.click()");
                    await wait(500);
                    await js(`(() => {
                      const el = document.getElementById('signin-code');
                      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
                      set.call(el, 'not-a-real-code#123');
                      el.dispatchEvent(new Event('input', { bubbles: true }));
                    })()`);
                    await wait(300);
                    await fsp.writeFile(`${base}-signin-2-paste.png`, (await win.webContents.capturePage()).toPNG());
                    await js("[...document.querySelectorAll('.modal button')].find(b => b.textContent === 'Submit')?.click()");
                    await wait(9000);
                    await fsp.writeFile(`${base}-signin-3-result.png`, (await win.webContents.capturePage()).toPNG());
                    log('[renderer] sign-in probe captured');
                    await js("[...document.querySelectorAll('.modal button')].find(b => b.textContent === 'Cancel')?.click()");
                  }
                } catch (err) {
                  log(`[renderer] screenshot failed: ${err.message}`);
                }
              }
              return;
            }
          } catch (e) {
            log(`[renderer] probe failed: ${e.message}`);
            return;
          }
          await new Promise((r) => setTimeout(r, 250));
        }
      });
    }

    win.loadURL('app://bundle/index.html');
  }

  async function launchById(id) {
    try {
      await service.launch({ id });
    } catch (e) {
      console.error('launch failed:', e.message);
    }
  }

  app.on('second-instance', async (_e, argv) => {
    const id = parseLaunchArg(argv);
    if (id) {
      await launchById(id);
      return;
    }
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    service = await buildService();
    await service.init();

    const id = parseLaunchArg(process.argv);
    if (id) {
      // Shortcut mode: launch the profile and get out of the way.
      await launchById(id);
      app.quit();
      return;
    }

    registerAppProtocol();
    ipc.register(service);
    createWindow();
  });

  // Close any open activity session and flush the usage cache before exiting.
  let shuttingDown = false;
  app.on('before-quit', async (e) => {
    if (shuttingDown || !service) return;
    shuttingDown = true;
    e.preventDefault();
    try { await service.shutdown(); } catch { /* best effort */ }
    app.quit();
  });

  app.on('window-all-closed', () => app.quit());
}
