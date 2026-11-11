import { decodeEntities, fetchText } from '../http.js';
import { cityFromAddress, districtFromPostcode, findPostcode, stateFromPostcode } from '../geo.js';
import { PARSER_VERSION, parseDirectListing } from './directParser.js';
import { applyPrefs, fetchPages, maxNumber, pMap, reusable } from './crawl.js';

export const BROKERS = [
  {
    id: 'realbrokers',
    name: 'Realbrokers',
    host: 'realbrokers.at',
    searchUrl: 'https://www.realbrokers.at/de/immobilien?f%5BbuyRentAll%5D=rent',
  },
  {
    id: 'edlauer',
    name: 'Edlauer',
    host: 'edlauer.com',
    searchUrl: 'https://www.edlauer.com/de/immobilien?f%5BbuyRentAll%5D=rent',
  },
];

export async function fetchBrokerLinks(broker) {
  const pages = await fetchPages({
    name: broker.name,
    pageUrl: (n) => (n === 1 ? broker.searchUrl : `${broker.searchUrl}&page=${n}`),
    lastPage: (html) => maxNumber(html, /[?&](?:amp;)?page=(\d+)/g),
  }, broker.id);
  const links = pages.flatMap((html) => [...html.matchAll(/href="([^"]*\/immobilie\/[^"?#]*)/gi)]
    .map((m) => new URL(m[1].replace(/&amp;/g, '&'), `https://www.${broker.host}`).href));
  return [...new Set(links)];
}

export async function searchBroker(broker, prefs, { onProgress = () => {}, stored } = {}) {
  const urls = await fetchBrokerLinks(broker);

  let count = 0;
  const listings = await pMap(urls, 6, async (url) => {
    try {
      const u = new URL(url);
      const host = u.hostname.replace(/^www\./i, '');
      const slug = u.pathname.replace(/\/$/, '').split('/').pop();
      const listingId = `immo:${broker.id}:${slug}`;

      const known = stored?.get(listingId);
      if (reusable(known)) {
        if (known.forSale || known.price == null || known.price <= 0) return null;
        onProgress(++count);
        return known;
      }

      const pageHtml = await fetchText(url, { retries: 1, timeout: 10000 });
      const parsed = parseDirectListing(pageHtml, url);
      if (parsed.inactive || parsed.forSale || parsed.price == null || parsed.price <= 0) return null;

      const title = decodeEntities(pageHtml.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || `${broker.name} Objekt`)
        .replace(/\s*[-|–]\s*(?:Realbrokers|Edlauer|Immobilienmakler).*$/i, '')
        .replace(/\s+/g, ' ')
        .trim();

      const postcode = findPostcode(parsed.address) || findPostcode(parsed.description) || findPostcode(title);
      const state = stateFromPostcode(postcode);
      const district = state === 'wien' ? districtFromPostcode(postcode) : null;
      const city = cityFromAddress(parsed.address) || (state === 'wien' ? 'Wien' : null);
      const address = parsed.address || [postcode, city].filter(Boolean).join(' ') || null;

      onProgress(++count);

      return {
        id: listingId,
        source: 'immo',
        sourceId: `${broker.id}:${slug}`,
        sourceName: broker.name,
        parserVersion: PARSER_VERSION,
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
        agency: broker.name,
        floor: null,
        extras: [],
      };
    } catch {
      return null;
    }
  });

  return applyPrefs(listings, prefs);
}

