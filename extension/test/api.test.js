import 'fake-indexeddb/auto';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../src/core/db.js';
import { dispatch } from '../src/core/api.js';
import { SOURCES, onScanChange, scanStatus } from '../src/core/scan.js';

await db.openDb('api-test');
after(() => db.closeDb());

const flat = (id, price = 900) => ({
  id: `willhaben:${id}`, source: 'willhaben', type: 'apartment', title: `Wohnung ${id}`,
  price, area: 60, rooms: 2, state: 'wien', district: 3, postcode: '1030', images: [], extras: [],
});

for (const key of Object.keys(SOURCES)) SOURCES[key] = { ...SOURCES[key], search: async () => [flat('x')] };

const idle = () => new Promise((resolve) => {
  if (scanStatus().running == null && !scanStatus().queue.length) return resolve();
  const off = onScanChange(() => {
    if (scanStatus().running == null && !scanStatus().queue.length) { off(); resolve(); }
  });
});

test('creating a search scans it and stores its results', async () => {
  const incomplete = { states: ['wien'], sources: ['willhaben'] };
  await assert.rejects(dispatch('saveSearch', { name: 'Wien 3', prefs: incomplete }), /pick at least one of: types, categories, districts/);
  const prefs = { ...incomplete, types: ['apartment'], categories: ['regular'], districts: [3] };
  const { search, scanning } = await dispatch('saveSearch', { name: 'Wien 3', prefs });
  assert.equal(scanning, true);
  await idle();
  const view = await dispatch('listings', { id: search.id });
  assert.equal(view.groups.length, 1);
  assert.equal(view.runs.willhaben.count, 1);
  const [summary] = await dispatch('searches');
  assert.equal(summary.listingCount, 1);
  assert.ok(summary.lastScanAt);
});

test('a search with every state ticked scans all of Austria and stores its results', async () => {
  const everything = (await dispatch('config')).states.map((s) => s.id);
  const prefs = { states: everything, districts: Array.from({ length: 23 }, (_, i) => i + 1), types: ['apartment'], categories: ['regular'], sources: ['willhaben'] };
  const { search } = await dispatch('saveSearch', { name: 'Österreich', prefs });
  await idle();
  const view = await dispatch('listings', { id: search.id });
  assert.equal(view.runs.willhaben.ok, true);
  assert.equal(view.groups.length, 1);
  assert.equal((await dispatch('searches')).find((s) => s.id === search.id).scanScope.states, null);
  await dispatch('deleteSearch', { id: search.id });
});

test('narrowing a search does not rescan; widening does', async () => {
  const [search] = await dispatch('searches');
  const narrowed = await dispatch('saveSearch', { id: search.id, name: search.name, prefs: { ...search.prefs, maxPrice: 1000 } });
  assert.equal(narrowed.scanning, false);
  const widened = await dispatch('saveSearch', { id: search.id, name: search.name, prefs: { ...search.prefs, maxPrice: 1000, states: ['wien', 'tirol'] } });
  assert.equal(widened.scanning, true);
  await idle();
});

test('rejects bad input', async () => {
  await assert.rejects(dispatch('saveSearch', { name: '  ', prefs: {} }), /name required/);
  await assert.rejects(dispatch('setSetting', { key: 'locale', value: 'fr' }), /invalid setting/);
  await assert.rejects(dispatch('setSetting', { key: 'style', value: 'soft' }), /invalid setting/);
  await assert.rejects(dispatch('setSetting', { key: 'theme', value: 'sepia' }), /invalid setting/);
  await assert.rejects(dispatch('setSetting', { key: 'toString', value: 1 }), /invalid setting/);
  await assert.rejects(dispatch('favorites', { add: ['nope'] }), /invalid listing ids/);
  await assert.rejects(dispatch('constructor'), /unknown method/);
});

test('the chosen style and theme are saved and returned with the config', async () => {
  const before = (await dispatch('config')).settings;
  assert.equal(before.style, 'styled');
  assert.equal(before.theme, 'system');
  await dispatch('setSetting', { key: 'style', value: 'compact' });
  await dispatch('setSetting', { key: 'theme', value: 'dark' });
  const after = (await dispatch('config')).settings;
  assert.equal(after.style, 'compact');
  assert.equal(after.theme, 'dark');
});

test('fetchDetail fetches and stores updated description for a listing', async () => {
  SOURCES.willhaben.fetchDetails = async () => ({ description: 'Full fetched description' });
  const res = await dispatch('fetchDetail', { id: 'willhaben:x' });
  assert.equal(res.description, 'Full fetched description');
  const stored = await db.getListing('willhaben:x');
  assert.equal(stored.description, 'Full fetched description');
  assert.ok(stored.detailsAt);
});

test('deleting a search removes it', async () => {
  const [search] = await dispatch('searches');
  const { searches } = await dispatch('deleteSearch', { id: search.id });
  assert.deepEqual(searches, []);
  assert.deepEqual((await dispatch('listings', { id: search.id })).groups, []);
});
