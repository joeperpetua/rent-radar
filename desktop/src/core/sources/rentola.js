import { fetchText, htmlToText, sleep } from '../http.js';
import { cityFromAddress, districtFromPostcode, findPostcode, searchRegions, stateFromPostcode, toNumber } from '../geo.js';

const BASE = 'https://rentola.at';
const MAX_PAGES = 20;
const DETAIL_CONCURRENCY = 3;
const MAX_DETAIL_FETCHES_PER_RUN = 120;
const PATHS = { apartment: 'wohnung', house: 'haus' };
const OPEN_MAX = { rent: 100000, size: 10000, rooms: 50 };

export const id = 'rentola';
export const label = 'Rentola';

function range(params, key, min, max) {
  if (!min && !max) return;
  params.set(key, `${min || 0}-${max || OPEN_MAX[key]}`);
}

function buildUrl(prefs, type, region, page) {
  const params = new URLSearchParams({ order: 'newest' });
  range(params, 'rent', prefs.minPrice, prefs.maxPrice);
  range(params, 'size', prefs.minArea, prefs.maxArea);
  range(params, 'rooms', prefs.minRooms, prefs.maxRooms);
  if (page > 1) params.set('page', String(page));
  return `${BASE}/mietwohnung/${PATHS[type]}/${region?.rentola ?? 'osterreich'}?${params}`;
}

function parseItems(html) {
  const re = /<script type="application\/ld\+json">(.*?)<\/script>/gs;
  for (let m; (m = re.exec(html));) {
    let data;
    try { data = JSON.parse(m[1]); } catch { continue; }
    if (data?.['@type'] === 'SearchResultsPage') return data.mainEntity?.itemListElement ?? [];
  }
  throw new Error('rentola: SearchResultsPage JSON-LD not found (layout changed or blocked)');
}

function normalize(entry, type, region) {
  const item = entry.item ?? {};
  const offer = item.offers ?? {};
  const place = offer.itemOffered ?? {};
  const url = item.url ?? entry.url;
  const address = place.address?.streetAddress?.replace(/,?\s*Austria$/i, '').replace(/\bVienna\b/g, 'Wien').trim() || null;
  const postcode = findPostcode(address);
  const state = region?.id ?? stateFromPostcode(postcode);
  const slugId = /-(p[0-9a-f]+)$/.exec(url ?? '')?.[1] ?? url;
  return {
    id: `rentola:${slugId}`,
    source: 'rentola',
    sourceId: slugId,
    type,
    url,
    title: item.name ?? '',
    price: toNumber(offer.price),
    area: toNumber(place.floorSize?.value),
    rooms: toNumber(place.numberOfRooms?.value ?? place.numberOfBedrooms?.value),
    postcode,
    state,
    city: cityFromAddress(address) ?? place.address?.addressLocality?.replace(/^Vienna$/i, 'Wien') ?? null,
    district: state === 'wien' ? districtFromPostcode(postcode) : null,
    address,
    lat: toNumber(place.geo?.latitude),
    lng: toNumber(place.geo?.longitude),
    images: item.image ? [item.image] : [],
    description: null,
    publishedAt: offer.validFrom ?? null,
    isPrivate: null,
    agency: null,
    floor: null,
    extras: [],
  };
}

function ldNodes(html) {
  return [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].flatMap((m) => {
    try {
      const data = JSON.parse(m[1]);
      return [].concat(data['@graph'] ?? data);
    } catch {
      return [];
    }
  });
}

async function fetchDetails(url) {
  const listing = ldNodes(await fetchText(url, { retries: 1 })).find((n) => n['@type'] === 'RealEstateListing');
  if (!listing) throw new Error('RealEstateListing JSON-LD not found');
  return {
    images: [...new Set([].concat(listing.image ?? []).map((i) => (typeof i === 'string' ? i : i?.url)).filter(Boolean))],
    description: htmlToText(listing.description),
  };
}

async function addDetails(listings, stored) {
  const pending = [];
  for (const listing of listings) {
    const known = stored?.get(listing.id);
    if (known?.detailsAt) Object.assign(listing, { images: known.images, description: known.description, detailsAt: known.detailsAt });
    else pending.push(listing);
  }
  const queue = pending.slice(0, MAX_DETAIL_FETCHES_PER_RUN);
  let failed = 0;
  await Promise.all(Array.from({ length: DETAIL_CONCURRENCY }, async () => {
    for (let listing = queue.shift(); listing; listing = queue.shift()) {
      try {
        const details = await fetchDetails(listing.url);
        if (details.images.length) listing.images = details.images;
        if (details.description) listing.description = details.description;
        listing.detailsAt = new Date().toISOString();
      } catch {
        failed++;
      }
      await sleep(300);
    }
  }));
  if (failed) console.warn(`[rentola] ${failed} detail pages failed, retrying next run`);
}

export async function search(prefs, { onProgress = () => {}, stored } = {}) {
  const byId = new Map();
  for (const region of searchRegions(prefs.states)) {
    for (const type of prefs.types.filter((t) => PATHS[t])) {
      for (let page = 1; page <= MAX_PAGES; page++) {
        const items = parseItems(await fetchText(buildUrl(prefs, type, region, page)));
        const before = byId.size;
        for (const entry of items) {
          const listing = normalize(entry, type, region);
          if (listing.url && !byId.has(listing.id)) byId.set(listing.id, listing);
        }
        onProgress(byId.size);
        if (!items.length || byId.size === before) break;
        await sleep(800);
      }
    }
  }
  const listings = [...byId.values()];
  await addDetails(listings, stored);
  return listings;
}
