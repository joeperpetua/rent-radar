import { SOURCES } from './sources/index.js';
import { CATEGORIES, passesCategories } from './categories.js';
import { cachedGroups } from './groups.js';
import { effectivePrefs, isScannable, scrapeScope } from './prefs.js';
import { dataVersion, getRuns, getSearch, getStoredListings, initialScanAt, saveScan, saveSourceResult } from './db.js';

export { SOURCES };
export { relatedHistory } from './groups.js';

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

const pendingGroups = new Map();
let groupsWorker = null;
let nextRequest = 0;

function spawnGroupsWorker() {
  if (groupsWorker !== null) return groupsWorker;
  const fail = () => {
    groupsWorker?.terminate();
    groupsWorker = false;
    for (const { resolve, run } of pendingGroups.values()) resolve(run());
    pendingGroups.clear();
  };
  try {
    groupsWorker = new Worker(new URL('./groupsWorker.js', import.meta.url), { type: 'module' });
    groupsWorker.onmessage = ({ data }) => {
      const request = pendingGroups.get(data.id);
      pendingGroups.delete(data.id);
      request?.resolve(data.error ? request.run() : data.result);
    };
    groupsWorker.onerror = fail;
    groupsWorker.onmessageerror = fail;
  } catch {
    groupsWorker = false;
  }
  return groupsWorker;
}

function groupsOf(search, version) {
  const prefs = { ...effectivePrefs(search.prefs), districts: null };
  const persist = !isBusy(search.id);
  const run = () => cachedGroups(search.id, prefs, version, persist);
  const worker = typeof Worker === 'function' && spawnGroupsWorker();
  if (!worker) return run();
  const id = nextRequest++;
  return new Promise((resolve) => {
    pendingGroups.set(id, { resolve, run });
    worker.postMessage({ id, searchId: search.id, prefs, version, persist });
  });
}

async function dedupedGroups(search) {
  const version = await dataVersion();
  const key = String(search.id);
  let entry = groupCache.get(key);
  if (entry?.version !== version) {
    entry = { version, data: groupsOf(search, version) };
    const failed = entry;
    entry.data.catch(() => {
      if (groupCache.get(key) === failed) groupCache.delete(key);
    });
  }
  groupCache.delete(key);
  groupCache.set(key, entry);
  if (groupCache.size > GROUP_CACHE_SIZE) groupCache.delete(groupCache.keys().next().value);
  return entry.data;
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
  const cached = await dedupedGroups(search);
  const inDistricts = cached.filter(({ group: g }) => g.price != null && g.price > 0 && (prefs.districts == null || !prefs.districts.length || g.state !== 'wien' || prefs.districts.includes(g.district)));
  const all = inDistricts.map(({ group, history }) => {
    const listed = listedAt(history, initialAt);
    return { ...group, isNew: isNew(listed, now), listedAt: listed };
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
