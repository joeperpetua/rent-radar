import { fetchText } from '../http.js';
import { districtFromPostcode, findPostcode, stateFromPostcode, toNumber } from '../geo.js';

export const id = 'wunderflats';
export const label = 'Wunderflats';

const BASE = 'https://wunderflats.com';

export function parseListings(html) {
  const allScripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
  for (const s of allScripts) {
    if (!s[1].includes('listingResults')) continue;
    try {
      const obj = JSON.parse(s[1]);
      const items = obj.pageData?.listingResults?.items;
      if (Array.isArray(items)) {
        return items.map((item) => {
          const street = item.address?.street || '';
          const city = item.address?.city?.replace(/^Vienna$/i, 'Wien') || 'Wien';
          const address = [street, city].filter(Boolean).join(', ');
          const postcode = findPostcode(address) || (city === 'Wien' ? '1010' : null);
          const state = stateFromPostcode(postcode) || 'wien';
          const district = state === 'wien' ? districtFromPostcode(postcode) : null;
          const urlSlug = (item.title?.en || item.title?.de || 'apartment')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-|-$)/g, '');
          const url = `${BASE}/en/furnished-apartment/${urlSlug}/${item._id}`;
          const images = (item.images || [])
            .map((i) => i.urls?.large || i.urls?.original || i.urls?.medium)
            .filter(Boolean);

          const price = item.price ? Math.round(item.price / 100) : null;
          const area = toNumber(item.area);
          const rooms = toNumber(item.rooms);

          return {
            id: `wunderflats:${item._id}`,
            source: 'wunderflats',
            sourceId: item._id,
            type: 'apartment',
            url,
            title: item.title?.de || item.title?.en || 'Möblierte Wohnung',
            price,
            area,
            rooms,
            postcode,
            state,
            city,
            district,
            address,
            lat: toNumber(item.address?.location?.coordinates?.[1]),
            lng: toNumber(item.address?.location?.coordinates?.[0]),
            images,
            description: null,
            sourceUrl: url,
            sourceHost: 'wunderflats.com',
            publishedAt: item.availableFrom || null,
            isPrivate: false,
            agency: 'Wunderflats',
            deposit: price,
            floor: item.floor != null ? String(item.floor) : null,
            extras: item.amenities?.elevator ? ['Aufzug'] : [],
          };
        }).filter((l) => l && l.price != null && l.price > 0);
      }
    } catch {}
  }
  return [];
}

export async function search(prefs, { onProgress = () => {}, stored } = {}) {
  // Wunderflats operates primarily in Vienna for Austria
  const states = prefs?.states || [];
  if (states.length > 0 && !states.includes('wien')) {
    return [];
  }

  try {
    const html = await fetchText(`${BASE}/en/furnished-apartments/vienna`, { retries: 1 });
    let listings = parseListings(html).filter((l) => l && l.price != null && l.price > 0);

    if (prefs?.minPrice) listings = listings.filter((l) => l.price >= prefs.minPrice);
    if (prefs?.maxPrice) listings = listings.filter((l) => l.price <= prefs.maxPrice);
    if (prefs?.minArea) listings = listings.filter((l) => l.area == null || l.area >= prefs.minArea);
    if (prefs?.maxArea) listings = listings.filter((l) => l.area == null || l.area <= prefs.maxArea);
    if (prefs?.minRooms) listings = listings.filter((l) => l.rooms == null || l.rooms >= prefs.minRooms);
    if (prefs?.maxRooms) listings = listings.filter((l) => l.rooms == null || l.rooms <= prefs.maxRooms);

    onProgress(listings.length);
    return listings;
  } catch (err) {
    console.warn('[wunderflats] search failed:', err?.message);
    return [];
  }
}
