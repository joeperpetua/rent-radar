import * as willhaben from './sources/willhaben.js';
import * as immoscout from './sources/immoscout.js';
import * as rentola from './sources/rentola.js';
import { dedupe } from './dedup.js';
import { CATEGORIES, groupCategories, passesCategories } from './categories.js';
import { SCRAPE_KEYS, scrapeKey } from './prefs.js';
import { dataVersion, getChangedPriceHistories, getMeta, getRuns, getStoredListings, queryListings, saveScrape } from './db.js';

export const SOURCES = { willhaben, immoscout, rentola };

const NEW_WINDOW_MS = 24 * 60 * 60 * 1000;

let running = null;
let progress = null;
const GROUP_CACHE_SIZE = 16;
const groupCache = new Map();

export const isRunning = () => running != null;

const upper = (v) => v || Infinity;

function statesCovered(wanted, scraped) {
  if (!scraped.length) return true;
  return wanted.length > 0 && wanted.every((s) => scraped.includes(s));
}

export function needsRescrape(prefs) {
  const last = getMeta('last_run_scope');
  if (!last?.types || !last?.sources) return true;
  if (!statesCovered(prefs.states, last.states ?? ['wien'])) return true;
  if (prefs.types.some((t) => !last.types.includes(t))) return true;
  if (prefs.sources.some((s) => !last.sources.includes(s))) return true;
  return prefs.minPrice < (last.minPrice ?? 0)
    || upper(prefs.maxPrice) > upper(last.maxPrice)
    || prefs.minArea < (last.minArea ?? 0)
    || upper(prefs.maxArea) > upper(last.maxArea)
    || prefs.minRooms < (last.minRooms ?? 0)
    || upper(prefs.maxRooms) > upper(last.maxRooms);
}

export function runScrape(prefs, log = console.log) {
  running ??= (async () => {
    const active = prefs.sources.filter((s) => SOURCES[s]);
    progress = {
      startedAt: new Date().toISOString(),
      finishedAt: null,
      sources: Object.fromEntries(active.map((key) => [key, { state: 'running', count: 0, error: null, ms: null }])),
    };
    try {
      const results = await Promise.all(active.map(async (key) => {
        const started = Date.now();
        const entry = progress.sources[key];
        try {
          const result = await SOURCES[key].search(prefs, {
            onProgress: (count) => { entry.count = count; },
            stored: getStoredListings(key),
          });
          const { listings, partial = false } = Array.isArray(result) ? { listings: result } : result;
          Object.assign(entry, { state: 'done', count: listings.length, ms: Date.now() - started });
          log(`[scrape] ${key}: ${listings.length} listings in ${entry.ms}ms${partial ? ' (partial)' : ''}`);
          return { key, listings, partial, ms: entry.ms };
        } catch (error) {
          Object.assign(entry, { state: 'error', error: error.message, ms: Date.now() - started });
          log(`[scrape] ${key} failed: ${error.message}`);
          return { key, error: error.message, ms: entry.ms };
        }
      }));
      saveScrape({ startedAt: progress.startedAt, results, scope: Object.fromEntries(SCRAPE_KEYS.map((k) => [k, prefs[k]])) });
    } finally {
      progress.finishedAt = new Date().toISOString();
      running = null;
    }
  })();
  return running;
}

function dedupedGroups(prefs) {
  const version = dataVersion();
  const key = scrapeKey(prefs);
  let entry = groupCache.get(key);
  if (entry?.version !== version) {
    const listings = queryListings({ ...prefs, districts: [] });
    entry = {
      version,
      groups: dedupe(listings),
      byId: new Map(listings.map((l) => [l.id, l])),
      histories: getChangedPriceHistories(),
    };
  }
  groupCache.delete(key);
  groupCache.set(key, entry);
  if (groupCache.size > GROUP_CACHE_SIZE) groupCache.delete(groupCache.keys().next().value);
  return entry;
}

function priceChange(group, histories) {
  for (const s of group.sources) {
    const history = histories.get(s.id);
    if (!history || history.at(-1).price !== s.price) continue;
    const previous = history.at(-2).price;
    const current = history.at(-1).price;
    return {
      source: s.source,
      previous,
      current,
      delta: Math.round((current - previous) * 100) / 100,
      pct: Math.round(((current - previous) / previous) * 1000) / 10,
      at: history.at(-1).at,
    };
  }
  return null;
}

function isNew(listing, initialRunAt, now) {
  const initial = initialRunAt[listing.source];
  const discovered = initial && listing.firstSeen > initial && now - Date.parse(listing.firstSeen) < NEW_WINDOW_MS;
  const published = listing.publishedAt && now - Date.parse(listing.publishedAt) < NEW_WINDOW_MS;
  return Boolean(discovered || published);
}

export function buildStatus() {
  return { running: isRunning(), progress, runs: getRuns(), lastRun: getMeta('last_run') };
}

export function emptyView() {
  return { groups: [], categoryCounts: {}, stats: { listings: 0, groups: 0, merged: 0 }, ...buildStatus() };
}

export function buildView(prefs) {
  const now = Date.now();
  const initialRunAt = getMeta('initial_run_at', {});
  const { groups: cached, byId, histories } = dedupedGroups(prefs);
  const inDistricts = cached.filter((g) => !prefs.districts.length || g.state !== 'wien' || prefs.districts.includes(g.district));
  const all = inDistricts.map((g) => {
    const members = g.sources.map((s) => byId.get(s.id));
    return {
      ...g,
      sources: g.sources.map((s) => ({ ...s, priceHistory: histories.get(s.id) ?? null })),
      categories: groupCategories(members),
      isNew: members.some((m) => isNew(m, initialRunAt, now)),
      priceChange: priceChange(g, histories),
    };
  });
  const categoryCounts = Object.fromEntries(CATEGORIES.map((c) => [c, all.filter((g) => g.categories.includes(c)).length]));
  const groups = all.filter((g) => passesCategories(g.categories, prefs.categories));
  const shown = groups.reduce((n, g) => n + g.sources.length, 0);
  return {
    groups,
    categoryCounts,
    stats: { listings: shown, groups: groups.length, merged: shown - groups.length },
    ...buildStatus(),
  };
}
