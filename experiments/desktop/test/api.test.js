import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../src/core/db.js';
import { dispatch } from '../src/core/api.js';
import { SOURCES, onScanChange, scanStatus } from '../src/core/scan.js';

db.openDb(':memory:');
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
  const { search, scanning } = await dispatch('saveSearch', { name: 'Wien 3', prefs: { states: ['wien'], sources: ['willhaben'] } });
  assert.equal(scanning, true);
  await idle();
  const view = await dispatch('listings', { id: search.id });
  assert.equal(view.groups.length, 1);
  assert.equal(view.runs.willhaben.count, 1);
  const [summary] = await dispatch('searches');
  assert.equal(summary.listingCount, 1);
  assert.ok(summary.lastScanAt);
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
  await assert.rejects(dispatch('setSetting', { key: 'toString', value: 1 }), /invalid setting/);
  await assert.rejects(dispatch('favorites', { add: ['nope'] }), /invalid listing ids/);
  await assert.rejects(dispatch('constructor'), /unknown method/);
});

test('deleting a search removes it', async () => {
  const [search] = await dispatch('searches');
  const { searches } = await dispatch('deleteSearch', { id: search.id });
  assert.deepEqual(searches, []);
  assert.deepEqual((await dispatch('listings', { id: search.id })).groups, []);
});
