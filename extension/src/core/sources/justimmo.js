import { decodeEntities, fetchText } from '../http.js';
import { cityFromAddress, districtFromPostcode, findPostcode, stateFromPostcode, toNumber } from '../geo.js';
import { PARSER_VERSION, parseDirectListing } from './directParser.js';
import { applyPrefs, fetchPages, maxNumber, outOfScope, pMap, reusable } from './crawl.js';

const FEDERAL_STATES = { burgenland: 126, kaernten: 127, niederoesterreich: 128, oberoesterreich: 129, salzburg: 130, steiermark: 131, tirol: 132, vorarlberg: 133, wien: 134 };

export function filterQuery(prefs) {
  const params = new URLSearchParams({ 'f[occupancy]': 'living', 'f[living][marketing_type]': 'rent' });
  if (prefs?.states?.length === 1 && FEDERAL_STATES[prefs.states[0]]) params.set('f[living][federal_state]', String(FEDERAL_STATES[prefs.states[0]]));
  if (prefs?.maxPrice) params.set('f[living][price][max]', String(prefs.maxPrice));
  if (prefs?.minArea) params.set('f[living][sorting_area][min]', String(prefs.minArea));
  if (prefs?.maxArea) params.set('f[living][sorting_area][max]', String(prefs.maxArea));
  if (prefs?.minRooms) params.set('f[living][rooms][min]', String(prefs.minRooms));
  if (prefs?.maxRooms) params.set('f[living][rooms][max]', String(prefs.maxRooms));
  return params.toString();
}

const broker = (id, name, host, path) => ({
  id,
  name,
  host,
  origin: `https://www.${host}`,
  withPrefs(prefs) {
    const query = filterQuery(prefs);
    return { ...this, pageUrl: (n) => `https://www.${host}${path}${n > 1 ? `/p/${n}` : ''}?${query}` };
  },
  lastPage: (html) => maxNumber(html, /\/p\/(\d+)\?/g),
});

export const BROKERS = [
  broker('immocontract', 'IMMOcontract', 'immocontract.at', '/immosuche'),
  broker('lebenswert', 'Lebenswert Wohnen', 'lebenswert-wohnen.at', '/suche'),
  broker('novelreal', 'Novel Real', 'novel-real.at', '/de/immobilien'),
  broker('wohnreich', 'Wohnreich', 'wohnreich.at', '/miete'),
  broker('immovent', 'Immovent', 'immovent.at', '/alle-immobilien'),
];

export function parseCards(html, origin) {
  const cards = new Map();
  for (const chunk of html.split(/class="panel panel-default"/).slice(1)) {
    const href = /href="([^"]*\/objekt(?:detail)?\/(\d+))[^"]*"/.exec(chunk);
    if (!href || cards.has(href[2])) continue;
    cards.set(href[2], {
      sourceId: href[2],
      url: new URL(href[1], origin).href,
      postcode: /class="zip-city">\s*(\d{4})\b/.exec(chunk)?.[1] ?? null,
      price: toNumber(/info-price[\s\S]*?list-item-value">\s*([\d.,]+)/.exec(chunk)?.[1]),
    });
  }
  return [...cards.values()];
}

export async function fetchBrokerCards(b, prefs) {
  const pages = await fetchPages(b.withPrefs(prefs), b.id);
  const seen = new Set();
  return pages.flatMap((html) => parseCards(html, b.origin)).filter((c) => !seen.has(c.sourceId) && seen.add(c.sourceId));
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function searchBroker(b, prefs, { onProgress = () => {}, stored } = {}) {
  const candidates = (await fetchBrokerCards(b, prefs)).filter((card) => !outOfScope(card, prefs));
  const brandSuffix = new RegExp(`\\s*[-|–]\\s*${escapeRegExp(b.name.split(' ')[0])}.*$`, 'i');

  let count = 0;
  const listings = await pMap(candidates, 6, async (card) => {
    try {
      const listingId = `immo:${b.id}:${card.sourceId}`;
      const known = stored?.get(listingId);
      if (reusable(known)) {
        if (known.forSale || known.price == null || known.price <= 0) return null;
        onProgress(++count);
        return known;
      }

      const pageHtml = await fetchText(card.url, { retries: 1, timeout: 10000 });
      const parsed = parseDirectListing(pageHtml, card.url);
      if (parsed.inactive || parsed.forSale || parsed.price == null || parsed.price <= 0) return null;

      const title = decodeEntities(pageHtml.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || `${b.name} Objekt`)
        .replace(brandSuffix, '')
        .replace(/\s+/g, ' ')
        .trim();

      const postcode = findPostcode(parsed.address) || card.postcode || findPostcode(parsed.description) || findPostcode(title);
      const state = stateFromPostcode(postcode);
      const district = state === 'wien' ? districtFromPostcode(postcode) : null;
      const city = cityFromAddress(parsed.address) || (state === 'wien' ? 'Wien' : null);
      const address = parsed.address || [postcode, city].filter(Boolean).join(' ') || null;

      onProgress(++count);

      return {
        id: listingId,
        source: 'immo',
        sourceId: `${b.id}:${card.sourceId}`,
        sourceName: b.name,
        parserVersion: PARSER_VERSION,
        type: 'apartment',
        forSale: false,
        url: card.url,
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
        sourceUrl: card.url,
        sourceHost: b.host,
        publishedAt: null,
        isPrivate: false,
        agency: parsed.agency || b.name,
        floor: null,
        extras: [],
      };
    } catch {
      return null;
    }
  });

  return applyPrefs(listings, prefs);
}

