import { SOURCES } from './sources/index.js';
import { dedupe } from './dedup.js';
import { CATEGORIES, groupCategories, passesCategories } from './categories.js';
import { effectivePrefs, isScannable, scrapeScope } from './prefs.js';
import { dataVersion, getChangedPriceHistories, getRuns, getSearch, getStoredListings, initialScanAt, queryListings, queryRemovedListings, saveScan, saveSourceResult } from './db.js';

export { SOURCES };

const NEW_WINDOW_MS = 24 * 60 * 60 * 1000;
const GROUP_CACHE_SIZE = 16;

const queue = [];
const listeners = new Set();
const groupCache = new Map();
let running = null;
let progress = null;

const notify = () => listeners.forEach((fn) => fn());

export function onScanChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const scanStatus = () => ({ running: running?.searchId ?? null, queue: [...queue], progress });

export const isBusy = (searchId) => running?.searchId === searchId || queue.includes(searchId);

export async function runScan(search, log = console.log) {
  const prefs = effectivePrefs(search.prefs);
  const active = isScannable(search.prefs) ? prefs.sources.filter((s) => SOURCES[s]) : [];
  progress = {
    searchId: search.id,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    sources: Object.fromEntries(active.map((key) => [key, { state: 'running', count: 0, error: null, ms: null }])),
  };
  notify();
  const results = await Promise.all(active.map(async (key) => {
    const started = Date.now();
    const entry = progress.sources[key];
    try {
      const result = await SOURCES[key].search(prefs, {
        onProgress: (count) => { entry.count = count; notify(); },
        stored: await getStoredListings(key),
      });
      const { listings, partial = false } = Array.isArray(result) ? { listings: result } : result;
      const ms = Date.now() - started;
      const done = { key, listings, partial, ms, written: false };
      try {
        done.written = await saveSourceResult({ searchId: search.id, startedAt: progress.startedAt, result: done });
      } catch (err) {
        log(`[scan] #${search.id} ${key} save deferred: ${err.message}`);
      }
      Object.assign(entry, { state: 'done', count: listings.length, ms, saved: done.written });
      log(`[scan] #${search.id} ${key}: ${listings.length} listings in ${ms}ms${partial ? ' (partial)' : ''}`);
      return done;
    } catch (error) {
      Object.assign(entry, { state: 'error', error: error.message, ms: Date.now() - started });
      log(`[scan] #${search.id} ${key} failed: ${error.message}`);
      return { key, error: error.message, ms: entry.ms };
    } finally {
      notify();
    }
  }));
  if (await getSearch(search.id)) await saveScan({ searchId: search.id, startedAt: progress.startedAt, results, scope: scrapeScope(search.prefs) });
  progress.finishedAt = new Date().toISOString();
}

async function drain(log) {
  while (queue.length) {
    const searchId = queue.shift();
    const search = await getSearch(searchId);
    if (!search) continue;
    running = { searchId };
    try {
      await runScan(search, log);
    } catch (err) {
      log(`[scan] #${searchId} fatal: ${err.stack ?? err.message}`);
    } finally {
      running = null;
      notify();
    }
  }
}

export function enqueueScan(searchId, log = console.log) {
  if (isBusy(searchId)) return false;
  queue.push(searchId);
  if (!running) {
    running = { searchId: null };
    drain(log);
  }
  notify();
  return true;
}

export function cancelQueued(searchId) {
  const i = queue.indexOf(searchId);
  if (i >= 0) queue.splice(i, 1);
  notify();
}

async function dedupedGroups(search) {
  const version = await dataVersion();
  const key = String(search.id);
  let entry = groupCache.get(key);
  if (entry?.version !== version) {
    const prefs = { ...effectivePrefs(search.prefs), districts: null };
    const listings = await queryListings(search.id, prefs);
    const removed = await queryRemovedListings(search.id, prefs);
    entry = {
      version,
      groups: dedupe(listings),
      byId: new Map(listings.map((l) => [l.id, l])),
      related: relatedHistory(listings, removed),
      histories: await getChangedPriceHistories(search.id),
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

export function relatedHistory(listings, removed) {
  const related = new Map();
  if (!removed.length) return related;
  const everything = [...listings, ...removed];
  const byId = new Map(everything.map((l) => [l.id, l]));
  for (const g of dedupe(everything)) {
    const all = g.sources.map((s) => byId.get(s.id)).filter(Boolean);
    if (!all.some((l) => l.removed)) continue;
    for (const l of all) if (!l.removed) related.set(l.id, all);
  }
  return related;
}

export function listedAt(members, initialAt) {
  const known = members.filter(Boolean);
  const published = known.map((m) => m.publishedAt).filter(Boolean).sort()[0];
  const seen = known.filter((m) => m.firstSeen).sort((a, b) => a.firstSeen.localeCompare(b.firstSeen))[0];
  if (published) return seen && seen.firstSeen < published ? seen.firstSeen : published;
  if (!seen) return null;
  const initial = initialAt[seen.source];
  return initial && seen.firstSeen > initial ? seen.firstSeen : null;
}

const isNew = (listed, now) => Boolean(listed) && now - Date.parse(listed) < NEW_WINDOW_MS;

export function emptyView(searchId = null) {
  return { searchId, groups: [], categoryCounts: {}, stats: { listings: 0, groups: 0, merged: 0 }, runs: {}, lastScanAt: null };
}

export async function buildView(search) {
  const now = Date.now();
  const prefs = effectivePrefs(search.prefs);
  const initialAt = await initialScanAt(search.id);
  const { groups: cached, byId, related, histories } = await dedupedGroups(search);
  const inDistricts = cached.filter((g) => g.price != null && g.price > 0 && (prefs.districts == null || !prefs.districts.length || g.state !== 'wien' || prefs.districts.includes(g.district)));
  const all = inDistricts.map((g) => {
    const members = g.sources.map((s) => byId.get(s.id));
    const listed = listedAt([...members, ...members.flatMap((m) => related.get(m?.id) ?? [])], initialAt);
    return {
      ...g,
      sources: g.sources.map((s) => ({ ...s, priceHistory: histories.get(s.id) ?? null })),
      categories: groupCategories(members),
      isNew: isNew(listed, now),
      listedAt: listed,
      priceChange: priceChange(g, histories),
    };
  });
  const categoryCounts = Object.fromEntries(CATEGORIES.map((c) => [c, all.filter((g) => g.categories.includes(c)).length]));
  const groups = all.filter((g) => passesCategories(g.categories, prefs.categories));
  const shown = groups.reduce((n, g) => n + g.sources.length, 0);
  return {
    searchId: search.id,
    groups,
    categoryCounts,
    stats: { listings: shown, groups: groups.length, merged: shown - groups.length },
    runs: await getRuns(search.id),
    lastScanAt: search.lastScanAt,
  };
}
