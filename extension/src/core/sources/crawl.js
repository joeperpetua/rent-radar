import { fetchText } from '../http.js';
import { districtFromPostcode, findPostcode, stateFromPostcode } from '../geo.js';
import { PARSER_VERSION } from './directParser.js';

export const MAX_PAGES = 40;

export async function pMap(items, concurrency, fn) {
  const results = [];
  let index = 0;
  const workers = Array.from({ length: Math.min(items.length, concurrency) }, async () => {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results.filter(Boolean);
}

export const maxNumber = (html, pattern) => [...html.matchAll(pattern)]
  .map((m) => Number(m[1]))
  .filter(Number.isFinite)
  .reduce((a, b) => Math.max(a, b), 1);

export async function fetchPages(site, tag) {
  const get = (n) => fetchText(site.pageUrl(n), { retries: 1, timeout: 10000 });
  const first = await get(1);
  const last = Math.min(site.lastPage ? site.lastPage(first) : 1, MAX_PAGES);
  const rest = await pMap(Array.from({ length: last - 1 }, (_, i) => i + 2), 4, async (n) => {
    try {
      return await get(n);
    } catch (err) {
      console.warn(`[${tag}] ${site.name} page ${n} failed:`, err?.message);
      return null;
    }
  });
  return [first, ...rest];
}

export function locate({ postcode, city, street, text }) {
  const pc = postcode ? String(postcode) : findPostcode(text);
  const state = stateFromPostcode(pc);
  const district = state === 'wien' ? districtFromPostcode(pc) : null;
  const town = (city || '').replace(/\s*\d+\.?\s*,.*$/, '').replace(/,.*$/, '').trim() || (state === 'wien' ? 'Wien' : null);
  const address = [street, [pc, town].filter(Boolean).join(' ')].filter(Boolean).join(', ') || null;
  return { postcode: pc ?? null, state, district, city: town, address };
}

export const stateQuery = (prefs, ids) => (prefs?.states?.length ? prefs.states : Object.keys(ids)).filter((s) => ids[s] != null);

export function outOfScope({ postcode, price }, prefs) {
  const state = stateFromPostcode(postcode);
  if (state && prefs?.states?.length && !prefs.states.includes(state)) return true;
  if (state === 'wien' && prefs?.districts?.length) {
    const district = districtFromPostcode(postcode);
    if (district && !prefs.districts.includes(district)) return true;
  }
  return Boolean(prefs?.maxPrice && price && price > prefs.maxPrice);
}

export function reusable(known) {
  if (!known || known.parserVersion !== PARSER_VERSION || known.forSale == null) return false;
  return !(known.postcode === '1010' && (known.address === 'Wien' || !known.address));
}

export function applyPrefs(listings, prefs) {
  let filtered = listings.filter((l) => l && l.price != null && l.price > 0);
  if (prefs?.states?.length) filtered = filtered.filter((l) => l.state && prefs.states.includes(l.state));
  if (prefs?.districts?.length) filtered = filtered.filter((l) => l.state !== 'wien' || (l.district && prefs.districts.includes(l.district)));
  if (prefs?.minPrice) filtered = filtered.filter((l) => l.price >= prefs.minPrice);
  if (prefs?.maxPrice) filtered = filtered.filter((l) => l.price <= prefs.maxPrice);
  if (prefs?.minArea) filtered = filtered.filter((l) => l.area == null || l.area >= prefs.minArea);
  if (prefs?.maxArea) filtered = filtered.filter((l) => l.area == null || l.area <= prefs.maxArea);
  if (prefs?.minRooms) filtered = filtered.filter((l) => l.rooms == null || l.rooms >= prefs.minRooms);
  if (prefs?.maxRooms) filtered = filtered.filter((l) => l.rooms == null || l.rooms <= prefs.maxRooms);
  return filtered;
}
