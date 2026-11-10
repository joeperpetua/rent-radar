import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_DIR = resolve(process.env.DATA_DIR ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'data'));
const REMOVED_RETENTION_DAYS = 90;

mkdirSync(DATA_DIR, { recursive: true });
export const db = new DatabaseSync(join(DATA_DIR, 'immo.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS listings (
    id          TEXT PRIMARY KEY,
    source      TEXT NOT NULL,
    type        TEXT NOT NULL,
    price       REAL,
    area        REAL,
    rooms       REAL,
    district    INTEGER,
    data        TEXT NOT NULL,
    first_seen  TEXT NOT NULL,
    last_seen   TEXT NOT NULL,
    removed_at  TEXT
  );
  CREATE INDEX IF NOT EXISTS listings_active ON listings (removed_at, source);

  CREATE TABLE IF NOT EXISTS price_history (
    listing_id  TEXT NOT NULL REFERENCES listings (id) ON DELETE CASCADE,
    seen_at     TEXT NOT NULL,
    price       REAL NOT NULL,
    PRIMARY KEY (listing_id, seen_at)
  );

  CREATE TABLE IF NOT EXISTS runs (
    source  TEXT PRIMARY KEY,
    ok      INTEGER NOT NULL,
    error   TEXT,
    count   INTEGER,
    at      TEXT NOT NULL,
    ms      INTEGER
  );

  CREATE TABLE IF NOT EXISTS meta (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
  );
`);

const MIGRATIONS = [
  () => {
    db.exec('ALTER TABLE listings ADD COLUMN state TEXT');
    db.exec("UPDATE listings SET state = 'wien', data = json_set(data, '$.state', 'wien')");
    db.exec('CREATE INDEX listings_state ON listings (removed_at, state)');
  },
  () => {
    db.exec(`
      CREATE TABLE user_prefs (
        user_id     TEXT PRIMARY KEY,
        prefs       TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      )`);
  },
  () => {
    db.exec(`
      CREATE TABLE user_settings (
        user_id     TEXT PRIMARY KEY,
        locale      TEXT,
        updated_at  TEXT NOT NULL
      );
      CREATE TABLE favorites (
        user_id     TEXT NOT NULL,
        listing_id  TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        PRIMARY KEY (user_id, listing_id)
      ) WITHOUT ROWID;
      CREATE TABLE guest_searches (
        key         TEXT PRIMARY KEY,
        prefs       TEXT NOT NULL,
        last_used   TEXT NOT NULL
      );
      CREATE INDEX guest_searches_last_used ON guest_searches (last_used)`);
  },
];

for (let version = db.prepare('PRAGMA user_version').get().user_version; version < MIGRATIONS.length; version++) {
  db.exec('BEGIN');
  try {
    MIGRATIONS[version]();
    db.exec(`PRAGMA user_version = ${version + 1}`);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

const statements = {
  getMeta: db.prepare('SELECT value FROM meta WHERE key = ?'),
  setMeta: db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value'),
  deleteMeta: db.prepare('DELETE FROM meta WHERE key = ?'),
  getUserPrefs: db.prepare('SELECT prefs FROM user_prefs WHERE user_id = ?'),
  setUserPrefs: db.prepare(`
    INSERT INTO user_prefs (user_id, prefs, updated_at) VALUES (?, ?, ?)
    ON CONFLICT (user_id) DO UPDATE SET prefs = excluded.prefs, updated_at = excluded.updated_at`),
  allUserPrefs: db.prepare('SELECT prefs FROM user_prefs'),
  getLocale: db.prepare('SELECT locale FROM user_settings WHERE user_id = ?'),
  setLocale: db.prepare(`
    INSERT INTO user_settings (user_id, locale, updated_at) VALUES (?, ?, ?)
    ON CONFLICT (user_id) DO UPDATE SET locale = excluded.locale, updated_at = excluded.updated_at`),
  favorites: db.prepare('SELECT listing_id FROM favorites WHERE user_id = ? ORDER BY created_at'),
  countFavorites: db.prepare('SELECT COUNT(*) AS n FROM favorites WHERE user_id = ?'),
  addFavorite: db.prepare('INSERT OR IGNORE INTO favorites (user_id, listing_id, created_at) VALUES (?, ?, ?)'),
  removeFavorite: db.prepare('DELETE FROM favorites WHERE user_id = ? AND listing_id = ?'),
  touchGuestSearch: db.prepare(`
    INSERT INTO guest_searches (key, prefs, last_used) VALUES (?, ?, ?)
    ON CONFLICT (key) DO UPDATE SET last_used = excluded.last_used`),
  guestSearches: db.prepare('SELECT prefs FROM guest_searches WHERE last_used >= ?'),
  pruneGuestSearches: db.prepare(`
    DELETE FROM guest_searches WHERE last_used < ?
      OR key NOT IN (SELECT key FROM guest_searches ORDER BY last_used DESC LIMIT ?)`),
  upsertListing: db.prepare(`
    INSERT INTO listings (id, source, type, state, price, area, rooms, district, data, first_seen, last_seen, removed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT (id) DO UPDATE SET
      source = excluded.source, type = excluded.type, state = excluded.state, price = excluded.price, area = excluded.area,
      rooms = excluded.rooms, district = excluded.district, data = excluded.data,
      last_seen = excluded.last_seen, removed_at = NULL`),
  lastPrice: db.prepare('SELECT price FROM price_history WHERE listing_id = ? ORDER BY seen_at DESC LIMIT 1'),
  addPrice: db.prepare('INSERT OR IGNORE INTO price_history (listing_id, seen_at, price) VALUES (?, ?, ?)'),
  markRemoved: db.prepare('UPDATE listings SET removed_at = ? WHERE source = ? AND removed_at IS NULL AND last_seen <> ?'),
  purgeRemoved: db.prepare('DELETE FROM listings WHERE removed_at IS NOT NULL AND removed_at < ?'),
  upsertRun: db.prepare(`
    INSERT INTO runs (source, ok, error, count, at, ms) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (source) DO UPDATE SET ok = excluded.ok, error = excluded.error,
      count = COALESCE(excluded.count, runs.count), at = excluded.at, ms = excluded.ms`),
  allRuns: db.prepare('SELECT source, ok, error, count, at, ms FROM runs'),
  priceHistory: db.prepare('SELECT seen_at AS at, price FROM price_history WHERE listing_id = ? ORDER BY seen_at'),
  changedPriceHistories: db.prepare(`
    SELECT listing_id, seen_at AS at, price FROM price_history
    WHERE listing_id IN (SELECT listing_id FROM price_history GROUP BY listing_id HAVING COUNT(*) > 1)
    ORDER BY listing_id, seen_at`),
  countListings: db.prepare('SELECT COUNT(*) AS n FROM listings'),
  listingsBySource: db.prepare('SELECT id, data FROM listings WHERE source = ?'),
  listingById: db.prepare('SELECT id, data FROM listings WHERE id = ?'),
  updateListingData: db.prepare('UPDATE listings SET data = ? WHERE id = ?'),
};

function transaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function getMeta(key, fallback = null) {
  const row = statements.getMeta.get(key);
  return row ? JSON.parse(row.value) : fallback;
}

export function setMeta(key, value) {
  statements.setMeta.run(key, JSON.stringify(value));
}

export function deleteMeta(key) {
  statements.deleteMeta.run(key);
}

export function getUserPrefs(userId) {
  const row = statements.getUserPrefs.get(userId);
  return row ? JSON.parse(row.prefs) : null;
}

export function setUserPrefs(userId, prefs) {
  statements.setUserPrefs.run(userId, JSON.stringify(prefs), new Date().toISOString());
}

export const allUserPrefs = () => statements.allUserPrefs.all().map((row) => JSON.parse(row.prefs));

export const getLocale = (userId) => statements.getLocale.get(userId)?.locale ?? null;

export function setLocale(userId, locale) {
  statements.setLocale.run(userId, locale, new Date().toISOString());
}

export const getFavorites = (userId) => statements.favorites.all(userId).map((row) => row.listing_id);

export const countFavorites = (userId) => statements.countFavorites.get(userId).n;

export function updateFavorites(userId, { add = [], remove = [] }) {
  const now = new Date().toISOString();
  transaction(() => {
    for (const id of remove) statements.removeFavorite.run(userId, id);
    for (const id of add) statements.addFavorite.run(userId, id, now);
  });
}

export function touchGuestSearch(key, prefs) {
  statements.touchGuestSearch.run(key, JSON.stringify(prefs), new Date().toISOString());
}

export function guestSearches({ maxAgeMs, maxRows }) {
  const since = new Date(Date.now() - maxAgeMs).toISOString();
  statements.pruneGuestSearches.run(since, maxRows);
  return statements.guestSearches.all(since).map((row) => JSON.parse(row.prefs));
}

export const dataVersion = () => getMeta('data_version', 0);

function writeListing(listing, firstSeen, lastSeen) {
  const { firstSeen: _f, lastSeen: _l, ...data } = listing;
  statements.upsertListing.run(
    listing.id, listing.source, listing.type ?? 'apartment', listing.state ?? null,
    listing.price ?? null, listing.area ?? null, listing.rooms ?? null, listing.district ?? null,
    JSON.stringify(data), firstSeen, lastSeen,
  );
  if (listing.price != null && statements.lastPrice.get(listing.id)?.price !== listing.price) {
    statements.addPrice.run(listing.id, lastSeen, listing.price);
  }
}

export function saveScrape({ startedAt, results, scope }) {
  transaction(() => {
    for (const { key, listings, partial, error, ms } of results) {
      if (error) {
        statements.upsertRun.run(key, 0, error, null, startedAt, ms);
        continue;
      }
      for (const listing of listings) writeListing(listing, startedAt, startedAt);
      if (!partial) statements.markRemoved.run(startedAt, key, startedAt);
      statements.upsertRun.run(key, 1, null, listings.length, startedAt, ms);
      const initial = getMeta('initial_run_at', {});
      if (!initial[key]) setMeta('initial_run_at', { ...initial, [key]: startedAt });
    }
    const cutoff = new Date(Date.parse(startedAt) - REMOVED_RETENTION_DAYS * 86400000).toISOString();
    statements.purgeRemoved.run(cutoff);
    setMeta('last_run', startedAt);
    setMeta('last_run_scope', scope);
    setMeta('data_version', dataVersion() + 1);
  });
}

export function queryListings(prefs) {
  const where = ['removed_at IS NULL'];
  const params = [];
  const inList = (column, values) => {
    where.push(`${column} IN (${values.map(() => '?').join(', ')})`);
    params.push(...values);
  };
  const range = (column, min, max) => {
    if (min) { where.push(`(${column} IS NULL OR ${column} >= ?)`); params.push(min); }
    if (max) { where.push(`(${column} IS NULL OR ${column} <= ?)`); params.push(max); }
  };
  inList('source', prefs.sources.length ? prefs.sources : ['']);
  inList('type', prefs.types);
  range('price', prefs.minPrice, prefs.maxPrice);
  range('area', prefs.minArea, prefs.maxArea);
  range('rooms', prefs.minRooms, prefs.maxRooms);
  if (prefs.states?.length) inList('state', prefs.states);
  if (prefs.districts.length) {
    where.push(`(state IS NOT 'wien' OR district IN (${prefs.districts.map(() => '?').join(', ')}))`);
    params.push(...prefs.districts);
  }

  const rows = db.prepare(`SELECT data, first_seen, last_seen FROM listings WHERE ${where.join(' AND ')}`).all(...params);
  return rows.map((row) => ({ ...JSON.parse(row.data), firstSeen: row.first_seen, lastSeen: row.last_seen }));
}

export function getRuns() {
  return Object.fromEntries(statements.allRuns.all().map(({ source, ok, ...run }) => [source, { ...run, ok: Boolean(ok) }]));
}

export const getPriceHistory = (id) => statements.priceHistory.all(id);

export function getStoredListings(source) {
  return new Map(statements.listingsBySource.all(source).map((row) => [row.id, JSON.parse(row.data)]));
}

export function getListing(id) {
  const row = statements.listingById.get(id);
  return row ? JSON.parse(row.data) : null;
}

export function updateListingData(id, patch) {
  return transaction(() => {
    const row = statements.listingById.get(id);
    if (!row) return null;
    const updatedData = { ...JSON.parse(row.data), ...patch };
    statements.updateListingData.run(JSON.stringify(updatedData), id);
    bumpVersion();
    return updatedData;
  });
}

export function getChangedPriceHistories() {
  const histories = new Map();
  for (const { listing_id: id, at, price } of statements.changedPriceHistories.all()) {
    if (!histories.has(id)) histories.set(id, []);
    histories.get(id).push({ at, price });
  }
  return histories;
}

export function closeDb() {
  if (db.isOpen) db.close();
}

function importLegacyJson() {
  const storeFile = join(DATA_DIR, 'store.json');
  const prefsFile = join(DATA_DIR, 'prefs.json');
  if (statements.countListings.get().n > 0 || getMeta('prefs')) return;

  if (existsSync(prefsFile)) {
    setMeta('prefs', JSON.parse(readFileSync(prefsFile, 'utf8')));
    renameSync(prefsFile, `${prefsFile}.migrated`);
  }
  if (!existsSync(storeFile)) return;
  const store = JSON.parse(readFileSync(storeFile, 'utf8'));
  transaction(() => {
    for (const listing of Object.values(store.listings ?? {})) {
      writeListing({ ...listing, state: listing.state ?? 'wien' }, listing.firstSeen ?? listing.lastSeen, listing.lastSeen ?? listing.firstSeen);
    }
    for (const [source, run] of Object.entries(store.runs ?? {})) {
      statements.upsertRun.run(source, run.ok ? 1 : 0, run.error ?? null, run.count ?? null, run.at, run.ms ?? null);
    }
    if (store.initialRunAt) setMeta('initial_run_at', store.initialRunAt);
    if (store.lastRun) setMeta('last_run', store.lastRun);
    if (store.lastRunPrefs) setMeta('last_run_scope', store.lastRunPrefs);
    setMeta('data_version', 1);
  });
  renameSync(storeFile, `${storeFile}.migrated`);
  console.log(`[db] imported ${Object.keys(store.listings ?? {}).length} listings from store.json`);
}

importLegacyJson();
