import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PREFS, PROPERTY_TYPES, SOURCE_IDS, effectivePrefs, isScannable, missingGroups, needsRescan, sanitizePrefs, scrapeScope } from '../src/core/prefs.js';
import { CATEGORIES } from '../src/core/categories.js';
import { STATES } from '../src/core/geo.js';
import { closeDb, openDb } from '../src/core/db.js';

const STATE_IDS = STATES.map((s) => s.id);
const ALL_DISTRICTS = Array.from({ length: 23 }, (_, i) => i + 1);
const everything = sanitizePrefs({ states: STATE_IDS, districts: ALL_DISTRICTS, types: PROPERTY_TYPES, categories: CATEGORIES, sources: SOURCE_IDS });

test('a new search starts with every source and nothing else picked, and cannot be created like that', () => {
  const prefs = sanitizePrefs({});
  assert.deepEqual(prefs, DEFAULT_PREFS);
  assert.deepEqual(prefs.sources, SOURCE_IDS);
  assert.deepEqual(missingGroups(prefs), ['states', 'types', 'categories']);
  assert.deepEqual(missingGroups({ ...prefs, sources: [] }), ['states', 'types', 'categories', 'sources']);
  assert.deepEqual(sanitizePrefs({ sources: [] }).sources, []);
  assert.deepEqual(missingGroups(sanitizePrefs({ ...everything, districts: [] })), ['districts']);
  assert.deepEqual(missingGroups(sanitizePrefs({ ...everything, states: ['tirol'], districts: [] })), []);
  assert.deepEqual(missingGroups(everything), []);
});

test('picks are kept exactly as ticked', () => {
  assert.deepEqual(everything.states, STATE_IDS);
  assert.deepEqual(everything.districts, ALL_DISTRICTS);
  assert.deepEqual(sanitizePrefs({ states: ['tirol'], districts: [3] }).districts, []);
});

test('nothing ticked in a scan group means nothing is scanned', () => {
  assert.equal(isScannable(everything), true);
  for (const key of ['states', 'types', 'sources']) assert.equal(isScannable({ ...everything, [key]: [] }), false);
});

test('all states scan Austria in one go, all districts do not filter', () => {
  assert.equal(effectivePrefs(everything).states, null);
  assert.equal(effectivePrefs(everything).districts, null);
  assert.deepEqual(effectivePrefs({ ...everything, states: ['wien'], districts: [3] }).districts, [3]);
  assert.equal(effectivePrefs({ ...everything, states: ['tirol'] }).districts, null);
});

test('narrowing does not rescan; widening does', () => {
  const scope = scrapeScope(everything);
  assert.equal(needsRescan(everything, scope), false);
  assert.equal(needsRescan({ ...everything, states: ['wien'], sources: ['willhaben'], types: ['house'] }, scope), false);
  const narrow = scrapeScope({ ...everything, states: ['wien'], sources: ['willhaben'] });
  assert.equal(needsRescan(everything, narrow), true);
  assert.equal(needsRescan({ ...everything, states: ['wien', 'tirol'], sources: ['willhaben'] }, narrow), true);
  assert.equal(needsRescan({ ...everything, states: [], sources: ['willhaben'] }, narrow), false);
});

test('searches saved when empty meant "any" are migrated to everything ticked', async () => {
  const name = 'migration-test';
  await new Promise((resolve, reject) => {
    const open = indexedDB.open(name, 1);
    open.onupgradeneeded = () => {
      open.result.createObjectStore('searches', { keyPath: 'id', autoIncrement: true })
        .add({ name: 'old', prefs: { ...DEFAULT_PREFS, types: ['house'] }, createdAt: '', updatedAt: '', scanScope: null });
    };
    open.onsuccess = () => { open.result.close(); resolve(); };
    open.onerror = () => reject(open.error);
  });
  const idb = await openDb(name);
  const [search] = await new Promise((resolve) => {
    const req = idb.transaction('searches').objectStore('searches').getAll();
    req.onsuccess = () => resolve(req.result);
  });
  closeDb();
  assert.deepEqual(search.prefs.states, STATE_IDS);
  assert.deepEqual(search.prefs.districts, ALL_DISTRICTS);
  assert.deepEqual(search.prefs.types, ['house']);
  assert.deepEqual(search.prefs.categories, CATEGORIES);
  assert.deepEqual(search.prefs.sources, SOURCE_IDS);
});
