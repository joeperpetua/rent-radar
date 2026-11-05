import { fetchText, sleep } from '../http.js';
import { districtFromPostcode, searchRegions, stateFromPostcode, stateIdFromName, toNumber } from '../geo.js';

const BASE = 'https://www.willhaben.at';
const IMAGE_BASE = 'https://cache.willhaben.at/mmo/';
const PATHS = {
  apartment: '/iad/immobilien/mietwohnungen/mietwohnung-angebote',
  house: '/iad/immobilien/haus-mieten/haus-angebote',
};
const ROOM_BUCKETS = [[1, 1, '1X1'], [2, 2, '2X2'], [3, 3, '3X3'], [4, 4, '4X4'], [5, 5, '5X5'], [6, 9, '6X9'], [10, Infinity, '10X']];
const ROWS = 90;
const MAX_PAGES = 15;

export const id = 'willhaben';
export const label = 'willhaben';

function buildUrl(prefs, type, region, page) {
  const params = new URLSearchParams({ rows: String(ROWS), page: String(page) });
  if (region) params.set('areaId', String(region.willhaben));
  if (prefs.minPrice) params.set('PRICE_FROM', String(prefs.minPrice));
  if (prefs.maxPrice) params.set('PRICE_TO', String(prefs.maxPrice));
  if (prefs.minArea) params.set('ESTATE_SIZE/LIVING_AREA_FROM', String(prefs.minArea));
  if (prefs.maxArea) params.set('ESTATE_SIZE/LIVING_AREA_TO', String(prefs.maxArea));
  if (prefs.minRooms > 1 || prefs.maxRooms) {
    const max = prefs.maxRooms || Infinity;
    for (const [lo, hi, bucket] of ROOM_BUCKETS) if (hi >= prefs.minRooms && lo <= max) params.append('NO_OF_ROOMS_BUCKET', bucket);
  }
  return `${BASE}${PATHS[type]}?${params}`;
}

function parseSearchResult(html) {
  const m = /<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s.exec(html);
  if (!m) throw new Error('willhaben: __NEXT_DATA__ not found (layout changed or blocked)');
  const result = JSON.parse(m[1])?.props?.pageProps?.searchResult;
  if (!result) throw new Error('willhaben: searchResult missing');
  return result;
}

function normalize(ad, type, region) {
  const attrs = Object.fromEntries((ad.attributes?.attribute ?? []).map((a) => [a.name, a.values ?? []]));
  const one = (name) => attrs[name]?.[0] ?? null;
  const postcode = one('POSTCODE');
  const state = stateIdFromName(one('STATE')) ?? region?.id ?? stateFromPostcode(postcode);
  const city = one('LOCATION')?.split(',')[0]?.trim() || one('DISTRICT');
  const [lat, lng] = (one('COORDINATES') ?? '').split(',').map(Number);
  const images = (one('ALL_IMAGE_URLS') ?? '').split(';').filter(Boolean).map((p) => IMAGE_BASE + p);
  const published = toNumber(one('PUBLISHED'));
  const location = one('LOCATION');
  const street = one('ADDRESS');
  return {
    id: `willhaben:${ad.id}`,
    source: 'willhaben',
    sourceId: String(ad.id),
    type,
    url: one('SEO_URL') ? `${BASE}/iad/${one('SEO_URL')}` : `${BASE}/iad/object?adId=${ad.id}`,
    title: one('HEADING') ?? ad.description ?? '',
    price: toNumber(one('PRICE')) ?? toNumber(one('RENT/PER_MONTH_LETTINGS')),
    area: toNumber(one('ESTATE_SIZE/LIVING_AREA')) ?? toNumber(one('ESTATE_SIZE')),
    rooms: toNumber(one('NUMBER_OF_ROOMS')),
    postcode,
    state,
    city,
    district: state === 'wien' ? districtFromPostcode(postcode) : null,
    address: [street, postcode && `${postcode} ${city ?? ''}`.trim()].filter(Boolean).join(', ') || location,
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    images,
    description: one('BODY_DYN'),
    publishedAt: published ? new Date(published).toISOString() : one('PUBLISHED_String'),
    isPrivate: one('ISPRIVATE') === '1',
    agency: one('ORGNAME'),
    floor: one('FLOOR'),
    extras: [one('PROPERTY_TYPE'), one('FREE_AREA_TYPE_NAME')].filter((v) => v && v !== 'Wohnung'),
  };
}

export async function search(prefs, { onProgress = () => {} } = {}) {
  const listings = [];
  for (const region of searchRegions(prefs.states)) {
    for (const type of prefs.types.filter((t) => PATHS[t])) {
      let fetched = 0;
      let total = Infinity;
      for (let page = 1; page <= MAX_PAGES && fetched < total; page++) {
        const result = parseSearchResult(await fetchText(buildUrl(prefs, type, region, page)));
        total = result.rowsFound ?? 0;
        const ads = result.advertSummaryList?.advertSummary ?? [];
        if (!ads.length) break;
        fetched += ads.length;
        listings.push(...ads.map((ad) => normalize(ad, type, region)));
        onProgress(listings.length);
        await sleep(800);
      }
    }
  }
  return listings;
}
