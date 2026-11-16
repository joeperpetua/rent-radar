import 'fake-indexeddb/auto';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../src/core/db.js';
import { dispatch } from '../src/core/api.js';
import { InvalidBackupFile, decodeBackup, encodeBackup } from '../src/core/backupFile.js';
import { DEFAULT_PREFS, fillUnspecified, scrapeScope, withAllDistricts } from '../src/core/prefs.js';

const listing = (id, fields = {}) => ({
  id: `willhaben:${id}`, source: 'willhaben', type: 'apartment', title: `Wohnung ${id}`, url: `https://www.willhaben.at/${id}`,
  price: 900, area: 65, rooms: 2, state: 'wien', district: 10, postcode: '1100', images: ['https://cache.willhaben.at/a.jpg'], extras: [], ...fields,
});
const prefs = fillUnspecified({ ...DEFAULT_PREFS, states: ['wien'], types: ['apartment'], sources: ['willhaben'] });

await db.openDb('backup-source');
const wien = await db.createSearch('Wien', prefs);
await db.createSearch('Wien teuer', { ...prefs, maxPrice: 2000 });
await db.saveScan({ searchId: wien.id, startedAt: '2026-03-01T00:00:00.000Z', results: [{ key: 'willhaben', listings: [listing('a'), listing('b')], ms: 1 }], scope: scrapeScope(prefs) });
await db.saveScan({ searchId: wien.id, startedAt: '2026-03-02T00:00:00.000Z', results: [{ key: 'willhaben', listings: [listing('a', { price: 850 }), listing('b')], ms: 1 }], scope: scrapeScope(prefs) });
await db.updateFavorites({ add: ['willhaben:a'] });
await db.setSetting('locale', 'en');
await db.setSetting('style', 'compact');
await db.setSetting('activeSearchId', wien.id);
const backup = JSON.parse(JSON.stringify(await dispatch('exportBackup')));
db.closeDb();

await db.openDb('backup-target');
after(() => db.closeDb());

test('the export holds settings, searches and favourite listings with their price history', () => {
  assert.equal(backup.app, 'rentradar');
  assert.equal(backup.format, 1);
  assert.deepEqual(backup.settings, { locale: 'en', style: 'compact' });
  assert.deepEqual(backup.searches.map((s) => s.name), ['Wien', 'Wien teuer']);
  assert.equal(backup.favorites.length, 1);
  const [fav] = backup.favorites;
  assert.equal(fav.listingId, 'willhaben:a');
  assert.deepEqual(fav.listing.prices.map((p) => p.price), [900, 850]);
  assert.deepEqual(fav.searches.map((m) => m.searchId), [wien.id]);
});

test('importing into an empty profile restores settings, searches and favourites', async () => {
  const result = await dispatch('importBackup', backup);
  assert.deepEqual(result.added, { searches: 2, favorites: 1 });
  assert.deepEqual(result.skipped, { searches: 0, favorites: 0 });
  assert.equal(result.settings.locale, 'en');
  assert.equal(result.settings.style, 'compact');
  assert.equal(await db.getSetting('activeSearchId'), null);
  assert.deepEqual(result.favorites, ['willhaben:a']);
  const restored = result.searches.find((s) => s.name === 'Wien');
  assert.deepEqual(restored.prefs, prefs);
  assert.equal(restored.listingCount, 1);
  const view = await dispatch('listings', { id: restored.id });
  assert.deepEqual(view.groups.map((g) => g.id), ['willhaben:a']);
  assert.deepEqual((await db.getPriceHistory('willhaben:a')).map((p) => p.price), [900, 850]);
});

test('importing the same backup again adds nothing', async () => {
  const result = await dispatch('importBackup', backup);
  assert.deepEqual(result.added, { searches: 0, favorites: 0 });
  assert.equal(result.searches.length, 2);
});

test('invalid entries are skipped and invalid files rejected', async () => {
  await assert.rejects(dispatch('importBackup', { app: 'other', format: 1 }), /not a RentRadar backup/);
  await assert.rejects(dispatch('importBackup', { app: 'rentradar', format: 99 }), /unsupported backup format/);
  const bad = {
    app: 'rentradar',
    format: 1,
    settings: { style: 'neon', theme: 'dark', toString: 1 },
    searches: [{ id: 50, name: '  ', prefs }, { id: 51, name: 'Leer', prefs: {} }, { id: 52, name: 'Graz', prefs: withAllDistricts({ ...prefs, states: ['steiermark'], districts: [] }) }],
    favorites: [
      { listingId: 'nope', searches: [] },
      { listingId: 'willhaben:x', listing: { data: listing('x', { url: 'javascript:alert(1)' }) }, searches: [{ searchId: 52 }] },
      { listingId: 'willhaben:y', listing: { data: listing('y', { images: ['javascript:x', 'https://cache.willhaben.at/y.jpg'] }) }, searches: [{ searchId: 52 }] },
    ],
  };
  const result = await dispatch('importBackup', bad);
  assert.equal(result.settings.theme, 'dark');
  assert.equal(result.settings.style, 'compact');
  assert.deepEqual(result.skipped, { searches: 2, favorites: 2 });
  assert.equal(result.searches.find((s) => s.name === 'Graz').listingCount, 1);
  assert.deepEqual((await db.getListing('willhaben:y')).images, ['https://cache.willhaben.at/y.jpg']);
  assert.equal(await db.getListing('willhaben:x'), null);
});

test('the backup file is compressed and encrypted and decodes back to the same data', async () => {
  const bytes = new Uint8Array(await (await encodeBackup(backup)).arrayBuffer());
  const text = new TextDecoder().decode(bytes);
  assert.equal(new TextDecoder().decode(bytes.subarray(0, 3)), 'RRB');
  assert.ok(!text.includes('rentradar') && !text.includes('willhaben'));
  assert.deepEqual(await decodeBackup(bytes), backup);
  const again = new Uint8Array(await (await encodeBackup(backup)).arrayBuffer());
  assert.notDeepEqual(again, bytes);
});

test('damaged or foreign files are rejected', async () => {
  const bytes = new Uint8Array(await (await encodeBackup(backup)).arrayBuffer());
  const tampered = bytes.slice();
  tampered[tampered.length - 1] ^= 1;
  await assert.rejects(decodeBackup(tampered), InvalidBackupFile);
  await assert.rejects(decodeBackup(bytes.subarray(0, 10)), InvalidBackupFile);
  await assert.rejects(decodeBackup(new TextEncoder().encode(JSON.stringify(backup))), InvalidBackupFile);
});
