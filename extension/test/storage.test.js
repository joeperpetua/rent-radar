import 'fake-indexeddb/auto';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../src/core/db.js';
import { DEFAULT_PREFS, effectivePrefs, fillUnspecified, scrapeScope } from '../src/core/prefs.js';

await db.openDb('storage-test');
after(() => db.closeDb());

const listing = (source, id) => ({
  id: `${source}:${id}`, source, type: 'apartment', title: id,
  price: 900, area: 65, rooms: 2, state: 'wien', district: 10, postcode: '1100', images: [], extras: [],
});
const prefs = fillUnspecified({ ...DEFAULT_PREFS, states: ['wien'], types: ['apartment'], sources: ['willhaben', 'immoscout'] });
const scan = (search, at, results) => db.saveScan({ searchId: search.id, startedAt: at, results, scope: scrapeScope(search.prefs) });
const ids = async (search) => (await db.queryListings(search.id, effectivePrefs(search.prefs))).map((l) => l.id).sort();

const kept = await db.createSearch('Kept', prefs);
const dropped = await db.createSearch('Dropped', prefs);

await scan(kept, '2026-03-01T00:00:00.000Z', [
  { key: 'willhaben', listings: [listing('willhaben', 'live'), listing('willhaben', 'gone')], ms: 1 },
  { key: 'immoscout', listings: [listing('immoscout', 'deselected')], ms: 1 },
]);
await scan(kept, '2026-03-02T00:00:00.000Z', [{ key: 'willhaben', listings: [listing('willhaben', 'live')], ms: 1 }]);
await scan(dropped, '2026-03-02T01:00:00.000Z', [{ key: 'willhaben', listings: [listing('willhaben', 'orphan'), listing('willhaben', 'live')], ms: 1 }]);
await db.updateSearch(kept.id, kept.name, { ...prefs, sources: ['willhaben'] });
await db.deleteSearch(dropped.id);
await db.updateFavorites({ add: ['willhaben:gone'] });

test('reports listings that pruning would remove', async () => {
  assert.deepEqual(await db.storageInfo(), { listings: 4, prunable: 3 });
});

test('pruning drops gone, deselected and deleted-search listings but keeps live ones', async () => {
  const version = await db.dataVersion();
  assert.equal(await db.pruneListings(), 3);
  assert.deepEqual(await ids(await db.getSearch(kept.id)), ['willhaben:live']);
  assert.equal(await db.getListing('willhaben:gone'), null);
  assert.equal(await db.getListing('willhaben:orphan'), null);
  assert.equal(await db.getListing('immoscout:deselected'), null);
  assert.deepEqual(await db.storageInfo(), { listings: 1, prunable: 0 });
  assert.ok((await db.dataVersion()) > version);
  assert.equal((await db.getSearch(kept.id)).lastScanAt, '2026-03-02T00:00:00.000Z');
});

test('clearing removes every listing and scan but keeps searches, settings and favorites', async () => {
  await db.setSetting('locale', 'en');
  await db.putGroupCache(kept.id, { groups: [] });
  assert.equal(await db.clearListings(), 1);
  assert.deepEqual(await db.storageInfo(), { listings: 0, prunable: 0 });
  const search = await db.getSearch(kept.id);
  assert.equal(search.name, 'Kept');
  assert.deepEqual(search.prefs.sources, ['willhaben']);
  assert.equal(search.lastScanAt, null);
  assert.equal(search.scanScope, null);
  assert.equal(search.listingCount, 0);
  assert.equal(await db.getSetting('locale'), 'en');
  assert.deepEqual(await db.getFavorites(), ['willhaben:gone']);
  assert.equal(await db.getGroupCache(kept.id), null);
});
