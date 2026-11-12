import { call, newPage, waitForScans } from './app.mjs';

const DEMO = [
  { name: 'Wien 2–3 Zimmer', prefs: { states: ['wien'], districts: Array.from({ length: 23 }, (_, i) => i + 1), types: ['apartment'], maxPrice: 1500, minArea: 50, minRooms: 2, maxRooms: 3 } },
  { name: 'Graz Altbau', prefs: { states: ['steiermark'], types: ['apartment'], maxPrice: 1100, minArea: 45, minRooms: 2 } },
  { name: 'Salzburg Haus', prefs: { states: ['salzburg'], types: ['house'], maxPrice: 3000 } },
];

export async function scan(env) {
  const page = await newPage(env);
  const cfg = await call(page, 'config');
  if (!cfg.searches.length) {
    for (const { name, prefs } of DEMO) {
      await call(page, 'saveSearch', { name, prefs: { ...cfg.defaults, categories: cfg.categories, sources: cfg.sources.map((s) => s.id), ...prefs } });
    }
  } else {
    await call(page, 'scanAll');
  }
  await waitForScans(page);
  for (const s of await call(page, 'searches')) {
    const v = await call(page, 'listings', { id: s.id });
    const runs = Object.entries(v.runs).map(([k, r]) => `${k}:${r.ok ? r.count : 'error'}`).join(' ');
    console.log(`  ${s.name}: ${v.stats.groups} properties · ${runs}`);
  }
  await page.close();
}
