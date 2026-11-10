import { CATEGORIES } from './categories.js';
import { STATES } from './geo.js';

export const PROPERTY_TYPES = ['apartment', 'house'];
export const SOURCE_IDS = ['willhaben', 'immoscout', 'cooperatives', 'justimmo', 'wunderflats', 'fify'];
export const NEW_SOURCES = ['cooperatives', 'justimmo', 'wunderflats', 'fify'];
const STATE_IDS = STATES.map((s) => s.id);
const RANGES = [['minPrice', 'maxPrice'], ['minArea', 'maxArea'], ['minRooms', 'maxRooms']];
export const SCRAPE_KEYS = ['states', 'types', 'sources', ...RANGES.flat()];
const MAX_NAME_LENGTH = 80;

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

export const scrapeScope = (prefs) => Object.fromEntries(SCRAPE_KEYS.map((k) => [k, prefs[k]]));

const upper = (v) => v || Infinity;

function statesCovered(wanted, scanned) {
  if (!scanned.length) return true;
  return wanted.length > 0 && wanted.every((s) => scanned.includes(s));
}

export function needsRescan(prefs, last) {
  if (!last) return true;
  if (!statesCovered(prefs.states, last.states)) return true;
  if (prefs.types.some((t) => !last.types.includes(t))) return true;
  if (prefs.sources.some((s) => !last.sources.includes(s))) return true;
  return prefs.minPrice < last.minPrice
    || upper(prefs.maxPrice) > upper(last.maxPrice)
    || prefs.minArea < last.minArea
    || upper(prefs.maxArea) > upper(last.maxArea)
    || prefs.minRooms < last.minRooms
    || upper(prefs.maxRooms) > upper(last.maxRooms);
}

export function sanitizeName(name) {
  const trimmed = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
  return trimmed || null;
}

export function sanitizePrefs(input = {}) {
  const int = (v, min, max, def) => {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
  };
  const list = (v) => (Array.isArray(v) ? v : null);
  const types = (list(input.types) ?? DEFAULT_PREFS.types).filter((t) => PROPERTY_TYPES.includes(t));
  const categories = (list(input.categories) ?? CATEGORIES).filter((c) => CATEGORIES.includes(c));
  const picked = [...new Set((list(input.states) ?? []).filter((s) => STATE_IDS.includes(s)))];
  const states = picked.length === STATE_IDS.length ? [] : picked;
  const districts = [...new Set((list(input.districts) ?? []).map(Number).filter((d) => d >= 1 && d <= 23))].sort((a, b) => a - b);
  let rawSources = list(input.sources);
  if (rawSources && rawSources.length > 0) {
    if (rawSources.includes('rentola') || (rawSources.includes('willhaben') && rawSources.includes('immoscout') && !NEW_SOURCES.some((s) => rawSources.includes(s)))) {
      rawSources = [...rawSources.filter((s) => s !== 'rentola'), ...NEW_SOURCES];
    }
  }
  const sources = (rawSources ?? SOURCE_IDS).filter((s) => SOURCE_IDS.includes(s));
  const pair = (minKey, maxKey, limit) => {
    const min = int(input[minKey], 0, limit, 0);
    const max = int(input[maxKey], 0, limit, 0);
    return max && max < min ? { [minKey]: max, [maxKey]: min } : { [minKey]: min, [maxKey]: max };
  };
  return {
    states,
    districts: (!states.length || states.includes('wien')) && districts.length < 23 ? districts : [],
    types: types.length ? types : DEFAULT_PREFS.types,
    categories: categories.length ? categories : CATEGORIES,
    ...pair('minPrice', 'maxPrice', 100000),
    ...pair('minArea', 'maxArea', 10000),
    ...pair('minRooms', 'maxRooms', 50),
    sources: sources.length ? sources : SOURCE_IDS,
  };
}
