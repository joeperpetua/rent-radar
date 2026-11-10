import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'immo-db-'));
process.env.DATA_DIR = dir;

const listing = (id, fields = {}) => ({
  id: `willhaben:${id}`, source: 'willhaben', type: 'apartment', title: `Wohnung ${id}`,
  price: 900, area: 65, rooms: 2, state: 'wien', district: 10, postcode: '1100', images: [], extras: [], ...fields,
});

writeFileSync(join(dir, 'prefs.json'), JSON.stringify({ maxPrice: 1200 }));
writeFileSync(join(dir, 'store.json'), JSON.stringify({
  listings: { 'willhaben:old': { ...listing('old'), firstSeen: '2026-01-01T00:00:00.000Z', lastSeen: '2026-01-02T00:00:00.000Z' } },
  runs: { willhaben: { ok: true, count: 1, at: '2026-01-02T00:00:00.000Z', ms: 10 } },
  initialRunAt: { willhaben: '2026-01-01T00:00:00.000Z' },
  lastRun: '2026-01-02T00:00:00.000Z',
}));

const db = await import('../src/db.js');
const { adoptLegacyPrefs, DEFAULT_PREFS, loadPrefs } = await import('../src/prefs.js');

const prefs = { ...DEFAULT_PREFS, states: ['wien'], types: ['apartment'] };
const ids = (p = prefs) => db.queryListings(p).map((l) => l.id).sort();
const scrape = (at, results) => db.saveScrape({ startedAt: at, results, scope: {} });

after(() => {
  db.closeDb();
  rmSync(dir, { recursive: true, force: true });
});

test('imports legacy JSON files once and renames them', () => {
  assert.deepEqual(ids(), ['willhaben:old']);
  assert.equal(db.queryListings(prefs)[0].firstSeen, '2026-01-01T00:00:00.000Z');
  assert.equal(db.getMeta('prefs').maxPrice, 1200);
  adoptLegacyPrefs('first-user');
  assert.equal(loadPrefs('first-user').maxPrice, 1200);
  assert.deepEqual(loadPrefs('first-user').states, ['wien']);
  assert.equal(db.getMeta('prefs'), null);
  assert.equal(db.getMeta('last_run'), '2026-01-02T00:00:00.000Z');
  assert.ok(existsSync(join(dir, 'store.json.migrated')));
  assert.ok(!existsSync(join(dir, 'store.json')));
});

test('listings missing from a full scrape are marked removed and come back with their first-seen date', () => {
  scrape('2026-02-01T00:00:00.000Z', [{ key: 'willhaben', listings: [listing('a')], ms: 1 }]);
  assert.deepEqual(ids(), ['willhaben:a']);

  scrape('2026-02-02T00:00:00.000Z', [{ key: 'willhaben', listings: [listing('a'), listing('old')], ms: 1 }]);
  assert.deepEqual(ids(), ['willhaben:a', 'willhaben:old']);
  assert.equal(db.queryListings(prefs).find((l) => l.id === 'willhaben:old').firstSeen, '2026-01-01T00:00:00.000Z');
});

test('a partial or failed scrape does not remove listings', () => {
  scrape('2026-02-03T00:00:00.000Z', [{ key: 'willhaben', listings: [listing('a')], partial: true, ms: 1 }]);
  assert.deepEqual(ids(), ['willhaben:a', 'willhaben:old']);

  scrape('2026-02-04T00:00:00.000Z', [{ key: 'willhaben', error: 'fetch failed', ms: 1 }]);
  assert.deepEqual(ids(), ['willhaben:a', 'willhaben:old']);
  assert.equal(db.getRuns().willhaben.ok, false);
  assert.equal(db.getRuns().willhaben.count, 1);
});

test('records a price history entry only when the price changes', () => {
  scrape('2026-02-05T00:00:00.000Z', [{ key: 'willhaben', listings: [listing('a', { price: 850 }), listing('old')], ms: 1 }]);
  scrape('2026-02-06T00:00:00.000Z', [{ key: 'willhaben', listings: [listing('a', { price: 850 }), listing('old')], ms: 1 }]);
  assert.deepEqual(db.getPriceHistory('willhaben:a').map((h) => h.price), [900, 850]);
});

test('filters by range, district and type in SQL, keeping listings with unknown values', () => {
  scrape('2026-02-07T00:00:00.000Z', [{
    key: 'willhaben',
    listings: [
      listing('cheap', { price: 600, district: 2 }),
      listing('pricey', { price: 1400, district: 10 }),
      listing('unknown', { price: null, district: 10 }),
      listing('house', { type: 'house', price: 700, district: 10 }),
    ],
    ms: 1,
  }]);
  assert.deepEqual(ids({ ...prefs, maxPrice: 1000 }), ['willhaben:cheap', 'willhaben:unknown']);
  assert.deepEqual(ids({ ...prefs, districts: [10] }), ['willhaben:pricey', 'willhaben:unknown']);
  assert.deepEqual(ids({ ...prefs, types: ['house'] }), ['willhaben:house']);
});

test('filters by state, and districts only narrow Vienna', () => {
  scrape('2026-02-08T00:00:00.000Z', [{
    key: 'willhaben',
    listings: [
      listing('fav', { district: 10 }),
      listing('leo', { district: 2, postcode: '1020' }),
      listing('graz', { state: 'steiermark', district: null, postcode: '8010' }),
    ],
    ms: 1,
  }]);
  const all = { ...prefs, states: [] };
  assert.deepEqual(ids(all), ['willhaben:fav', 'willhaben:graz', 'willhaben:leo']);
  assert.deepEqual(ids({ ...all, states: ['steiermark'] }), ['willhaben:graz']);
  assert.deepEqual(ids({ ...all, states: ['wien', 'steiermark'], districts: [10] }), ['willhaben:fav', 'willhaben:graz']);
});
