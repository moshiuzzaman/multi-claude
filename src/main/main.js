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

    return createService({
      configFile: path.join(app.getPath('appData'), 'multi-claude', 'accounts.json'),
      profilesRoot: path.join(userProfile, 'ClaudeProfiles'),
      userProfile,
      defaultProfileDir,
      locator: createLocator({ fsImpl: fs, env: process.env, runPowerShell }),
      launcher: createLauncher({ spawnImpl: spawn }),
      scanner: createScanner({ runPowerShell }),
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
      width: 780, height: 660, minWidth: 560, minHeight: 440,
      backgroundColor: '#1f1e1d',
      show: false,
      title: 'Multi-Claude',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
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
        for (let i = 0; i < 20; i++) {
          try {
            const rows = await win.webContents.executeJavaScript(
              'document.querySelectorAll(".row").length'
            );
            if (rows > 0 || i === 19) {
              log(`[renderer] account rows rendered: ${rows} (after ${(i + 1) * 250}ms)`);
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

  app.on('window-all-closed', () => app.quit());
}
