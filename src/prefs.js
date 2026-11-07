import { CATEGORIES } from './categories.js';
import { allUserPrefs, deleteMeta, getMeta, getUserPrefs, guestSearches, setUserPrefs, touchGuestSearch } from './db.js';
import { STATES } from './geo.js';

export const PROPERTY_TYPES = ['apartment', 'house'];
const STATE_IDS = STATES.map((s) => s.id);
const RANGES = [['minPrice', 'maxPrice'], ['minArea', 'maxArea'], ['minRooms', 'maxRooms']];
export const SCRAPE_KEYS = ['states', 'types', 'sources', ...RANGES.flat()];
const GUEST_SEARCH_MAX_AGE_MS = Number(process.env.GUEST_SEARCH_DAYS ?? 7) * 24 * 60 * 60 * 1000;
const GUEST_SEARCH_MAX_ROWS = 5000;

export const SOURCE_IDS = ['willhaben', 'immoscout', 'cooperatives', 'justimmo', 'wunderflats', 'fify'];
export const NEW_SOURCES = ['cooperatives', 'justimmo', 'wunderflats', 'fify'];

export const DEFAULT_PREFS = {
  states: [],
  districts: [],
  types: PROPERTY_TYPES,
  categories: CATEGORIES,
  minPrice: 0,
  maxPrice: 0,
  minArea: 0,
  maxArea: 0,
  minRooms: 0,
  maxRooms: 0,
  sources: SOURCE_IDS,
};

const withDefaults = (saved) => sanitizePrefs({ ...DEFAULT_PREFS, ...('states' in saved ? {} : { states: ['wien'] }), ...saved });

export const hasSavedSearch = (userId) => getUserPrefs(userId) != null;

export function loadPrefs(userId) {
  const saved = getUserPrefs(userId);
  return saved ? withDefaults(saved) : { ...DEFAULT_PREFS };
}

export function savePrefs(userId, prefs) {
  setUserPrefs(userId, prefs);
}

export function adoptLegacyPrefs(userId) {
  const legacy = getMeta('prefs');
  if (!legacy || allUserPrefs().length) return;
  setUserPrefs(userId, sanitizePrefs(withDefaults(legacy)));
  deleteMeta('prefs');
}

export const scrapeKey = (prefs) => JSON.stringify(SCRAPE_KEYS.map((k) => prefs[k]));

export function rememberGuestSearch(prefs) {
  const scope = Object.fromEntries(SCRAPE_KEYS.map((k) => [k, prefs[k]]));
  touchGuestSearch(scrapeKey(prefs), scope);
}

export function scrapeScope() {
  const guests = GUEST_SEARCH_MAX_AGE_MS > 0 ? guestSearches({ maxAgeMs: GUEST_SEARCH_MAX_AGE_MS, maxRows: GUEST_SEARCH_MAX_ROWS }) : [];
  const searches = [...allUserPrefs(), ...guests].map(withDefaults);
  if (!searches.length) return null;
  const union = (key) => [...new Set(searches.flatMap((p) => p[key]))];
  const scope = {
    states: searches.some((p) => !p.states.length) ? [] : union('states'),
    types: union('types'),
    sources: union('sources'),
  };
  for (const [minKey, maxKey] of RANGES) {
    scope[minKey] = Math.min(...searches.map((p) => p[minKey] || 0));
    scope[maxKey] = searches.some((p) => !p[maxKey]) ? 0 : Math.max(...searches.map((p) => p[maxKey]));
  }
  return scope;
}

export function sanitizePrefs(input) {
  const int = (v, min, max, def) => {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
  };
  const known = SOURCE_IDS;
  const types = (input.types ?? DEFAULT_PREFS.types).filter((t) => PROPERTY_TYPES.includes(t));
  const categories = (input.categories ?? CATEGORIES).filter((c) => CATEGORIES.includes(c));
  const picked = [...new Set((input.states ?? []).filter((s) => STATE_IDS.includes(s)))];
  const states = picked.length === STATE_IDS.length ? [] : picked;
  const districts = [...new Set((input.districts ?? []).map(Number).filter((d) => d >= 1 && d <= 23))].sort((a, b) => a - b);
  const pair = (minKey, maxKey, limit) => {
    const min = int(input[minKey], 0, limit, 0);
    const max = int(input[maxKey], 0, limit, 0);
    return max && max < min ? { [minKey]: max, [maxKey]: min } : { [minKey]: min, [maxKey]: max };
  };
  let rawSources = input.sources;
  if (Array.isArray(rawSources) && rawSources.length > 0) {
    if (rawSources.includes('rentola') || (rawSources.includes('willhaben') && rawSources.includes('immoscout') && !NEW_SOURCES.some((s) => rawSources.includes(s)))) {
      rawSources = [...rawSources.filter((s) => s !== 'rentola'), ...NEW_SOURCES];
    }
  }
  return {
    states,
    districts: (!states.length || states.includes('wien')) && districts.length < 23 ? districts : [],
    types: types.length ? types : DEFAULT_PREFS.types,
    categories: categories.length ? categories : CATEGORIES,
    ...pair('minPrice', 'maxPrice', 100000),
    ...pair('minArea', 'maxArea', 10000),
    ...pair('minRooms', 'maxRooms', 50),
    sources: (rawSources ?? known).filter((s) => known.includes(s)),
  };
}
