import { clusters, groupsFromClusters } from './dedup.js';
import { groupCategories } from './categories.js';
import { getGroupCache, putGroupCache, querySearchListings } from './db.js';

const CACHE_FORMAT = 1;

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

export function relatedHistory(listings, removed, found = null) {
  const related = new Map();
  if (!removed.length) return related;
  const everything = [...listings, ...removed];
  for (const cluster of found ?? clusters(everything)) {
    const all = cluster.map((i) => everything[i]);
    if (!all.some((l) => l.removed)) continue;
    for (const l of all) if (!l.removed) related.set(l.id, all);
  }
  return related;
}

const dates = (m) => m && { source: m.source, publishedAt: m.publishedAt ?? null, firstSeen: m.firstSeen ?? null };

export async function computeGroups(searchId, prefs) {
  const { listings, removed, histories } = await querySearchListings(searchId, prefs);
  const byId = new Map(listings.map((l) => [l.id, l]));
  const related = relatedHistory(listings, removed);
  return groupsFromClusters(listings, clusters(listings)).map((g) => {
    const members = g.sources.map((s) => byId.get(s.id));
    return {
      group: {
        ...g,
        sources: g.sources.map((s) => ({ ...s, priceHistory: histories.get(s.id) ?? null })),
        categories: groupCategories(members),
        priceChange: priceChange(g, histories),
      },
      history: [...members, ...members.flatMap((m) => related.get(m?.id) ?? [])].map(dates),
    };
  });
}

export async function cachedGroups(searchId, prefs, version, persist) {
  const key = JSON.stringify(prefs);
  const hit = await getGroupCache(searchId);
  if (hit?.format === CACHE_FORMAT && hit.version === version && hit.prefs === key) return hit.groups;
  const groups = await computeGroups(searchId, prefs);
  if (persist) await putGroupCache(searchId, { format: CACHE_FORMAT, version, prefs: key, groups }).catch(() => {});
  return groups;
}
