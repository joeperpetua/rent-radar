import { CATEGORIES } from './categories.js';
import { districtState, districtsOf, STATES } from './geo.js';

export const PROPERTY_TYPES = ['apartment', 'house'];
export const SOURCE_IDS = ['willhaben', 'immoscout', 'derstandard', 'dibeo', 'findmyhome', 'sn', 'wunderflats', 'immo', 'bwsg', 'oevw', 'nebau'];
export const NEW_SOURCES = SOURCE_IDS.filter((s) => s !== 'willhaben' && s !== 'immoscout');
export const LEGACY_GROUPS = {
  ...Object.fromEntries(['justimmo', 'fify', 'immocontract', 'lebenswert', 'novelreal', 'wohnreich', 'immovent', 'realbrokers', 'edlauer'].map((s) => [s, ['immo']])),
  cooperatives: ['bwsg', 'oevw', 'nebau'],
};

export const expandLegacySources = (sources) => [...new Set(sources.flatMap((s) => LEGACY_GROUPS[s] ?? [s]))];
const PORTALS_V3 = ['willhaben', 'immoscout', 'cooperatives', 'justimmo', 'wunderflats', 'fify'];
const ADDED_V4 = ['derstandard', 'dibeo', 'findmyhome', 'sn'];

export function addV4Sources(prefs) {
  const sources = prefs?.sources ?? [];
  const expanded = expandLegacySources(sources);
  if (!expandLegacySources(PORTALS_V3).every((s) => expanded.includes(s)) || ADDED_V4.some((s) => sources.includes(s))) return prefs;
  return { ...prefs, sources: [...sources, ...ADDED_V4] };
}
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

const DISTRICTS_BY_STATE = new Map(STATE_IDS.map((s) => [s, districtsOf(s)]));
const REQUIRED_GROUPS = ['states', 'types', 'categories', 'sources'];

const pickedIn = (prefs, stateId) => (prefs.districts ?? []).filter((d) => districtState(d) === stateId);

export function effectivePrefs(prefs) {
  const allStates = prefs.states.length === STATE_IDS.length;
  const narrowed = prefs.states.flatMap((s) => {
    const picked = pickedIn(prefs, s);
    return picked.length < DISTRICTS_BY_STATE.get(s).length ? picked : [];
  });
  return {
    ...prefs,
    states: allStates ? null : prefs.states,
    districts: narrowed.length ? narrowed : null,
  };
}

export const isScannable = (prefs) => prefs.states.length > 0 && prefs.types.length > 0 && prefs.sources.length > 0;

export function missingGroups(prefs) {
  const missing = REQUIRED_GROUPS.filter((key) => !prefs[key]?.length);
  if (prefs.states?.some((s) => !pickedIn(prefs, s).length)) missing.push('districts');
  return missing;
}

export function withAllDistricts(prefs) {
  const extra = (prefs.states ?? []).filter((s) => !pickedIn(prefs, s).length).flatMap((s) => DISTRICTS_BY_STATE.get(s) ?? []);
  return extra.length ? { ...prefs, districts: [...(prefs.districts ?? []), ...extra].sort((a, b) => a - b) } : prefs;
}

export function fillUnspecified(prefs) {
  return withAllDistricts({
    ...prefs,
    states: prefs.states.length ? prefs.states : STATE_IDS,
    types: prefs.types.length ? prefs.types : PROPERTY_TYPES,
    categories: prefs.categories.length ? prefs.categories : CATEGORIES,
    sources: prefs.sources.length ? prefs.sources : SOURCE_IDS,
  });
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
  const districts = [...new Set((list(input.districts) ?? []).map(Number).filter((d) => states.includes(districtState(d))))].sort((a, b) => a - b);
  const pair = (minKey, maxKey, limit) => {
    const min = int(input[minKey], 0, limit, 0);
    const max = int(input[maxKey], 0, limit, 0);
    return max && max < min ? { [minKey]: max, [maxKey]: min } : { [minKey]: min, [maxKey]: max };
  };
  let rawSources = list(input.sources);
  if (rawSources) rawSources = expandLegacySources(rawSources);
  if (rawSources && rawSources.length > 0) {
    if (rawSources.includes('rentola') || (rawSources.includes('willhaben') && rawSources.includes('immoscout') && !NEW_SOURCES.some((s) => rawSources.includes(s)))) {
      rawSources = [...rawSources.filter((s) => s !== 'rentola'), ...NEW_SOURCES];
    }
  }
  return {
    states,
    districts,
    types: pick(input.types, PROPERTY_TYPES),
    categories: pick(input.categories, CATEGORIES),
    ...pair('minPrice', 'maxPrice', 100000),
    ...pair('minArea', 'maxArea', 10000),
    ...pair('minRooms', 'maxRooms', 50),
    sources: rawSources ? pick(rawSources, SOURCE_IDS) : DEFAULT_PREFS.sources,
  };
}
