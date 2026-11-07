import { fetchText } from '../http.js';
import { cityFromAddress, districtFromPostcode, findPostcode, stateFromPostcode } from '../geo.js';
import { parseDirectListing } from './directParser.js';

export const id = 'justimmo';
export const label = 'JustImmo Makler';

const BROKERS = [
  {
    name: 'IMMOcontract',
    host: 'immocontract.at',
    searchUrl: 'https://www.immocontract.at/immosuche?f%5Ball%5D%5Bmarketing_type%5D=rent',
    linkPattern: /href="([^"]*\/objektdetail\/[^"]*)"/gi,
    resolveUrl: (href) => (href.startsWith('http') ? href : `https://www.immocontract.at${href}`),
  },
  {
    name: 'Lebenswert Wohnen',
    host: 'lebenswert-wohnen.at',
    searchUrl: 'https://www.lebenswert-wohnen.at/suche?f%5Ball%5D%5Bmarketing_type%5D=rent',
    linkPattern: /href="([^"]*\/objekt(?:detail)?\/[^"]*)"/gi,
    resolveUrl: (href) => (href.startsWith('http') ? href : `https://www.lebenswert-wohnen.at${href}`),
  },
  {
    name: 'Novel Real',
    host: 'novel-real.at',
    searchUrl: 'https://www.novel-real.at/de/immobilien?f%5Ball%5D%5Bmarketing_type%5D=rent',
    linkPattern: /href="([^"]*\/objekt(?:detail)?\/[^"]*)"/gi,
    resolveUrl: (href) => (href.startsWith('http') ? href : `https://www.novel-real.at${href}`),
  },
  {
    name: 'Wohnreich',
    host: 'wohnreich.at',
    searchUrl: 'https://www.wohnreich.at/miete',
    linkPattern: /href="([^"]*\/objekt(?:detail)?\/[^"]*)"/gi,
    resolveUrl: (href) => (href.startsWith('http') ? href : `https://www.wohnreich.at${href}`),
  },
  {
    name: 'Immovent',
    host: 'immovent.at',
    searchUrl: 'https://www.immovent.at/wohnungen-miete',
    linkPattern: /href="([^"]*\/objekt(?:detail)?\/[^"]*)"/gi,
    resolveUrl: (href) => (href.startsWith('http') ? href : `https://www.immovent.at${href}`),
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

export async function fetchBrokerLinks(broker) {
  try {
    const html = await fetchText(broker.searchUrl, { retries: 1, timeout: 8000 });
    const matches = [...html.matchAll(broker.linkPattern)].map((m) => broker.resolveUrl(m[1].replace(/&amp;/g, '&')));
    return [...new Set(matches)];
  } catch (err) {
    console.warn(`[justimmo] ${broker.name} search failed:`, err?.message);
    return [];
  }
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
      const idMatch = /\/objekt(?:detail)?\/(\d+)/.exec(url);
      const sourceId = idMatch ? idMatch[1] : url;
      const listingId = `justimmo:${broker.host}_${sourceId}`;

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
        .replace(/\s*-\s*(?:IMMOcontract|Lebenswert|Novel Real|Wohnreich|Immovent).*$/i, '')
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
        source: 'justimmo',
        sourceId: `${broker.host}_${sourceId}`,
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
