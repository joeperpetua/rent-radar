import 'fake-indexeddb/auto';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../src/core/db.js';
import { DEFAULT_PREFS, effectivePrefs, fillUnspecified, needsRescan, sanitizePrefs, scrapeScope } from '../src/core/prefs.js';
import { buildView } from '../src/core/scan.js';

await db.openDb('db-test');
after(() => db.closeDb());

const listing = (id, fields = {}) => ({
  id: `willhaben:${id}`, source: 'willhaben', type: 'apartment', title: `Wohnung ${id}`,
  price: 900, area: 65, rooms: 2, state: 'wien', district: 10, postcode: '1100', images: [], extras: [], ...fields,
});
const prefs = fillUnspecified({ ...DEFAULT_PREFS, states: ['wien'], types: ['apartment'] });
const everywhere = fillUnspecified({ ...prefs, states: [] });
const vienna = await db.createSearch('Wien', prefs);
const graz = await db.createSearch('Graz', { ...prefs, states: ['steiermark'] });
const ids = async (search, p = prefs) => (await db.queryListings(search.id, effectivePrefs(p))).map((l) => l.id).sort();
const scan = (search, at, results) => db.saveScan({ searchId: search.id, startedAt: at, results, scope: scrapeScope(search.prefs) });

test('each search keeps its own result set', async () => {
  await scan(vienna, '2026-02-01T00:00:00.000Z', [{ key: 'willhaben', listings: [listing('a'), listing('shared')], ms: 1 }]);
  await scan(graz, '2026-02-01T01:00:00.000Z', [{ key: 'willhaben', listings: [listing('shared'), listing('g', { state: 'steiermark', district: null })], ms: 1 }]);
  assert.deepEqual(await ids(vienna), ['willhaben:a', 'willhaben:shared']);
  assert.deepEqual(await ids(graz, everywhere), ['willhaben:g', 'willhaben:shared']);
  assert.equal((await db.getSearch(vienna.id)).listingCount, 2);
  assert.equal((await db.getSearch(vienna.id)).lastScanAt, '2026-02-01T00:00:00.000Z');
});

test('listings missing from a full scan are removed only from that search and return with their first-seen date', async () => {
  await scan(vienna, '2026-02-02T00:00:00.000Z', [{ key: 'willhaben', listings: [listing('a')], ms: 1 }]);
  assert.deepEqual(await ids(vienna), ['willhaben:a']);
  assert.deepEqual(await ids(graz, everywhere), ['willhaben:g', 'willhaben:shared']);

  await scan(vienna, '2026-02-03T00:00:00.000Z', [{ key: 'willhaben', listings: [listing('a'), listing('shared')], ms: 1 }]);
  assert.equal((await db.queryListings(vienna.id, effectivePrefs(prefs))).find((l) => l.id === 'willhaben:shared').firstSeen, '2026-02-01T00:00:00.000Z');
});

test('a partial or failed scan does not remove listings, and keeps the last good count', async () => {
  await scan(vienna, '2026-02-04T00:00:00.000Z', [{ key: 'willhaben', listings: [listing('a')], partial: true, ms: 1 }]);
  assert.deepEqual(await ids(vienna), ['willhaben:a', 'willhaben:shared']);

  await scan(vienna, '2026-02-05T00:00:00.000Z', [{ key: 'willhaben', error: 'fetch failed', ms: 1 }]);
  assert.deepEqual(await ids(vienna), ['willhaben:a', 'willhaben:shared']);
  const run = (await db.getRuns(vienna.id)).willhaben;
  assert.equal(run.ok, false);
  assert.equal(run.error, 'fetch failed');
  assert.equal(run.count, 1);
});

test('records a price history entry only when the price changes and reports it in the view', async () => {
  await scan(vienna, '2026-02-06T00:00:00.000Z', [{ key: 'willhaben', listings: [listing('a', { price: 850 }), listing('shared')], ms: 1 }]);
  await scan(vienna, '2026-02-07T00:00:00.000Z', [{ key: 'willhaben', listings: [listing('a', { price: 850 }), listing('shared')], ms: 1 }]);
  assert.deepEqual((await db.getPriceHistory('willhaben:a')).map((h) => h.price), [900, 850]);
  const group = (await buildView(await db.getSearch(vienna.id))).groups.find((g) => g.sources.some((s) => s.id === 'willhaben:a'));
  assert.equal(group.priceChange.delta, -50);
});

test('marks listings found after the first scan as new', async () => {
  const fresh = new Date().toISOString();
  await scan(vienna, fresh, [{ key: 'willhaben', listings: [listing('a', { price: 850 }), listing('shared'), listing('brandnew', { title: 'Dachterrasse' })], ms: 1 }]);
  const view = await buildView(await db.getSearch(vienna.id));
  assert.equal(view.groups.find((g) => g.sources.some((s) => s.id === 'willhaben:brandnew')).isNew, true);
  assert.equal(view.groups.find((g) => g.sources.some((s) => s.id === 'willhaben:a')).isNew, false);
});

test('filters are literal: nothing ticked matches nothing, everything ticked matches everything', async () => {
  assert.deepEqual(await ids(vienna, everywhere), ['willhaben:a', 'willhaben:brandnew', 'willhaben:shared']);
  assert.deepEqual(await ids(vienna, { ...DEFAULT_PREFS, sources: [] }), []);
  assert.deepEqual(await ids(vienna, { ...everywhere, sources: ['rentola'] }), []);
  assert.deepEqual(await ids(vienna, { ...everywhere, districts: [10] }), ['willhaben:a', 'willhaben:brandnew', 'willhaben:shared']);
  assert.deepEqual(await ids(vienna, { ...everywhere, districts: [3] }), []);
});

test('deleting a search removes its preferences but keeps the listings', async () => {
  await db.deleteSearch(graz.id);
  assert.equal(await db.getSearch(graz.id), null);
  assert.equal((await db.listSearches()).some((s) => s.id === graz.id), false);
  assert.equal((await db.getStoredListings('willhaben')).has('willhaben:g'), true);
  assert.equal((await db.getStoredListings('willhaben')).has('willhaben:shared'), true);
});

test('favorites and settings persist', async () => {
  assert.deepEqual(await db.updateFavorites({ add: ['willhaben:a', 'willhaben:b'] }), ['willhaben:a', 'willhaben:b']);
  assert.deepEqual(await db.updateFavorites({ remove: ['willhaben:a'] }), ['willhaben:b']);
  await db.setSetting('locale', 'en');
  assert.equal(await db.getSetting('locale'), 'en');
});

test('only widening a scan-relevant filter needs a rescan', async () => {
  const scope = scrapeScope(sanitizePrefs({ states: ['wien'], maxPrice: 1200, types: ['apartment'] }));
  assert.equal(needsRescan(sanitizePrefs({ states: ['wien'], maxPrice: 1000, types: ['apartment'] }), scope), false);
  assert.equal(needsRescan(sanitizePrefs({ states: ['wien'], maxPrice: 1500, types: ['apartment'] }), scope), true);
  assert.equal(needsRescan(sanitizePrefs({ states: ['wien', 'tirol'], maxPrice: 1000, types: ['apartment'] }), scope), true);
  assert.equal(needsRescan(sanitizePrefs({ states: ['wien'], districts: [2], categories: ['regular'], maxPrice: 1000, types: ['apartment'] }), scope), false);
  assert.equal(needsRescan(sanitizePrefs({}), null), true);
});
