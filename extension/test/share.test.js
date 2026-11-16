import 'fake-indexeddb/auto';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../src/core/db.js';
import { dispatch } from '../src/core/api.js';
import { InvalidShare, decodeShare, encodeShare, shareUrl } from '../src/core/share.js';
import { DEFAULT_PREFS, fillUnspecified, scrapeScope } from '../src/core/prefs.js';
import * as landing from '../landing/share.js';

const listing = (id, fields = {}) => ({
  id: `${fields.source ?? 'willhaben'}:${id}`, source: 'willhaben', type: 'apartment', title: `Helle Wohnung ${id}`, url: `https://www.example.at/${id}`,
  price: 900, area: 65, rooms: 2, state: 'wien', district: 7, postcode: '1070', city: 'Wien', description: 'Altbau, ruhig gelegen. '.repeat(40),
  images: ['https://cache.willhaben.at/a.jpg', 'https://cache.willhaben.at/b.jpg'], extras: ['BALCONY'], ...fields,
});
const prefs = fillUnspecified({ ...DEFAULT_PREFS, states: ['wien'], types: ['apartment'], sources: ['willhaben', 'immoscout'] });

await db.openDb('share-test');
after(() => db.closeDb());
const search = await db.createSearch('Wien', prefs);
await db.saveScan({ searchId: search.id, startedAt: '2026-04-01T00:00:00.000Z', results: [{ key: 'willhaben', listings: [listing('a')], ms: 1 }], scope: scrapeScope(prefs) });
await db.saveScan({ searchId: search.id, startedAt: '2026-04-03T00:00:00.000Z', results: [
  { key: 'willhaben', listings: [listing('a', { price: 850 })], ms: 1 },
  { key: 'immoscout', listings: [listing('b', { source: 'immoscout', price: 870, images: [] })], ms: 1 },
], scope: scrapeScope(prefs) });

const snapshot = await dispatch('shareListing', { ids: ['willhaben:a', 'immoscout:b'] });
const payload = await encodeShare(snapshot);

test('a share link carries every merged listing with its price history in a URL-safe fragment', async () => {
  assert.equal(snapshot.v, 1);
  assert.deepEqual(snapshot.listings.map((l) => l.data.id), ['willhaben:a', 'immoscout:b']);
  assert.deepEqual(snapshot.listings[0].prices.map((p) => p.price), [900, 850]);
  assert.match(payload, /^[A-Za-z0-9_-]+$/);
  assert.ok(payload.length < JSON.stringify(snapshot).length / 2);
  assert.equal(shareUrl(payload), `https://joeperpetua.github.io/rent-radar/#l=${payload}`);
  assert.deepEqual(await decodeShare(payload), snapshot);
});

test('the recipient gets one group with the shared detail data', async () => {
  const { group } = await dispatch('sharedGroup', await decodeShare(payload));
  assert.equal(group.title, 'Helle Wohnung a');
  assert.equal(group.price, 850);
  assert.equal(group.priceMin, 850);
  assert.equal(group.priceMax, 870);
  assert.deepEqual(group.sources.map((s) => s.id), ['willhaben:a', 'immoscout:b']);
  assert.deepEqual(group.sources[0].priceHistory.map((p) => p.price), [900, 850]);
  assert.equal(group.priceChange.delta, -50);
  assert.ok(group.description.startsWith('Altbau'));
  assert.deepEqual(group.categories, ['regular']);
});

test('broken or hostile links are rejected', async () => {
  await assert.rejects(decodeShare('not base64!'), InvalidShare);
  await assert.rejects(decodeShare(payload.slice(0, 40)), InvalidShare);
  await assert.rejects(dispatch('sharedGroup', { v: 2, listings: snapshot.listings }), /invalid share link/);
  await assert.rejects(dispatch('sharedGroup', { v: 1, listings: [] }), /invalid share link/);
  const hostile = structuredClone(snapshot);
  hostile.listings[1].data.url = 'javascript:alert(1)';
  await assert.rejects(dispatch('sharedGroup', hostile), /invalid share link/);
  await assert.rejects(dispatch('shareListing', { ids: ['willhaben:missing'] }), /listing not found/);
});

test('the landing page reads the link and builds a teaser', async () => {
  assert.equal(landing.sharedPayload(`#l=${payload}`), payload);
  assert.equal(landing.sharedPayload('#other'), null);
  const decoded = await landing.decodeShare(payload);
  assert.deepEqual(decoded, snapshot);
  assert.deepEqual(landing.teaser(decoded), {
    title: 'Helle Wohnung a', price: 850, area: 65, rooms: 2, place: '1070 Wien', photo: 'https://cache.willhaben.at/a.jpg',
  });
  assert.equal(landing.teaser({ listings: [{ data: { title: 'x', images: ['javascript:x'] } }] }).photo, null);
  assert.equal(landing.teaser({}), null);
});
