import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'immo-view-'));
process.env.DATA_DIR = dir;

const db = await import('../src/db.js');
const { buildView } = await import('../src/scrape.js');
const { DEFAULT_PREFS } = await import('../src/prefs.js');

after(() => {
  db.closeDb();
  rmSync(dir, { recursive: true, force: true });
});

const title = 'Altbau mit Charakter: 2-Zimmer + separate Küche | WG-geeignet';
const flat = (source, price) => ({
  id: `${source}:flat`, source, type: 'apartment', title, price, area: 67, rooms: 2,
  postcode: '1100', district: 10, address: null, images: [], extras: [],
});
const scrape = (at, price) => db.saveScrape({
  startedAt: at,
  results: [
    { key: 'willhaben', listings: [flat('willhaben', price)], ms: 1 },
    { key: 'immoscout', listings: [flat('immoscout', 990)], ms: 1 },
  ],
  scope: {},
});
const prefs = { ...DEFAULT_PREFS, maxPrice: 0 };
const group = () => buildView(prefs).groups.find((g) => g.sources.some((s) => s.id === 'willhaben:flat'));

test('a group without price changes has no priceChange', () => {
  scrape('2026-03-01T00:00:00.000Z', 1000);
  assert.equal(group().priceChange, null);
  assert.equal(group().sources.find((s) => s.source === 'willhaben').priceHistory, null);
});

test('reports the latest price drop of the primary listing with its history', () => {
  scrape('2026-03-02T00:00:00.000Z', 950);
  const g = group();
  assert.deepEqual(g.priceChange, { source: 'willhaben', previous: 1000, current: 950, delta: -50, pct: -5, at: '2026-03-02T00:00:00.000Z' });
  assert.deepEqual(g.sources.find((s) => s.source === 'willhaben').priceHistory.map((h) => h.price), [1000, 950]);
});

test('reports a price increase as a positive delta', () => {
  scrape('2026-03-03T00:00:00.000Z', 980);
  assert.equal(group().priceChange.delta, 30);
});

test('excludes listings without price from view and stats', () => {
  db.saveScrape({
    startedAt: '2026-03-04T00:00:00.000Z',
    results: [
      { key: 'willhaben', listings: [flat('willhaben', null)], ms: 1 },
    ],
    scope: {},
  });
  const view = buildView(prefs);
  assert.equal(view.groups.some((g) => g.sources.some((s) => s.id === 'willhaben:flat')), false);
});
