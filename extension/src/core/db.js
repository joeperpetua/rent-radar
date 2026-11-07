import { fillUnspecified, sanitizePrefs } from './prefs.js';

const DB_NAME = 'rentradar';
const DB_VERSION = 3;
const REMOVED_RETENTION_DAYS = 90;

const LISTINGS = 'listings';
const SEARCHES = 'searches';
const MEMBERS = 'searchListings';
const SCANS = 'scans';
const FAVORITES = 'favorites';
const SETTINGS = 'settings';
const META = 'meta';

let db = null;

function upgrade(idb, from, t) {
  if (from < 1) createStores(idb);
  if (from < 3) {
    eachCursor(t.objectStore(SEARCHES).openCursor(), (c) => {
      let prefs = c.value?.prefs;
      if (!prefs) return;
      if (from < 2) prefs = fillUnspecified(prefs);
      prefs = sanitizePrefs(prefs);
      c.update({ ...c.value, prefs });
    });
  }
}

function createStores(idb) {
  idb.createObjectStore(LISTINGS, { keyPath: 'id' }).createIndex('source', 'source');
  idb.createObjectStore(SEARCHES, { keyPath: 'id', autoIncrement: true });
  const members = idb.createObjectStore(MEMBERS, { keyPath: ['searchId', 'listingId'] });
  members.createIndex('searchId', 'searchId');
  members.createIndex('listingId', 'listingId');
  idb.createObjectStore(SCANS, { keyPath: 'id', autoIncrement: true }).createIndex('searchId', 'searchId');
  idb.createObjectStore(FAVORITES, { keyPath: 'listingId' });
  idb.createObjectStore(SETTINGS, { keyPath: 'key' });
  idb.createObjectStore(META, { keyPath: 'key' });
}

const req = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

function eachCursor(request, fn) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return resolve();
      fn(cursor);
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
}

function tx(stores, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let result;
    t.oncomplete = () => resolve(result);
    t.onabort = () => reject(t.error ?? new Error('transaction aborted'));
    fn(t).then((value) => { result = value; }, (err) => {
      reject(err);
      try { t.abort(); } catch {}
    });
  });
}

const read = (stores, fn) => tx(stores, 'readonly', fn);
const write = (stores, fn) => tx(stores, 'readwrite', fn);

export async function openDb(name = DB_NAME) {
  closeDb();
  const open = indexedDB.open(name, DB_VERSION);
  open.onupgradeneeded = (e) => upgrade(open.result, e.oldVersion, open.transaction);
  db = await req(open);
  db.onversionchange = () => closeDb();
  return db;
}

export function closeDb() {
  db?.close();
  db = null;
}

const now = () => new Date().toISOString();

export async function getSetting(key, fallback = null) {
  const row = await read(SETTINGS, async (t) => req(t.objectStore(SETTINGS).get(key)));
  return row ? row.value : fallback;
}

export const setSetting = (key, value) => write(SETTINGS, async (t) => { await req(t.objectStore(SETTINGS).put({ key, value })); });

export async function allSettings() {
  const rows = await read(SETTINGS, async (t) => req(t.objectStore(SETTINGS).getAll()));
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function getMeta(key, fallback = null) {
  const row = await read(META, async (t) => req(t.objectStore(META).get(key)));
  return row ? row.value : fallback;
}

export const dataVersion = () => getMeta('data_version', 0);

async function bumpVersion(t) {
  const store = t.objectStore(META);
  const row = await req(store.get('data_version'));
  await req(store.put({ key: 'data_version', value: (row?.value ?? 0) + 1 }));
}

async function searchRow(t, row) {
  if (!row) return null;
  const scans = await req(t.objectStore(SCANS).index('searchId').getAll(row.id));
  const members = await req(t.objectStore(MEMBERS).index('searchId').getAll(row.id));
  const finished = scans.filter((s) => s.finishedAt).map((s) => s.startedAt).sort();
  return {
    id: row.id,
    name: row.name,
    prefs: row.prefs,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    scanScope: row.scanScope ?? null,
    lastScanAt: finished.at(-1) ?? null,
    listingCount: members.filter((m) => !m.removedAt).length,
  };
}

export const getSearch = (id) => read([SEARCHES, SCANS, MEMBERS], async (t) => searchRow(t, await req(t.objectStore(SEARCHES).get(id))));

export const listSearches = () => read([SEARCHES, SCANS, MEMBERS], async (t) => {
  const rows = await req(t.objectStore(SEARCHES).getAll());
  rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id);
  return Promise.all(rows.map((row) => searchRow(t, row)));
});

