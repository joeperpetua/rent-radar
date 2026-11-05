import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'immo-account-'));
process.env.DATA_DIR = dir;

const db = await import('../src/db.js');
const { rememberGuestSearch, sanitizePrefs, savePrefs, scrapeScope } = await import('../src/prefs.js');

after(() => {
  db.closeDb();
  rmSync(dir, { recursive: true, force: true });
});

test('favourites are stored per account and ignore duplicates', () => {
  db.updateFavorites('anna', { add: ['willhaben:1', 'rentola:a', 'willhaben:1'] });
  db.updateFavorites('ben', { add: ['immoscout:x'] });
  assert.deepEqual(db.getFavorites('anna').sort(), ['rentola:a', 'willhaben:1']);
  assert.deepEqual(db.getFavorites('ben'), ['immoscout:x']);
  db.updateFavorites('anna', { remove: ['willhaben:1'] });
  assert.deepEqual(db.getFavorites('anna'), ['rentola:a']);
  assert.equal(db.countFavorites('anna'), 1);
});

test('locale is stored per account', () => {
  assert.equal(db.getLocale('anna'), null);
  db.setLocale('anna', 'en');
  db.setLocale('anna', 'de');
  db.setLocale('ben', 'en');
  assert.equal(db.getLocale('anna'), 'de');
  assert.equal(db.getLocale('ben'), 'en');
});

test('guest searches widen the scrape scope until they expire', () => {
  savePrefs('anna', sanitizePrefs({ states: ['wien'], maxPrice: 1000 }));
  assert.deepEqual(scrapeScope().states, ['wien']);

  const guest = sanitizePrefs({ states: ['tirol'], maxPrice: 1500, minArea: 40 });
  rememberGuestSearch(guest);
  rememberGuestSearch(guest);
  const scope = scrapeScope();
  assert.deepEqual(scope.states.sort(), ['tirol', 'wien']);
  assert.equal(scope.maxPrice, 1500);
  assert.equal(scope.minArea, 0);
  assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM guest_searches').get().n, 1);

  db.db.prepare('UPDATE guest_searches SET last_used = ?').run('2000-01-01T00:00:00.000Z');
  assert.deepEqual(scrapeScope().states, ['wien']);
  assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM guest_searches').get().n, 0);
});

test('a guest search alone is enough to scrape', () => {
  db.db.exec('DELETE FROM user_prefs');
  assert.equal(scrapeScope(), null);
  rememberGuestSearch(sanitizePrefs({ states: ['salzburg'] }));
  assert.deepEqual(scrapeScope().states, ['salzburg']);
});
