import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

export const SRC = fileURLToPath(new URL('../../src/', import.meta.url));
export const STORE = fileURLToPath(new URL('../../store/', import.meta.url));
export const RAW = `${STORE}raw/`;
const PROFILE = process.env.STORE_PROFILE ?? `${STORE}.profile`;
const PORT = Number(process.env.STORE_PORT ?? 9333);

const CHROME_PATHS = {
  win32: ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`],
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
  linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'],
};

function chromePath() {
  const found = process.env.CHROME ?? (CHROME_PATHS[process.platform] ?? []).find((p) => existsSync(p));
  if (!found) throw new Error('Chrome not found, set CHROME to its executable');
  return found;
}

async function waitForPort() {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Chrome did not open port ${PORT}`);
}

export async function startBrowser() {
  mkdirSync(PROFILE, { recursive: true });
  const proc = spawn(chromePath(), [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    '--enable-unsafe-extension-debugging',
    `--user-data-dir=${PROFILE}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    '--force-color-profile=srgb',
    '--lang=de-AT',
    'about:blank',
  ], { stdio: 'ignore' });
  await waitForPort();
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  const session = await browser.newBrowserCDPSession();
  const { id } = await session.send('Extensions.loadUnpacked', { path: SRC.replace(/[\\/]$/, '') });
  const userAgent = (await session.send('Browser.getVersion')).userAgent.replace('HeadlessChrome', 'Chrome');
  return {
    browser,
    ctx: browser.contexts()[0],
    appUrl: `chrome-extension://${id}/app/index.html`,
    userAgent,
    close: async () => {
      await browser.close().catch(() => {});
      proc.kill();
    },
  };
}
