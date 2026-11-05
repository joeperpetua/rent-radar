import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../src/core/db.js';
import { DEFAULT_PREFS, needsRescan, sanitizePrefs, scrapeScope } from '../src/core/prefs.js';
import { buildView } from '../src/core/scan.js';

db.openDb(':memory:');
after(() => db.closeDb());

const listing = (id, fields = {}) => ({
  id: `willhaben:${id}`, source: 'willhaben', type: 'apartment', title: `Wohnung ${id}`,
  price: 900, area: 65, rooms: 2, state: 'wien', district: 10, postcode: '1100', images: [], extras: [], ...fields,
});
const prefs = { ...DEFAULT_PREFS, states: ['wien'], types: ['apartment'] };
const vienna = db.createSearch('Wien', prefs);
const graz = db.createSearch('Graz', { ...prefs, states: ['steiermark'] });
const ids = (search, p = prefs) => db.queryListings(search.id, p).map((l) => l.id).sort();
const scan = (search, at, results) => db.saveScan({ searchId: search.id, startedAt: at, results, scope: scrapeScope(search.prefs) });

test('each search keeps its own result set', () => {
  scan(vienna, '2026-02-01T00:00:00.000Z', [{ key: 'willhaben', listings: [listing('a'), listing('shared')], ms: 1 }]);
  scan(graz, '2026-02-01T01:00:00.000Z', [{ key: 'willhaben', listings: [listing('shared'), listing('g', { state: 'steiermark', district: null })], ms: 1 }]);
  assert.deepEqual(ids(vienna), ['willhaben:a', 'willhaben:shared']);
  assert.deepEqual(ids(graz, { ...prefs, states: [] }), ['willhaben:g', 'willhaben:shared']);
  assert.equal(db.getSearch(vienna.id).listingCount, 2);
  assert.equal(db.getSearch(vienna.id).lastScanAt, '2026-02-01T00:00:00.000Z');
});

test('listings missing from a full scan are removed only from that search and return with their first-seen date', () => {
  scan(vienna, '2026-02-02T00:00:00.000Z', [{ key: 'willhaben', listings: [listing('a')], ms: 1 }]);
  assert.deepEqual(ids(vienna), ['willhaben:a']);
  assert.deepEqual(ids(graz, { ...prefs, states: [] }), ['willhaben:g', 'willhaben:shared']);

  scan(vienna, '2026-02-03T00:00:00.000Z', [{ key: 'willhaben', listings: [listing('a'), listing('shared')], ms: 1 }]);
  assert.equal(db.queryListings(vienna.id, prefs).find((l) => l.id === 'willhaben:shared').firstSeen, '2026-02-01T00:00:00.000Z');
});

test('a partial or failed scan does not remove listings, and keeps the last good count', () => {
  scan(vienna, '2026-02-04T00:00:00.000Z', [{ key: 'willhaben', listings: [listing('a')], partial: true, ms: 1 }]);
  assert.deepEqual(ids(vienna), ['willhaben:a', 'willhaben:shared']);

  scan(vienna, '2026-02-05T00:00:00.000Z', [{ key: 'willhaben', error: 'fetch failed', ms: 1 }]);
  assert.deepEqual(ids(vienna), ['willhaben:a', 'willhaben:shared']);
  const run = db.getRuns(vienna.id).willhaben;
  assert.equal(run.ok, false);
  assert.equal(run.error, 'fetch failed');
  assert.equal(run.count, 1);
});

test('records a price history entry only when the price changes and reports it in the view', () => {
  scan(vienna, '2026-02-06T00:00:00.000Z', [{ key: 'willhaben', listings: [listing('a', { price: 850 }), listing('shared')], ms: 1 }]);
  scan(vienna, '2026-02-07T00:00:00.000Z', [{ key: 'willhaben', listings: [listing('a', { price: 850 }), listing('shared')], ms: 1 }]);
  assert.deepEqual(db.getPriceHistory('willhaben:a').map((h) => h.price), [900, 850]);
  const group = buildView(db.getSearch(vienna.id)).groups.find((g) => g.sources.some((s) => s.id === 'willhaben:a'));
  assert.equal(group.priceChange.delta, -50);
});

test('marks listings found after the first scan as new', () => {
  const fresh = new Date().toISOString();
  scan(vienna, fresh, [{ key: 'willhaben', listings: [listing('a', { price: 850 }), listing('shared'), listing('brandnew', { title: 'Dachterrasse' })], ms: 1 }]);
  const view = buildView(db.getSearch(vienna.id));
  assert.equal(view.groups.find((g) => g.sources.some((s) => s.id === 'willhaben:brandnew')).isNew, true);
  assert.equal(view.groups.find((g) => g.sources.some((s) => s.id === 'willhaben:a')).isNew, false);
});

test('deleting a search drops its results and purges listings no other search holds', () => {
  db.deleteSearch(graz.id);
  assert.equal(db.getSearch(graz.id), null);
  assert.deepEqual(db.getStoredListings('willhaben').has('willhaben:g'), false);
  assert.deepEqual(db.getStoredListings('willhaben').has('willhaben:shared'), true);
});

test('favorites and settings persist', () => {
  assert.deepEqual(db.updateFavorites({ add: ['willhaben:a', 'willhaben:b'] }), ['willhaben:a', 'willhaben:b']);
  assert.deepEqual(db.updateFavorites({ remove: ['willhaben:a'] }), ['willhaben:b']);
  db.setSetting('locale', 'en');
  assert.equal(db.getSetting('locale'), 'en');
});

test('only widening a scan-relevant filter needs a rescan', () => {
  const scope = scrapeScope(sanitizePrefs({ states: ['wien'], maxPrice: 1200, types: ['apartment'] }));
  assert.equal(needsRescan(sanitizePrefs({ states: ['wien'], maxPrice: 1000, types: ['apartment'] }), scope), false);
  assert.equal(needsRescan(sanitizePrefs({ states: ['wien'], maxPrice: 1500, types: ['apartment'] }), scope), true);
  assert.equal(needsRescan(sanitizePrefs({ states: ['wien', 'tirol'], maxPrice: 1000, types: ['apartment'] }), scope), true);
  assert.equal(needsRescan(sanitizePrefs({ states: ['wien'], districts: [2], categories: ['regular'], maxPrice: 1000, types: ['apartment'] }), scope), false);
  assert.equal(needsRescan(sanitizePrefs({}), null), true);
});