export async function createSearch(name, prefs) {
  const at = now();
  const id = await write(SEARCHES, async (t) => req(t.objectStore(SEARCHES).add({ name, prefs, createdAt: at, updatedAt: at, scanScope: null })));
  return getSearch(id);
}

export async function updateSearch(id, name, prefs) {
  await write([SEARCHES, META], async (t) => {
    const store = t.objectStore(SEARCHES);
    const row = await req(store.get(id));
    if (!row) return;
    await req(store.put({ ...row, name, prefs, updatedAt: now() }));
    await bumpVersion(t);
  });
  return getSearch(id);
}

async function purgeOrphans(t) {
  const referenced = new Set((await req(t.objectStore(MEMBERS).getAllKeys())).map(([, listingId]) => listingId));
  const listings = t.objectStore(LISTINGS);
  for (const id of await req(listings.getAllKeys())) {
    if (!referenced.has(id)) listings.delete(id);
  }
}

export function deleteSearch(id) {
  return write([SEARCHES, META], async (t) => {
    t.objectStore(SEARCHES).delete(id);
    await bumpVersion(t);
  });
}

function latestPrice(prices) {
  return prices.reduce((latest, p) => (!latest || p.at > latest.at ? p : latest), null)?.price;
}

async function writeListing(t, searchId, listing, at) {
  const { firstSeen: _f, lastSeen: _l, ...data } = listing;
  const listings = t.objectStore(LISTINGS);
  const existing = await req(listings.get(listing.id));
  const prices = existing?.prices ?? [];
  if (listing.price != null && latestPrice(prices) !== listing.price && !prices.some((p) => p.at === at)) {
    prices.push({ at, price: listing.price });
    prices.sort((a, b) => a.at.localeCompare(b.at));
  }
  listings.put({
    id: listing.id,
    source: listing.source,
    type: listing.type ?? 'apartment',
    state: listing.state ?? null,
    price: listing.price ?? null,
    area: listing.area ?? null,
    rooms: listing.rooms ?? null,
    district: listing.district ?? null,
    data,
    firstSeen: existing?.firstSeen ?? at,
    lastSeen: at,
    prices,
  });
  const members = t.objectStore(MEMBERS);
  const member = await req(members.get([searchId, listing.id]));
  members.put({ searchId, listingId: listing.id, source: listing.source, firstSeen: member?.firstSeen ?? at, lastSeen: at, removedAt: null });
}

function markRemoved(t, searchId, source, at) {
  return eachCursor(t.objectStore(MEMBERS).index('searchId').openCursor(searchId), (c) => {
    const m = c.value;
    if (!m.removedAt && m.lastSeen !== at && m.source === source) c.update({ ...m, removedAt: at });
  });
}

function purgeRemoved(t, cutoff) {
  return eachCursor(t.objectStore(MEMBERS).openCursor(), (c) => {
    if (c.value.removedAt && c.value.removedAt < cutoff) c.delete();
  });
}

export function saveScan({ searchId, startedAt, results, scope }) {
  return write([LISTINGS, MEMBERS, SCANS, SEARCHES, META], async (t) => {
    const search = await req(t.objectStore(SEARCHES).get(searchId));
    if (!search) return null;
    const sources = {};
    for (const { key, listings, partial = false, error, ms } of results) {
      if (error) {
        sources[key] = { ok: false, partial: false, error, count: null, ms: ms ?? null };
        continue;
      }
      for (const listing of listings) await writeListing(t, searchId, listing, startedAt);
      if (!partial) await markRemoved(t, searchId, key, startedAt);
      sources[key] = { ok: true, partial, error: null, count: listings.length, ms: ms ?? null };
    }
    const cutoff = new Date(Date.parse(startedAt) - REMOVED_RETENTION_DAYS * 86400000).toISOString();
    await purgeRemoved(t, cutoff);
    await purgeOrphans(t);
    t.objectStore(SEARCHES).put({ ...search, scanScope: scope });
    const scanId = await req(t.objectStore(SCANS).add({ searchId, startedAt, finishedAt: now(), sources }));
    await bumpVersion(t);
    return scanId;
  });
}

