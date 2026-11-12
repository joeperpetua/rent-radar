import { writeFileSync } from 'node:fs';

export const DESKTOP = { width: 1440, height: 900, scale: 2, mobile: false };
export const PHONE = { width: 390, height: 844, scale: 3, mobile: true };

export const call = (page, method, payload) => page.evaluate(([m, p]) => window.rentradar.call(m, p), [method, payload]);

export async function newPage(env, { width, height, scale, mobile } = DESKTOP) {
  for (const p of env.ctx.pages()) if (p.url().startsWith('chrome-extension://')) await p.close().catch(() => {});
  const page = await env.ctx.newPage();
  const cdp = await env.ctx.newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile });
  await cdp.send('Emulation.setUserAgentOverride', { userAgent: env.userAgent });
  if (mobile) await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  page.cdp = cdp;
  await page.goto(env.appUrl);
  await booted(page);
  return page;
}

export const booted = (page) => page.waitForFunction(() => window.rentradar && !document.body.classList.contains('booting'), null, { timeout: 20000 });

export async function settle(page, ms = 1200) {
  await page.waitForTimeout(400);
  await page.waitForFunction(() => [...document.images].filter((i) => {
    const r = i.getBoundingClientRect();
    return r.bottom > 0 && r.top < innerHeight && r.width > 0;
  }).every((i) => i.complete), null, { timeout: 20000 }).catch(() => console.warn('  images still loading'));
  await page.waitForTimeout(ms);
}

export async function snap(page, file) {
  const { data } = await page.cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(file, Buffer.from(data, 'base64'));
  console.log(`  ${file.split(/[\\/]/).pop()}`);
}

export async function waitForScans(page, timeoutMs = 600000) {
  const t0 = Date.now();
  await page.waitForTimeout(1500);
  for (;;) {
    const st = await call(page, 'status');
    if (!st.running && !st.queue.length) return;
    if (Date.now() - t0 > timeoutMs) throw new Error('scans did not finish');
    await page.waitForTimeout(2000);
  }
}
