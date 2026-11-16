import { buildView, emptyView, enqueueScan, cancelQueued, isBusy, isIdle, scanStatus, SOURCES } from './scan.js';
import { DEFAULT_PREFS, missingGroups, needsRescan, PROPERTY_TYPES, sanitizeName, sanitizePrefs } from './prefs.js';
import { allSettings, backupData, clearListings, createSearch, deleteSearch, getFavorites, getListing, getSearch, listSearches, pruneListings, restoreBackup, setSetting, storageInfo, updateFavorites, updateListingData, updateSearch } from './db.js';
import { DISTRICTS, STATES } from './geo.js';
import { CATEGORIES } from './categories.js';

const LISTING_ID = /^([a-z0-9_-]+):\S{1,200}$/;
const LOCALES = ['de', 'en'];
export const STYLES = ['styled', 'modern', 'compact'];
export const THEMES = ['system', 'light', 'dark'];
export const REFRESH_CHOICES = [0, 30, 60, 180, 360, 720];

export class ApiError extends Error {}

const SETTINGS = {
  locale: (v) => LOCALES.includes(v),
  style: (v) => STYLES.includes(v),
  theme: (v) => THEMES.includes(v),
  activeSearchId: (v) => v === null || Number.isInteger(v),
  autoRefreshMinutes: (v) => REFRESH_CHOICES.includes(v),
  view: (v) => v != null && typeof v === 'object' && !Array.isArray(v) && JSON.stringify(v).length < 4096,
};

export const BACKUP_APP = 'rentradar';
export const BACKUP_FORMAT = 1;
const BACKUP_SETTINGS = Object.keys(SETTINGS).filter((key) => key !== 'activeSearchId');
const MAX_BACKUP_SEARCHES = 200;
const MAX_BACKUP_FAVORITES = 5000;
const MAX_LISTING_JSON = 500000;

const isObject = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const isoTime = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
const httpUrl = (v) => typeof v === 'string' && /^https?:\/\//i.test(v);

function backupSettings(settings) {
  if (!isObject(settings)) return {};
  return Object.fromEntries(BACKUP_SETTINGS.filter((key) => Object.hasOwn(settings, key) && SETTINGS[key](settings[key])).map((key) => [key, settings[key]]));
}

function backupSearch(input) {
  if (!isObject(input) || !Number.isInteger(input.id)) return null;
  const name = sanitizeName(input.name);
  const prefs = sanitizePrefs(isObject(input.prefs) ? input.prefs : {});
  if (!name || missingGroups(prefs).length) return null;
  return { id: input.id, name, prefs, createdAt: isoTime(input.createdAt) };
}

function backupListing(id, input) {
  if (!isObject(input) || !isObject(input.data)) return null;
  const { data } = input;
  if (data.id !== id || !Object.hasOwn(SOURCES, data.source) || !httpUrl(data.url)) return null;
  if (data.sourceUrl != null && !httpUrl(data.sourceUrl)) return null;
  if (JSON.stringify(data).length > MAX_LISTING_JSON) return null;
  const prices = (Array.isArray(input.prices) ? input.prices : [])
    .filter((p) => isObject(p) && isoTime(p.at) && Number.isFinite(p.price))
    .map((p) => ({ at: isoTime(p.at), price: p.price }))
    .sort((a, b) => a.at.localeCompare(b.at));
  return {
    data: { ...data, images: (Array.isArray(data.images) ? data.images : []).filter(httpUrl) },
    firstSeen: isoTime(input.firstSeen),
    lastSeen: isoTime(input.lastSeen),
    prices,
  };
}

function backupFavorite(input) {
  if (!isObject(input) || typeof input.listingId !== 'string' || !LISTING_ID.test(input.listingId)) return null;
  const listing = input.listing == null ? null : backupListing(input.listingId, input.listing);
  if (input.listing != null && !listing) return null;
  const searches = (Array.isArray(input.searches) ? input.searches : [])
    .filter((m) => isObject(m) && Number.isInteger(m.searchId))
    .map((m) => ({ searchId: m.searchId, firstSeen: isoTime(m.firstSeen), lastSeen: isoTime(m.lastSeen), removedAt: isoTime(m.removedAt) }));
  return { listingId: input.listingId, createdAt: isoTime(input.createdAt), listing, searches };
}

function parseBackup(input) {
  if (!isObject(input) || input.app !== BACKUP_APP) throw new ApiError('not a RentRadar backup');
  if (input.format !== BACKUP_FORMAT) throw new ApiError(`unsupported backup format ${input.format}`);
  const searches = Array.isArray(input.searches) ? input.searches : [];
  const favorites = Array.isArray(input.favorites) ? input.favorites : [];
  if (searches.length > MAX_BACKUP_SEARCHES || favorites.length > MAX_BACKUP_FAVORITES) throw new ApiError('backup too large');
  return {
    settings: backupSettings(input.settings),
    searches: searches.map(backupSearch).filter(Boolean),
    favorites: favorites.map(backupFavorite).filter(Boolean),
  };
}

async function requireSearch(id) {
  const search = await getSearch(Number(id));
  if (!search) throw new ApiError('search not found');
  return search;
}

function listingIds(value) {
  if (!Array.isArray(value) || value.length > 500 || !value.every((id) => typeof id === 'string' && LISTING_ID.test(id))) {
    throw new ApiError('invalid listing ids');
  }
  return value;
}

async function usageBytes() {
  try {
    return (await globalThis.navigator?.storage?.estimate?.())?.usage ?? null;
  } catch {
    return null;
  }
}

async function storage() {
  return { ...await storageInfo(), bytes: await usageBytes() };
}

