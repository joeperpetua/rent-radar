import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const REMOVED_RETENTION_DAYS = 90;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS listings (
    id          TEXT PRIMARY KEY,
    source      TEXT NOT NULL,
    type        TEXT NOT NULL,
    state       TEXT,
    price       REAL,
    area        REAL,
    rooms       REAL,
    district    INTEGER,
    data        TEXT NOT NULL,
    first_seen  TEXT NOT NULL,
    last_seen   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS price_history (
    listing_id  TEXT NOT NULL REFERENCES listings (id) ON DELETE CASCADE,
    seen_at     TEXT NOT NULL,
    price       REAL NOT NULL,
    PRIMARY KEY (listing_id, seen_at)
  );

  CREATE TABLE IF NOT EXISTS searches (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    prefs       TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    scan_scope  TEXT
  );

  CREATE TABLE IF NOT EXISTS search_listings (
    search_id   INTEGER NOT NULL REFERENCES searches (id) ON DELETE CASCADE,
    listing_id  TEXT NOT NULL REFERENCES listings (id) ON DELETE CASCADE,
    first_seen  TEXT NOT NULL,
    last_seen   TEXT NOT NULL,
    removed_at  TEXT,
    PRIMARY KEY (search_id, listing_id)
  ) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS search_listings_listing ON search_listings (listing_id);

  CREATE TABLE IF NOT EXISTS scans (
    id           INTEGER PRIMARY KEY,
    search_id    INTEGER NOT NULL REFERENCES searches (id) ON DELETE CASCADE,
    started_at   TEXT NOT NULL,
    finished_at  TEXT
  );
  CREATE INDEX IF NOT EXISTS scans_search ON scans (search_id, started_at);

  CREATE TABLE IF NOT EXISTS scan_sources (
    scan_id  INTEGER NOT NULL REFERENCES scans (id) ON DELETE CASCADE,
    source   TEXT NOT NULL,
    ok       INTEGER NOT NULL,
    partial  INTEGER NOT NULL DEFAULT 0,
    error    TEXT,
    count    INTEGER,
    ms       INTEGER,
    PRIMARY KEY (scan_id, source)
  ) WITHOUT ROWID;

  CREATE TABLE IF NOT EXISTS favorites (
    listing_id  TEXT PRIMARY KEY,
    created_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS meta (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
  );
`;

const SEARCH_SELECT = `
  SELECT s.*,
    (SELECT MAX(started_at) FROM scans WHERE search_id = s.id AND finished_at IS NOT NULL) AS last_scan_at,
    (SELECT COUNT(*) FROM search_listings WHERE search_id = s.id AND removed_at IS NULL) AS listing_count
  FROM searches s`;

let db = null;
let statements = null;

function prepare() {
  return {
    getSetting: db.prepare('SELECT value FROM settings WHERE key = ?'),
    setSetting: db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value'),
    allSettings: db.prepare('SELECT key, value FROM settings'),
    getMeta: db.prepare('SELECT value FROM meta WHERE key = ?'),
    setMeta: db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value'),
    insertSearch: db.prepare('INSERT INTO searches (name, prefs, created_at, updated_at) VALUES (?, ?, ?, ?)'),
    updateSearch: db.prepare('UPDATE searches SET name = ?, prefs = ?, updated_at = ? WHERE id = ?'),
    deleteSearch: db.prepare('DELETE FROM searches WHERE id = ?'),
    getSearch: db.prepare(`${SEARCH_SELECT} WHERE s.id = ?`),
    allSearches: db.prepare(`${SEARCH_SELECT} ORDER BY s.created_at, s.id`),
    setScanScope: db.prepare('UPDATE searches SET scan_scope = ? WHERE id = ?'),
    insertScan: db.prepare('INSERT INTO scans (search_id, started_at) VALUES (?, ?)'),
    finishScan: db.prepare('UPDATE scans SET finished_at = ? WHERE id = ?'),
    insertScanSource: db.prepare('INSERT INTO scan_sources (scan_id, source, ok, partial, error, count, ms) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    latestRuns: db.prepare(`
      SELECT ss.source, ss.ok, ss.error, ss.count, ss.ms, sc.started_at AS at
      FROM scan_sources ss JOIN scans sc ON sc.id = ss.scan_id
      WHERE sc.search_id = ? AND sc.started_at = (
        SELECT MAX(sc2.started_at) FROM scan_sources ss2 JOIN scans sc2 ON sc2.id = ss2.scan_id
        WHERE sc2.search_id = sc.search_id AND ss2.source = ss.source)`),
    lastOkCount: db.prepare(`
      SELECT ss.count FROM scan_sources ss JOIN scans sc ON sc.id = ss.scan_id
      WHERE sc.search_id = ? AND ss.source = ? AND ss.ok = 1 ORDER BY sc.started_at DESC LIMIT 1`),
    initialScans: db.prepare(`
      SELECT ss.source, MIN(sc.started_at) AS at FROM scan_sources ss JOIN scans sc ON sc.id = ss.scan_id
      WHERE sc.search_id = ? AND ss.ok = 1 GROUP BY ss.source`),
    upsertListing: db.prepare(`
      INSERT INTO listings (id, source, type, state, price, area, rooms, district, data, first_seen, last_seen)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET
        source = excluded.source, type = excluded.type, state = excluded.state, price = excluded.price, area = excluded.area,
        rooms = excluded.rooms, district = excluded.district, data = excluded.data, last_seen = excluded.last_seen`),
    upsertMembership: db.prepare(`
      INSERT INTO search_listings (search_id, listing_id, first_seen, last_seen, removed_at) VALUES (?, ?, ?, ?, NULL)
      ON CONFLICT (search_id, listing_id) DO UPDATE SET last_seen = excluded.last_seen, removed_at = NULL`),
    markRemoved: db.prepare(`
      UPDATE search_listings SET removed_at = ?
      WHERE search_id = ? AND removed_at IS NULL AND last_seen <> ?
        AND listing_id IN (SELECT id FROM listings WHERE source = ?)`),
    purgeRemoved: db.prepare('DELETE FROM search_listings WHERE removed_at IS NOT NULL AND removed_at < ?'),
    purgeOrphans: db.prepare('DELETE FROM listings WHERE id NOT IN (SELECT listing_id FROM search_listings)'),
    lastPrice: db.prepare('SELECT price FROM price_history WHERE listing_id = ? ORDER BY seen_at DESC LIMIT 1'),
    addPrice: db.prepare('INSERT OR IGNORE INTO price_history (listing_id, seen_at, price) VALUES (?, ?, ?)'),
    priceHistory: db.prepare('SELECT seen_at AS at, price FROM price_history WHERE listing_id = ? ORDER BY seen_at'),
    changedPriceHistories: db.prepare(`
      SELECT ph.listing_id, ph.seen_at AS at, ph.price FROM price_history ph
      JOIN search_listings sl ON sl.listing_id = ph.listing_id AND sl.search_id = ?
      WHERE ph.listing_id IN (SELECT listing_id FROM price_history GROUP BY listing_id HAVING COUNT(*) > 1)
      ORDER BY ph.listing_id, ph.seen_at`),
    listingsBySource: db.prepare('SELECT id, data FROM listings WHERE source = ?'),
    favorites: db.prepare('SELECT listing_id FROM favorites ORDER BY created_at'),
    addFavorite: db.prepare('INSERT OR IGNORE INTO favorites (listing_id, created_at) VALUES (?, ?)'),
    removeFavorite: db.prepare('DELETE FROM favorites WHERE listing_id = ?'),
  };
}

export function openDb(file) {
  closeDb();
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  statements = prepare();
  return db;
}

export function closeDb() {
  if (db?.isOpen) db.close();
  db = null;
  statements = null;
}

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

const now = () => new Date().toISOString();

export function getSetting(key, fallback = null) {
  const row = statements.getSetting.get(key);
  return row ? JSON.parse(row.value) : fallback;
}

export function setSetting(key, value) {
  statements.setSetting.run(key, JSON.stringify(value));
}

export const allSettings = () => Object.fromEntries(statements.allSettings.all().map((r) => [r.key, JSON.parse(r.value)]));

export function getMeta(key, fallback = null) {
  const row = statements.getMeta.get(key);
  return row ? JSON.parse(row.value) : fallback;
}

export const dataVersion = () => getMeta('data_version', 0);

const bumpVersion = () => statements.setMeta.run('data_version', JSON.stringify(dataVersion() + 1));

function searchRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    prefs: JSON.parse(row.prefs),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    scanScope: row.scan_scope ? JSON.parse(row.scan_scope) : null,
    lastScanAt: row.last_scan_at ?? null,
    listingCount: row.listing_count ?? 0,
  };
}

export function createSearch(name, prefs) {
  const at = now();
  const { lastInsertRowid } = statements.insertSearch.run(name, JSON.stringify(prefs), at, at);
  return getSearch(Number(lastInsertRowid));
}

export function updateSearch(id, name, prefs) {
  statements.updateSearch.run(name, JSON.stringify(prefs), now(), id);
  bumpVersion();
  return getSearch(id);
}

export function deleteSearch(id) {
  transaction(() => {
    statements.deleteSearch.run(id);
    statements.purgeOrphans.run();
    bumpVersion();
  });
}

export const getSearch = (id) => searchRow(statements.getSearch.get(id));

export const listSearches = () => statements.allSearches.all().map(searchRow);

function writeListing(searchId, listing, at) {
  const { firstSeen: _f, lastSeen: _l, ...data } = listing;
  statements.upsertListing.run(
    listing.id, listing.source, listing.type ?? 'apartment', listing.state ?? null,
    listing.price ?? null, listing.area ?? null, listing.rooms ?? null, listing.district ?? null,
    JSON.stringify(data), at, at,
  );
  statements.upsertMembership.run(searchId, listing.id, at, at);
  if (listing.price != null && statements.lastPrice.get(listing.id)?.price !== listing.price) {
    statements.addPrice.run(listing.id, at, listing.price);
  }
}

export function saveScan({ searchId, startedAt, results, scope }) {
  return transaction(() => {
    const scanId = Number(statements.insertScan.run(searchId, startedAt).lastInsertRowid);
    for (const { key, listings, partial = false, error, ms } of results) {
      if (error) {
        statements.insertScanSource.run(scanId, key, 0, 0, error, null, ms ?? null);
        continue;
      }
      for (const listing of listings) writeListing(searchId, listing, startedAt);
      if (!partial) statements.markRemoved.run(startedAt, searchId, startedAt, key);
      statements.insertScanSource.run(scanId, key, 1, partial ? 1 : 0, null, listings.length, ms ?? null);
    }
    const cutoff = new Date(Date.parse(startedAt) - REMOVED_RETENTION_DAYS * 86400000).toISOString();
    statements.purgeRemoved.run(cutoff);
    statements.purgeOrphans.run();
    statements.setScanScope.run(JSON.stringify(scope), searchId);
    statements.finishScan.run(now(), scanId);
    bumpVersion();
    return scanId;
  });
}

export function queryListings(searchId, prefs) {
  const where = ['sl.search_id = ?', 'sl.removed_at IS NULL'];
  const params = [searchId];
  const inList = (column, values) => {
    where.push(`${column} IN (${values.map(() => '?').join(', ')})`);
    params.push(...values);
  };
  const range = (column, min, max) => {
    if (min) { where.push(`(${column} IS NULL OR ${column} >= ?)`); params.push(min); }
    if (max) { where.push(`(${column} IS NULL OR ${column} <= ?)`); params.push(max); }
  };
  inList('l.source', prefs.sources.length ? prefs.sources : ['']);
  inList('l.type', prefs.types);
  range('l.price', prefs.minPrice, prefs.maxPrice);
  range('l.area', prefs.minArea, prefs.maxArea);
  range('l.rooms', prefs.minRooms, prefs.maxRooms);
  if (prefs.states?.length) inList('l.state', prefs.states);
  if (prefs.districts?.length) {
    where.push(`(l.state IS NOT 'wien' OR l.district IN (${prefs.districts.map(() => '?').join(', ')}))`);
    params.push(...prefs.districts);
  }

  const rows = db.prepare(`
    SELECT l.data, sl.first_seen, sl.last_seen FROM search_listings sl JOIN listings l ON l.id = sl.listing_id
    WHERE ${where.join(' AND ')}`).all(...params);
  return rows.map((row) => ({ ...JSON.parse(row.data), firstSeen: row.first_seen, lastSeen: row.last_seen }));
}

export function getRuns(searchId) {
  return Object.fromEntries(statements.latestRuns.all(searchId).map(({ source, ok, count, ...run }) => [source, {
    ...run,
    ok: Boolean(ok),
    count: ok ? count : statements.lastOkCount.get(searchId, source)?.count ?? null,
  }]));
}

export const initialScanAt = (searchId) => Object.fromEntries(statements.initialScans.all(searchId).map((r) => [r.source, r.at]));

export const getPriceHistory = (id) => statements.priceHistory.all(id);

export function getChangedPriceHistories(searchId) {
  const histories = new Map();
  for (const { listing_id: id, at, price } of statements.changedPriceHistories.all(searchId)) {
    if (!histories.has(id)) histories.set(id, []);
    histories.get(id).push({ at, price });
  }
  return histories;
}

export function getStoredListings(source) {
  return new Map(statements.listingsBySource.all(source).map((row) => [row.id, JSON.parse(row.data)]));
}

export const getFavorites = () => statements.favorites.all().map((row) => row.listing_id);

export function updateFavorites({ add = [], remove = [] }) {
  const at = now();
  transaction(() => {
    for (const id of remove) statements.removeFavorite.run(id);
    for (const id of add) statements.addFavorite.run(id, at);
  });
  return getFavorites();
}
