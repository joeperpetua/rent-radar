import { mkdirSync } from 'node:fs';
import { RAW } from './browser.mjs';
import { DESKTOP, PHONE, booted, call, newPage, settle, snap, waitForScans } from './app.mjs';

const MAIN_SEARCH = 1;
const VIEW = { q: '', sort: 'new', onlyNew: false, onlyMulti: false, onlyDropped: false };

async function open(env, lang, { theme = 'light', style = 'styled', hash = '#/', size = DESKTOP } = {}) {
  const page = await newPage(env, size);
  for (const [key, value] of Object.entries({ locale: lang, theme, style, activeSearchId: MAIN_SEARCH, view: VIEW })) {
    await call(page, 'setSetting', { key, value });
  }
  await page.evaluate(([t, s]) => {
    localStorage.setItem('rentradar-theme', t);
    localStorage.setItem('rentradar-style', s);
  }, [theme, style]);
  await page.reload();
  await booted(page);
  if (hash !== '#/') await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForSelector('#grid .card, #favorites-view .card, #detail-view .detail', { state: 'attached', timeout: 30000 });
  await settle(page);
  return page;
}

const imageRatio = (page, src) => page.evaluate((url) => new Promise((resolve) => {
  const img = new Image();
  img.onload = () => resolve(img.naturalWidth / img.naturalHeight);
  img.onerror = () => resolve(0);
  img.src = url;
}), src);

const SHOTS = {
  async list(env, lang) {
    const page = await open(env, lang);
    await page.hover('.status-summary');
    await settle(page, 600);
    await snap(page, `${RAW}${lang}-list.png`);
    await page.close();
  },

  async detail(env, lang) {
    const page = await open(env, lang);
    const { groups } = await call(page, 'listings', { id: MAIN_SEARCH });
    const candidates = groups.filter((g) => new Set(g.sources.map((s) => s.source)).size >= 3 && g.images?.length >= 4 && g.lat != null && g.area && g.title.length < 60);
    let pick = candidates[0];
    for (const g of candidates.slice(0, 15)) {
      if (await imageRatio(page, g.images[0]) > 1.3) {
        pick = g;
        break;
      }
    }
    await page.evaluate((id) => { location.hash = `#/l/${encodeURIComponent(id)}`; }, pick.id);
    await page.waitForSelector('#detail-view .detail');
    await page.evaluate(() => {
      document.querySelector('.detail-grid')?.scrollIntoView({ block: 'start' });
      window.scrollBy(0, -90);
    });
    await settle(page, 2500);
    await snap(page, `${RAW}${lang}-detail.png`);
    await page.close();
  },

  async favorites(env, lang) {
    const seed = await newPage(env);
    for (const id of [1, 2]) {
      const { groups } = await call(seed, 'listings', { id });
      const nice = groups.filter((g) => g.images?.length >= 3 && g.area && g.price && g.title.length < 55).slice(id === 1 ? 3 : 10, id === 1 ? 9 : 14);
      await call(seed, 'favorites', { add: nice.flatMap((g) => g.sources.map((s) => s.id)) });
    }
    await seed.close();
    const page = await open(env, lang, { hash: '#/favorites' });
    await settle(page, 1500);
    await snap(page, `${RAW}${lang}-favorites.png`);
    await page.close();
  },

  async compact(env, lang) {
    const page = await open(env, lang, { theme: 'dark', style: 'compact' });
    await snap(page, `${RAW}${lang}-compact.png`);
    await page.close();
  },

  async settings(env, lang) {
    const page = await open(env, lang);
    await page.click('#settings-trigger');
    await settle(page, 800);
    await snap(page, `${RAW}${lang}-settings.png`);
    await page.close();
  },

  async mobile(env, lang) {
    const list = await open(env, lang, { size: PHONE });
    await snap(list, `${RAW}${lang}-mobile-list.png`);
    await list.close();
    const filters = await open(env, lang, { size: PHONE, theme: 'dark' });
    await filters.click('[data-bottom="filters"]');
    await settle(filters, 900);
    await snap(filters, `${RAW}${lang}-mobile-filters.png`);
    await filters.close();
  },

  async radar(env, lang) {
    const page = await open(env, lang);
    const cfg = await call(page, 'config');
    const { search } = await call(page, 'saveSearch', {
      name: lang === 'de' ? 'Innsbruck & Umgebung' : 'Innsbruck area',
      prefs: { ...cfg.defaults, states: ['tirol'], types: ['apartment', 'house'], categories: cfg.categories, sources: cfg.sources.map((s) => s.id), maxPrice: 1600, minArea: 40, minRooms: 2 },
    });
    try {
      await call(page, 'setSetting', { key: 'activeSearchId', value: search.id });
      await page.reload();
      await booted(page);
      await page.waitForTimeout(800);
      await page.click('#refresh');
      await page.waitForSelector('#radar:not([hidden])', { timeout: 15000 });
      const t0 = Date.now();
      for (;;) {
        const states = Object.values((await call(page, 'status')).progress?.sources ?? {}).map((s) => s.state);
        const done = states.filter((s) => s !== 'running').length;
        if ((done >= states.length - 2 && done < states.length) || Date.now() - t0 > 15000) break;
        await page.waitForTimeout(250);
      }
      await page.waitForTimeout(400);
      await snap(page, `${RAW}${lang}-radar.png`);
      await waitForScans(page);
    } finally {
      await call(page, 'deleteSearch', { id: search.id });
      await call(page, 'setSetting', { key: 'activeSearchId', value: MAIN_SEARCH });
      await page.close();
    }
  },
};

export async function capture(env, langs, only) {
  mkdirSync(RAW, { recursive: true });
  for (const lang of langs) {
    for (const [name, shot] of Object.entries(SHOTS)) {
      if (only && !only.includes(name)) continue;
      console.log(`${lang} ${name}`);
      await shot(env, lang);
    }
  }
}
