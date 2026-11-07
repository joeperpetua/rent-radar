import { fetchText } from '../http.js';
import { cityFromAddress, districtFromPostcode, findPostcode, stateFromPostcode } from '../geo.js';
import { parseDirectListing } from './directParser.js';

export const id = 'fify';
export const label = 'Fify Makler';

const BROKERS = [
  {
    name: 'Realbrokers',
    host: 'realbrokers.at',
    searchUrl: 'https://www.realbrokers.at/de/immobilien?f%5BbuyRentAll%5D=rent',
  },
  {
    name: 'Edlauer',
    host: 'edlauer.com',
    searchUrl: 'https://www.edlauer.com/de/immobilien?f%5BbuyRentAll%5D=rent',
  },
];

async function pMap(items, concurrency, fn) {
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

export async function fetchBrokerLinks(broker, maxPages = 2) {
  const links = new Set();
  for (let page = 1; page <= maxPages; page++) {
    const url = page === 1 ? broker.searchUrl : `${broker.searchUrl}&page=${page}`;
    try {
      const html = await fetchText(url, { retries: 1, timeout: 8000 });
      const matches = [...html.matchAll(/href="([^"]*\/immobilie\/[^"]*)"/gi)].map((m) => {
        const h = m[1].replace(/&amp;/g, '&');
        return h.startsWith('http') ? h : `https://www.${broker.host}${h}`;
      });
      if (matches.length === 0) break;
      let newFound = 0;
      for (const m of matches) {
        if (!links.has(m)) {
          links.add(m);
          newFound++;
        }
      }
      if (newFound === 0) break;
    } catch (err) {
      console.warn(`[fify] ${broker.name} page ${page} failed:`, err?.message);
      break;
    }
  }
  return [...links];
}

export async function search(prefs, { onProgress = () => {}, stored } = {}) {
  const allLinks = [];
  for (const broker of BROKERS) {
    const links = await fetchBrokerLinks(broker);
    for (const url of links) allLinks.push({ broker, url });
  }

  let count = 0;
  const listings = await pMap(allLinks, 4, async ({ broker, url }) => {
    try {
      const u = new URL(url);
      const host = u.hostname.replace(/^www\./i, '');
      const slug = u.pathname.replace(/\/$/, '').split('/').pop();
      const listingId = `fify:${broker.host}_${slug}`;

      const known = stored?.get(listingId);
      if (known) {
        const isCorruptedDefault = known.postcode === '1010' && (known.address === 'Wien' || !known.address);
        const needsSaleCheck = known.forSale == null;
        if (!isCorruptedDefault && !needsSaleCheck) {
          if (known.forSale || known.price == null || known.price <= 0) return null;
          count++;
          onProgress(count);
          return known;
        }
      }

      const pageHtml = await fetchText(url, { retries: 1, timeout: 8000 });
      const parsed = parseDirectListing(pageHtml, url);
      if (parsed.inactive || parsed.forSale || parsed.price == null || parsed.price <= 0) return null;

      const title = (pageHtml.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || `${broker.name} Objekt`)
        .replace(/\s*-\s*(?:Realbrokers|Edlauer).*$/i, '')
        .replace(/\s+/g, ' ')
        .trim();

      const postcode = findPostcode(parsed.address) || findPostcode(parsed.description) || findPostcode(title);
      const state = stateFromPostcode(postcode);
      const district = state === 'wien' ? districtFromPostcode(postcode) : null;
      const city = cityFromAddress(parsed.address) || (state === 'wien' ? 'Wien' : null);
      const address = parsed.address || [postcode, city].filter(Boolean).join(' ') || null;

      count++;
      onProgress(count);

      return {
        id: listingId,
        source: 'fify',
        sourceId: `${broker.host}_${slug}`,
        type: 'apartment',
        forSale: false,
        url,
        title,
        price: parsed.price,
        area: parsed.area,
        rooms: parsed.rooms,
        deposit: parsed.deposit,
        postcode,
        state,
        city,
        district,
        address,
        lat: parsed.lat ?? null,
        lng: parsed.lng ?? null,
        images: parsed.images || [],
        description: parsed.description,
        sourceUrl: url,
        sourceHost: host,
        publishedAt: null,
        isPrivate: false,
        agency: parsed.agency || broker.name,
        agencyPhone: parsed.agencyPhone || null,
        agencyEmail: parsed.agencyEmail || null,
        floor: null,
        extras: [],
      };
    } catch {
      return null;
    }
  });

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
