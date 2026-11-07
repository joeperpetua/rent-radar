import { fetchText } from '../http.js';
import { cityFromAddress, districtFromPostcode, findPostcode, stateFromPostcode } from '../geo.js';
import { parseDirectListing } from './directParser.js';

export const id = 'cooperatives';
export const label = 'Genossenschaften';

const SITES = [
  {
    name: 'BWSG',
    phone: '+43 1 546 08-0',
    email: 'office@bwsg.at',
    searchUrl: 'https://www.bwsg.at/immobilien/immobilie-suchen/',
    linkPattern: /href="([^"]*\/objekt\/[^"]*)"/gi,
    resolveUrl: (href) => href,
  },
  {
    name: 'ÖVW',
    phone: '+43 1 908 14 38',
    email: 'wohnen@oevw.at',
    searchUrl: 'https://www.oevw.at/suche/wohnen',
    linkPattern: /href="([^"]*\/suche\/\d+[^"]*)"/gi,
    resolveUrl: (href) => (href.startsWith('http') ? href : `https://www.oevw.at${href}`),
  },
  {
    name: 'NEBAU',
    phone: '+43 2682 65558',
    email: 'office@nebau.at',
    searchUrl: 'https://www.nebau.at/wohnen-immobilien/immobiliensuche/',
    linkPattern: /href="([^"]*\/wohnen-immobilien\/immobiliensuche\/immobilie\/[^"]*)"/gi,
    resolveUrl: (href) => (href.startsWith('http') ? href : `https://www.nebau.at${href}`),
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

export async function fetchSiteLinks(site) {
  try {
    const html = await fetchText(site.searchUrl, { retries: 1, timeout: 8000 });
    const matches = [...html.matchAll(site.linkPattern)].map((m) => site.resolveUrl(m[1]));
    return [...new Set(matches)];
  } catch (err) {
    console.warn(`[cooperatives] ${site.name} search failed:`, err?.message);
    return [];
  }
}

export async function search(prefs, { onProgress = () => {}, stored } = {}) {
  const allLinks = [];
  for (const site of SITES) {
    const links = await fetchSiteLinks(site);
    for (const url of links) allLinks.push({ site, url });
  }

  let count = 0;
  const listings = await pMap(allLinks, 4, async ({ site, url }) => {
    try {
      const u = new URL(url);
      const host = u.hostname.replace(/^www\./i, '');
      const slug = u.pathname.replace(/\/$/, '').split('/').pop();
      const listingId = `cooperatives:${site.name.toLowerCase()}_${slug}`;

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

      const title = (pageHtml.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || `${site.name} Wohnung`)
        .replace(/\s*-\s*(?:BWSG|ÖVW|NEBAU).*$/i, '')
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
        source: 'cooperatives',
        sourceId: `${site.name.toLowerCase()}_${slug}`,
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
        agency: parsed.agency || site.name,
        agencyPhone: parsed.agencyPhone || site.phone,
        agencyEmail: parsed.agencyEmail || site.email,
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
