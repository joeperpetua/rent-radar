import { app, BrowserWindow, ipcMain, Menu, net, protocol, shell } from 'electron';
import { dirname, join, normalize, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { closeDb, getSetting, openDb } from '../core/db.js';
import { dispatch, staleSearches } from '../core/api.js';
import { enqueueScan, onScanChange, scanStatus } from '../core/scan.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const RENDERER_DIR = join(HERE, '..', 'renderer');
const SCHEME = 'app';
const ORIGIN = `${SCHEME}://rentradar`;
const STATUS_THROTTLE_MS = 250;
const AUTO_REFRESH_CHECK_MS = 60 * 1000;

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

if (!app.requestSingleInstanceLock()) app.quit();

let win = null;

function serveRenderer(request) {
  const { pathname } = new URL(request.url);
  const file = normalize(join(RENDERER_DIR, decodeURIComponent(pathname === '/' ? '/index.html' : pathname)));
  if (!file.startsWith(RENDERER_DIR + sep)) return new Response('forbidden', { status: 403 });
  return net.fetch(pathToFileURL(file).toString());
}

const isExternal = (url) => /^https?:\/\//i.test(url);

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 720,
    minHeight: 560,
    title: 'RentRadar Austria',
    backgroundColor: '#f6f5f2',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(HERE, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternal(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(ORIGIN)) return;
    event.preventDefault();
    if (isExternal(url)) shell.openExternal(url);
  });
  win.on('closed', () => { win = null; });
  win.loadURL(`${ORIGIN}/index.html`);
}

function bindStatusPush() {
  let timer = null;
  onScanChange(() => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      win?.webContents.send('scan-status', scanStatus());
    }, STATUS_THROTTLE_MS);
  });
}

function autoRefresh() {
  for (const search of staleSearches(getSetting('autoRefreshMinutes', 0))) enqueueScan(search.id);
}

ipcMain.handle('api', async (event, method, payload) => {
  if (!event.senderFrame?.url.startsWith(ORIGIN)) throw new Error('forbidden');
  try {
    return { ok: true, data: await dispatch(method, payload) };
  } catch (err) {
    console.error(`[api] ${method}:`, err);
    return { ok: false, error: err.message };
  }
});

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(() => {
  openDb(process.env.RENTRADAR_DB ?? join(app.getPath('userData'), 'rentradar.db'));
  protocol.handle(SCHEME, serveRenderer);
  Menu.setApplicationMenu(null);
  bindStatusPush();
  createWindow();
  autoRefresh();
  setInterval(() => {
    try { autoRefresh(); } catch (err) { console.error(err); }
  }, AUTO_REFRESH_CHECK_MS);
  app.on('activate', () => {
    if (!BrowserWindow.getAllWindows().length) createWindow();
  });
});

app.on('window-all-closed', () => app.quit());
app.on('will-quit', closeDb);
