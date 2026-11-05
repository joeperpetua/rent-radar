import { CATEGORIES } from './categories.js';
import { STATES } from './geo.js';

export const PROPERTY_TYPES = ['apartment', 'house'];
export const SOURCE_IDS = ['willhaben', 'immoscout', 'rentola'];
const STATE_IDS = STATES.map((s) => s.id);
const RANGES = [['minPrice', 'maxPrice'], ['minArea', 'maxArea'], ['minRooms', 'maxRooms']];
export const SCRAPE_KEYS = ['states', 'types', 'sources', ...RANGES.flat()];
const MAX_NAME_LENGTH = 80;

export const DEFAULT_PREFS = {
  states: [],
  districts: [],
  types: [],
  categories: [],
  minPrice: 0,
  maxPrice: 0,
  minArea: 0,
  maxArea: 0,
  minRooms: 0,
  maxRooms: 0,
  sources: SOURCE_IDS,
};

const DISTRICT_COUNT = 23;
const ALL_DISTRICTS = Array.from({ length: DISTRICT_COUNT }, (_, i) => i + 1);
const REQUIRED_GROUPS = ['states', 'types', 'categories', 'sources'];

export function effectivePrefs(prefs) {
  const allStates = prefs.states.length === STATE_IDS.length;
  const vienna = allStates || prefs.states.includes('wien');
  return {
    ...prefs,
    states: allStates ? null : prefs.states,
    districts: !vienna || prefs.districts.length === DISTRICT_COUNT ? null : prefs.districts,
  };
}

export const isScannable = (prefs) => prefs.states.length > 0 && prefs.types.length > 0 && prefs.sources.length > 0;

export function missingGroups(prefs) {
  const missing = REQUIRED_GROUPS.filter((key) => !prefs[key]?.length);
  if (prefs.states?.includes('wien') && !prefs.districts?.length) missing.push('districts');
  return missing;
}

export function fillUnspecified(prefs) {
  const states = prefs.states.length ? prefs.states : STATE_IDS;
  return {
    ...prefs,
    states,
    districts: states.includes('wien') && !prefs.districts.length ? ALL_DISTRICTS : prefs.districts,
    types: prefs.types.length ? prefs.types : PROPERTY_TYPES,
    categories: prefs.categories.length ? prefs.categories : CATEGORIES,
    sources: prefs.sources.length ? prefs.sources : SOURCE_IDS,
  };
}

export const scrapeScope = (prefs) => {
  const effective = effectivePrefs(prefs);
  return Object.fromEntries(SCRAPE_KEYS.map((k) => [k, effective[k]]));
};

const upper = (v) => v || Infinity;

function statesCovered(wanted, scanned) {
  if (!scanned?.length) return true;
  if (wanted == null) return false;
  return wanted.every((s) => scanned.includes(s));
}

export function needsRescan(picked, last) {
  if (!last) return true;
  const prefs = effectivePrefs(picked);
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
  const pick = (value, allowed) => [...new Set((list(value) ?? []).filter((v) => allowed.includes(v)))];
  const states = pick(input.states, STATE_IDS);
  const districts = [...new Set((list(input.districts) ?? []).map(Number).filter((d) => d >= 1 && d <= DISTRICT_COUNT))].sort((a, b) => a - b);
  const pair = (minKey, maxKey, limit) => {
    const min = int(input[minKey], 0, limit, 0);
    const max = int(input[maxKey], 0, limit, 0);
    return max && max < min ? { [minKey]: max, [maxKey]: min } : { [minKey]: min, [maxKey]: max };
  };
  return {
    states,
    districts: states.includes('wien') ? districts : [],
    types: pick(input.types, PROPERTY_TYPES),
    categories: pick(input.categories, CATEGORIES),
    ...pair('minPrice', 'maxPrice', 100000),
    ...pair('minArea', 'maxArea', 10000),
    ...pair('minRooms', 'maxRooms', 50),
    sources: list(input.sources) ? pick(input.sources, SOURCE_IDS) : DEFAULT_PREFS.sources,
  };
}
