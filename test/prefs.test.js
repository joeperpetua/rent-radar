import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'immo-prefs-'));
process.env.DATA_DIR = dir;

const db = await import('../src/db.js');
const { adoptLegacyPrefs, hasSavedSearch, loadPrefs, sanitizePrefs, savePrefs, scrapeScope, DEFAULT_PREFS } = await import('../src/prefs.js');

after(() => {
  db.closeDb();
  rmSync(dir, { recursive: true, force: true });
});

test('a new account starts with no filters and no saved search', () => {
  assert.equal(hasSavedSearch('nobody'), false);
  assert.deepEqual(loadPrefs('nobody'), DEFAULT_PREFS);
  assert.equal(scrapeScope(), null);
});

test('each account keeps its own search', () => {
  savePrefs('anna', sanitizePrefs({ states: ['wien'], maxPrice: 1000, minArea: 60, types: ['apartment'] }));
  savePrefs('ben', sanitizePrefs({ states: ['steiermark'], maxPrice: 700, minRooms: 2, types: ['apartment', 'house'] }));
  assert.equal(loadPrefs('anna').maxPrice, 1000);
  assert.deepEqual(loadPrefs('ben').states, ['steiermark']);
  assert.equal(hasSavedSearch('anna'), true);
});

test('scraping covers the union of every saved search', () => {
  assert.deepEqual(scrapeScope(), {
    states: ['wien', 'steiermark'],
    types: ['apartment', 'house'],
    sources: ['willhaben', 'immoscout', 'rentola'],
    minPrice: 0, maxPrice: 1000,
    minArea: 0, maxArea: 0,
    minRooms: 0, maxRooms: 0,
  });
  savePrefs('cleo', sanitizePrefs({ states: [], maxPrice: 0 }));
  assert.deepEqual(scrapeScope().states, []);
  assert.equal(scrapeScope().maxPrice, 0);
});

test('legacy search is only adopted while no account has one', () => {
  db.setMeta('prefs', { maxPrice: 999 });
  adoptLegacyPrefs('dora');
  assert.equal(hasSavedSearch('dora'), false);
});

test('ticking every district or state means no filter', () => {
  const all = sanitizePrefs({ states: ['wien', 'niederoesterreich', 'burgenland', 'oberoesterreich', 'salzburg', 'steiermark', 'kaernten', 'tirol', 'vorarlberg'], districts: Array.from({ length: 23 }, (_, i) => i + 1) });
  assert.deepEqual(all.states, []);
  assert.deepEqual(all.districts, []);
  assert.deepEqual(sanitizePrefs({ states: ['tirol'], districts: [10] }).districts, []);
  assert.deepEqual(sanitizePrefs({ states: [], districts: [10] }).districts, [10]);
});
