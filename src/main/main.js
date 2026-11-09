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

const { app, BrowserWindow, shell, protocol, net } = require('electron');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
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

  function registerAppProtocol() {
    protocol.handle('app', async (request) => {
      const url = new URL(request.url);
      let rel = decodeURIComponent(url.pathname);
      if (rel === '/' || rel === '') rel = '/index.html';

      const file = path.normalize(path.join(RENDERER_DIR, rel));
      if (file !== RENDERER_DIR && !file.startsWith(RENDERER_DIR + path.sep)) {
        return new Response('Forbidden', { status: 403 });
      }
      return net.fetch(pathToFileURL(file).toString());
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

    if (!app.isPackaged) {
      win.webContents.on('console-message', (_e, level, message, line, source) => {
        console.log(`[renderer] ${message} (${source}:${line})`);
      });
      win.webContents.on('did-fail-load', (_e, code, desc, url) => {
        console.error(`[renderer] failed to load ${url}: ${desc} (${code})`);
      });
      win.webContents.on('did-finish-load', () => console.log('[renderer] loaded'));
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