function requireIdle() {
  if (!isIdle()) throw new ApiError('scan running');
}

const settingsWithDefaults = async () => ({ autoRefreshMinutes: 0, style: 'styled', theme: 'system', ...await allSettings() });

const summary = (search) => ({ ...search, busy: isBusy(search.id) });

export const handlers = {
  config: async () => ({
    searches: (await listSearches()).map(summary),
    settings: await settingsWithDefaults(),
    favorites: await getFavorites(),
    defaults: DEFAULT_PREFS,
    refreshChoices: REFRESH_CHOICES,
    states: STATES.map(({ id, name }) => ({ id, name })),
    districts: DISTRICTS,
    types: PROPERTY_TYPES,
    categories: CATEGORIES,
    sources: Object.entries(SOURCES).map(([id, s]) => ({ id, label: s.label, kind: s.kind })),
  }),

  searches: async () => (await listSearches()).map(summary),

  saveSearch: async ({ id = null, name, prefs }) => {
    const clean = sanitizePrefs(prefs);
    const cleanName = sanitizeName(name);
    if (!cleanName) throw new ApiError('name required');
    if (id == null) {
      const missing = missingGroups(clean);
      if (missing.length) throw new ApiError(`pick at least one of: ${missing.join(', ')}`);
      const created = await createSearch(cleanName, clean);
      enqueueScan(created.id);
      return { search: summary(await getSearch(created.id)), scanning: true };
    }
    const existing = await requireSearch(id);
    const updated = await updateSearch(existing.id, cleanName, clean);
    const scanning = needsRescan(clean, updated.scanScope) && enqueueScan(updated.id);
    return { search: summary(await getSearch(updated.id)), scanning };
  },

  deleteSearch: async ({ id }) => {
    const search = await requireSearch(id);
    cancelQueued(search.id);
    await deleteSearch(search.id);
    return { searches: (await listSearches()).map(summary) };
  },

  scan: async ({ id }) => ({ queued: enqueueScan((await requireSearch(id)).id) }),

  scanAll: async () => ({ queued: (await listSearches()).filter((s) => enqueueScan(s.id)).map((s) => s.id) }),

  listings: async ({ id }) => {
    const search = id == null ? null : await getSearch(Number(id));
    return search ? buildView(search) : emptyView();
  },

  status: () => scanStatus(),

  storage,

  pruneListings: async () => {
    requireIdle();
    const removed = await pruneListings();
    return { removed, storage: await storage() };
  },

  clearListings: async () => {
    requireIdle();
    const removed = await clearListings();
    return { removed, storage: await storage() };
  },

  favorites: async ({ add = [], remove = [] }) => ({ favorites: await updateFavorites({ add: listingIds(add), remove: listingIds(remove) }) }),

  exportBackup: async () => {
    const { settings, searches, favorites } = await backupData();
    return { app: BACKUP_APP, format: BACKUP_FORMAT, exportedAt: new Date().toISOString(), settings: backupSettings(settings), searches, favorites };
  },

  importBackup: async (input) => {
    requireIdle();
    const backup = parseBackup(input);
    return {
      added: await restoreBackup(backup),
      skipped: {
        searches: (input.searches?.length ?? 0) - backup.searches.length,
        favorites: (input.favorites?.length ?? 0) - backup.favorites.length,
      },
      settings: await settingsWithDefaults(),
      searches: (await listSearches()).map(summary),
      favorites: await getFavorites(),
    };
  },

  setSetting: async ({ key, value }) => {
    if (!Object.hasOwn(SETTINGS, key) || !SETTINGS[key](value)) throw new ApiError(`invalid setting ${key}`);
    await setSetting(key, value);
    return { [key]: value };
  },

  fetchDetail: async ({ id }) => {
    if (!id || typeof id !== 'string' || !LISTING_ID.test(id)) throw new ApiError('invalid listing id');
    const listing = await getListing(id);
    if (!listing) throw new ApiError('listing not found');
    const source = SOURCES[listing.source];
    if (!source?.fetchDetails) return { description: listing.description, sections: listing.sections ?? null, deposit: listing.deposit ?? null };
    const details = await source.fetchDetails(listing.url);
    if (details) {
      const patch = { detailsAt: new Date().toISOString() };
      if (details.description) patch.description = details.description;
      if (typeof details.reserved === 'boolean') patch.reserved = details.reserved;
      if (Array.isArray(details.sections)) patch.sections = details.sections;
      if (details.sourceUrl) {
        patch.sourceUrl = details.sourceUrl;
        patch.sourceHost = details.sourceHost;
      }
      if (details.price != null) patch.price = details.price;
      if (details.area != null) patch.area = details.area;
      if (details.rooms != null) patch.rooms = details.rooms;
      if (details.deposit != null) patch.deposit = details.deposit;
      if (details.agency) patch.agency = details.agency;
      if (details.images?.length) patch.images = details.images;
      await updateListingData(id, patch);
      return { description: details.description ?? listing.description, sections: details.sections ?? listing.sections ?? null, deposit: details.deposit ?? listing.deposit ?? null };
    }
    return { description: listing.description, sections: listing.sections ?? null, deposit: listing.deposit ?? null };
  },
};

export async function dispatch(method, payload = {}) {
  const handler = Object.hasOwn(handlers, method) ? handlers[method] : null;
  if (!handler) throw new ApiError(`unknown method ${method}`);
  return handler(payload ?? {});
}

export async function staleSearches(minutes, now = Date.now()) {
  if (!minutes) return [];
  return (await listSearches()).filter((s) => !s.lastScanAt || now - Date.parse(s.lastScanAt) >= minutes * 60 * 1000);
}
