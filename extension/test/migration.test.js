import 'fake-indexeddb/auto';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../src/core/db.js';
import { DEFAULT_PREFS } from '../src/core/prefs.js';

after(() => db.closeDb());

const put = (store, value) => new Promise((resolve, reject) => {
  const r = store.put(value);
  r.onsuccess = resolve;
  r.onerror = () => reject(r.error);
});

const all = (idb, name) => new Promise((resolve) => {
  const r = idb.transaction(name).objectStore(name).getAll();
  r.onsuccess = () => resolve(r.result);
});

test('upgrading splits grouped sources and keeps history, membership and favourites', async () => {
  const name = 'split-test';
  await new Promise((resolve, reject) => {
    const open = indexedDB.open(name, 4);
    open.onupgradeneeded = () => {
      const idb = open.result;
      idb.createObjectStore('listings', { keyPath: 'id' }).createIndex('source', 'source');
      idb.createObjectStore('searches', { keyPath: 'id', autoIncrement: true });
      const members = idb.createObjectStore('searchListings', { keyPath: ['searchId', 'listingId'] });
      members.createIndex('searchId', 'searchId');
      members.createIndex('listingId', 'listingId');
      idb.createObjectStore('scans', { keyPath: 'id', autoIncrement: true }).createIndex('searchId', 'searchId');
      idb.createObjectStore('favorites', { keyPath: 'listingId' });
      idb.createObjectStore('settings', { keyPath: 'key' });
      idb.createObjectStore('meta', { keyPath: 'key' });
    };
    open.onsuccess = async () => {
      const idb = open.result;
      const t = idb.transaction(['listings', 'searches', 'searchListings', 'scans', 'favorites'], 'readwrite');
      await put(t.objectStore('searches'), { id: 1, name: 'old', prefs: { ...DEFAULT_PREFS, states: ['wien'], types: ['apartment'], sources: ['willhaben', 'justimmo', 'cooperatives'] } });
      await put(t.objectStore('listings'), { id: 'justimmo:novel-real.at_42', source: 'justimmo', firstSeen: '2026-10-01T00:00:00Z', prices: [{ at: '2026-10-01T00:00:00Z', price: 900 }], data: { id: 'justimmo:novel-real.at_42', source: 'justimmo', sourceId: 'novel-real.at_42', title: 'x' } });
      await put(t.objectStore('searchListings'), { searchId: 1, listingId: 'justimmo:novel-real.at_42', source: 'justimmo', firstSeen: '2026-10-01T00:00:00Z', lastSeen: '2026-11-01T00:00:00Z', removedAt: null });
      await put(t.objectStore('favorites'), { listingId: 'justimmo:novel-real.at_42', createdAt: '2026-10-02T00:00:00Z' });
      await put(t.objectStore('scans'), { searchId: 1, startedAt: '2026-11-01T00:00:00Z', sources: { justimmo: { ok: true, count: 1 }, willhaben: { ok: true, count: 3 } } });
      t.oncomplete = () => { idb.close(); resolve(); };
      t.onerror = () => reject(t.error);
    };
    open.onerror = () => reject(open.error);
  });

  const idb = await db.openDb(name);
  const [search] = await all(idb, 'searches');
  assert.deepEqual(search.prefs.sources, ['willhaben', 'immo', 'bwsg', 'oevw', 'nebau']);
  const [listing] = await all(idb, 'listings');
  assert.equal(listing.data.sourceName, 'Novel Real');
  assert.deepEqual([listing.id, listing.source, listing.data.source, listing.data.sourceId, listing.firstSeen, listing.prices.length], ['immo:novelreal:42', 'immo', 'immo', 'novelreal:42', '2026-10-01T00:00:00Z', 1]);
  const [member] = await all(idb, 'searchListings');
  assert.deepEqual([member.listingId, member.source, member.firstSeen], ['immo:novelreal:42', 'immo', '2026-10-01T00:00:00Z']);
  assert.deepEqual((await all(idb, 'favorites')).map((f) => f.listingId), ['immo:novelreal:42']);
  assert.deepEqual(Object.keys((await all(idb, 'scans'))[0].sources), ['willhaben']);
});