const inRange = (value, min, max) => value == null || ((!min || value >= min) && (!max || value <= max));

function matches(l, prefs) {
  return prefs.sources.includes(l.source)
    && prefs.types.includes(l.type)
    && !l.forSale
    && !l.data?.forSale
    && l.price != null && l.price > 0
    && inRange(l.price, prefs.minPrice, prefs.maxPrice)
    && inRange(l.area, prefs.minArea, prefs.maxArea)
    && inRange(l.rooms, prefs.minRooms, prefs.maxRooms)
    && (prefs.states == null || !prefs.states.length || prefs.states.includes(l.state))
    && (prefs.districts == null || !prefs.districts.length || l.state !== 'wien' || prefs.districts.includes(l.district));
}

async function memberListings(t, searchId, filter = () => true) {
  const members = (await req(t.objectStore(MEMBERS).index('searchId').getAll(searchId))).filter(filter);
  const listings = t.objectStore(LISTINGS);
  const rows = await Promise.all(members.map(async (m) => ({ m, l: await req(listings.get(m.listingId)) })));
  return rows.filter((r) => r.l);
}

export const queryListings = (searchId, prefs) => read([MEMBERS, LISTINGS], async (t) => {
  const rows = await memberListings(t, searchId, (m) => !m.removedAt);
  return rows
    .filter(({ l }) => matches(l, prefs))
    .map(({ m, l }) => ({ ...l.data, firstSeen: m.firstSeen, lastSeen: m.lastSeen }));
});

const scansOf = (searchId) => read(SCANS, async (t) => {
  const scans = await req(t.objectStore(SCANS).index('searchId').getAll(searchId));
  return scans.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
});

export async function getRuns(searchId) {
  const runs = {};
  const lastOk = {};
  for (const scan of await scansOf(searchId)) {
    for (const [source, { ok, error, count, ms }] of Object.entries(scan.sources)) {
      runs[source] = { error, ms, at: scan.startedAt, ok, count };
      if (ok) lastOk[source] = count;
    }
  }
  return Object.fromEntries(Object.entries(runs).map(([source, run]) => [source, {
    ...run,
    count: run.ok ? run.count : lastOk[source] ?? null,
  }]));
}

export async function initialScanAt(searchId) {
  const initial = {};
  for (const scan of await scansOf(searchId)) {
    for (const [source, { ok }] of Object.entries(scan.sources)) {
      if (ok && !initial[source]) initial[source] = scan.startedAt;
    }
  }
  return initial;
}

export const getPriceHistory = (id) => read(LISTINGS, async (t) => (await req(t.objectStore(LISTINGS).get(id)))?.prices ?? []);

export const getChangedPriceHistories = (searchId) => read([MEMBERS, LISTINGS], async (t) => {
  const histories = new Map();
  for (const { l } of await memberListings(t, searchId)) {
    if (l.prices.length > 1) histories.set(l.id, l.prices);
  }
  return histories;
});

export const getStoredListings = (source) => read(LISTINGS, async (t) => {
  const rows = await req(t.objectStore(LISTINGS).index('source').getAll(source));
  return new Map(rows.map((row) => [row.id, row.data]));
});

export const getListing = (id) => read(LISTINGS, async (t) => {
  const row = await req(t.objectStore(LISTINGS).get(id));
  return row ? { ...row.data, firstSeen: row.firstSeen, lastSeen: row.lastSeen, prices: row.prices } : null;
});

export const updateListingData = (id, patch) => write([LISTINGS, META], async (t) => {
  const store = t.objectStore(LISTINGS);
  const row = await req(store.get(id));
  if (!row) return null;
  const updatedData = { ...row.data, ...patch };
  await req(store.put({ ...row, data: updatedData }));
  await bumpVersion(t);
  return updatedData;
});

export const getFavorites = () => read(FAVORITES, async (t) => {
  const rows = await req(t.objectStore(FAVORITES).getAll());
  return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((row) => row.listingId);
});

export async function updateFavorites({ add = [], remove = [] }) {
  const at = now();
  await write(FAVORITES, async (t) => {
    const store = t.objectStore(FAVORITES);
    for (const id of remove) store.delete(id);
    for (const id of add) {
      if (!await req(store.getKey(id))) store.put({ listingId: id, createdAt: at });
    }
  });
  return getFavorites();
}
