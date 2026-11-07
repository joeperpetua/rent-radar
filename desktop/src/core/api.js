import { buildView, emptyView, enqueueScan, cancelQueued, isBusy, scanStatus, SOURCES } from './scan.js';
import { DEFAULT_PREFS, needsRescan, PROPERTY_TYPES, sanitizeName, sanitizePrefs } from './prefs.js';
import { allSettings, createSearch, deleteSearch, getFavorites, getListing, getSearch, listSearches, setSetting, updateFavorites, updateListingData, updateSearch } from './db.js';
import { DISTRICTS, STATES } from './geo.js';
import { CATEGORIES } from './categories.js';

const LISTING_ID = /^([a-z0-9_-]+):\S{1,200}$/;
const LOCALES = ['de', 'en'];
export const REFRESH_CHOICES = [0, 30, 60, 180, 360, 720];

export class ApiError extends Error {}

const SETTINGS = {
  locale: (v) => LOCALES.includes(v),
  activeSearchId: (v) => v === null || Number.isInteger(v),
  autoRefreshMinutes: (v) => REFRESH_CHOICES.includes(v),
  view: (v) => v != null && typeof v === 'object' && !Array.isArray(v) && JSON.stringify(v).length < 4096,
};

function requireSearch(id) {
  const search = getSearch(Number(id));
  if (!search) throw new ApiError('search not found');
  return search;
}

function listingIds(value) {
  if (!Array.isArray(value) || value.length > 500 || !value.every((id) => typeof id === 'string' && LISTING_ID.test(id))) {
    throw new ApiError('invalid listing ids');
  }
  return value;
}

const summary = (search) => ({ ...search, busy: isBusy(search.id) });

export const handlers = {
  config: () => ({
    searches: listSearches().map(summary),
    settings: { autoRefreshMinutes: 0, ...allSettings() },
    favorites: getFavorites(),
    defaults: DEFAULT_PREFS,
    refreshChoices: REFRESH_CHOICES,
    states: STATES.map(({ id, name }) => ({ id, name })),
    districts: DISTRICTS,
    types: PROPERTY_TYPES,
    categories: CATEGORIES,
    sources: Object.entries(SOURCES).map(([id, s]) => ({ id, label: s.label })),
  }),

  searches: () => listSearches().map(summary),

  saveSearch: ({ id = null, name, prefs }) => {
    const clean = sanitizePrefs(prefs);
    const cleanName = sanitizeName(name);
    if (!cleanName) throw new ApiError('name required');
    if (id == null) {
      const created = createSearch(cleanName, clean);
      enqueueScan(created.id);
      return { search: summary(getSearch(created.id)), scanning: true };
    }
    const existing = requireSearch(id);
    const updated = updateSearch(existing.id, cleanName, clean);
    const scanning = needsRescan(clean, updated.scanScope) && enqueueScan(updated.id);
    return { search: summary(getSearch(updated.id)), scanning };
  },

  deleteSearch: ({ id }) => {
    const search = requireSearch(id);
    cancelQueued(search.id);
    deleteSearch(search.id);
    return { searches: listSearches().map(summary) };
  },

  scan: ({ id }) => ({ queued: enqueueScan(requireSearch(id).id) }),

  scanAll: () => ({ queued: listSearches().filter((s) => enqueueScan(s.id)).map((s) => s.id) }),

  listings: ({ id }) => {
    const search = id == null ? null : getSearch(Number(id));
    return search ? buildView(search) : emptyView();
  },

  status: () => scanStatus(),

  favorites: ({ add = [], remove = [] }) => ({ favorites: updateFavorites({ add: listingIds(add), remove: listingIds(remove) }) }),

  setSetting: ({ key, value }) => {
    if (!Object.hasOwn(SETTINGS, key) || !SETTINGS[key](value)) throw new ApiError(`invalid setting ${key}`);
    setSetting(key, value);
    return { [key]: value };
  },

  fetchDetail: async ({ id }) => {
    if (!id || typeof id !== 'string' || !LISTING_ID.test(id)) throw new ApiError('invalid listing id');
    const listing = getListing(id);
    if (!listing) throw new ApiError('listing not found');
    const source = SOURCES[listing.source];
    if (!source?.fetchDetails) return { description: listing.description };
    const details = await source.fetchDetails(listing.url);
    if (details) {
      const patch = { detailsAt: new Date().toISOString() };
      if (details.description) patch.description = details.description;
      if (details.sourceUrl) {
        patch.sourceUrl = details.sourceUrl;
        patch.sourceHost = details.sourceHost;
      }
      if (details.price != null) patch.price = details.price;
      if (details.area != null) patch.area = details.area;
      if (details.rooms != null) patch.rooms = details.rooms;
      if (details.deposit != null) patch.deposit = details.deposit;
      if (details.agency) patch.agency = details.agency;
      if (details.agencyPhone) patch.agencyPhone = details.agencyPhone;
      if (details.agencyEmail) patch.agencyEmail = details.agencyEmail;
      if (details.images?.length) patch.images = details.images;
      if (details.directVerified) patch.directVerified = true;
      updateListingData(id, patch);
      return { description: details.description ?? listing.description };
    }
    return { description: listing.description };
  },
};

export async function dispatch(method, payload = {}) {
  const handler = Object.hasOwn(handlers, method) ? handlers[method] : null;
  if (!handler) throw new ApiError(`unknown method ${method}`);
  return handler(payload ?? {});
}

export function staleSearches(minutes, now = Date.now()) {
  if (!minutes) return [];
  return listSearches().filter((s) => !s.lastScanAt || now - Date.parse(s.lastScanAt) >= minutes * 60 * 1000);
}
