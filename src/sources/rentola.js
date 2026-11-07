import { fetchText, htmlToText, sleep } from '../http.js';
import { cityFromAddress, districtFromPostcode, findPostcode, searchRegions, stateFromPostcode, toNumber } from '../geo.js';
import { parseDirectListing } from './directParser.js';

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
    sourceUrl: null,
    sourceHost: null,
    estimatedArea: null,
    rentolaStatus: null,
    directVerified: false,
    publishedAt: offer.validFrom ?? null,
    isPrivate: null,
    agency: null,
    agencyPhone: null,
    agencyEmail: null,
    deposit: null,
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

export function cleanSourceUrl(urlStr) {
  if (!urlStr) return null;
  try {
    const u = new URL(urlStr);
    const toDelete = [];
    for (const k of u.searchParams.keys()) {
      if (k.toLowerCase().startsWith('utm_')) toDelete.push(k);
    }
    for (const k of toDelete) u.searchParams.delete(k);
    return u.toString();
  } catch {
    return urlStr;
  }
}

export function extractSourceHost(urlStr) {
  if (!urlStr) return null;
  try {
    return new URL(urlStr).hostname.replace(/^www\./i, '');
  } catch {
    return null;
  }
}

export function parsePropertyAttributes(text) {
  if (!text) return null;
  const match = /"propertyAttributes"\s*:\s*\{/.exec(text);
  if (!match) return null;
  const start = match.index + match[0].length - 1;
  let depth = 0;
  let inStr = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      try {
        return JSON.parse(text.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function parseDetails(text, finalUrl = '') {
  if (finalUrl?.includes('inactive_property_id')) {
    return { inactive: true };
  }

  const attrs = parsePropertyAttributes(text);
  if (attrs) {
    if (attrs.status && attrs.status !== 'active') {
      return { inactive: true };
    }
    const cleanUrl = cleanSourceUrl(attrs.sourceUrl);
    const images = [...new Set((attrs.images ?? []).map((i) => (
      typeof i === 'string' ? i : i?.data?.attributes?.externalUrl ?? i?.attributes?.externalUrl ?? i?.url ?? null
    )).filter(Boolean))];
    if (!images.length && attrs.exampleImageUrl) {
      images.push(attrs.exampleImageUrl);
    }
    return {
      inactive: false,
      images,
      description: attrs.desc ? htmlToText(attrs.desc) : null,
      sourceUrl: cleanUrl,
      sourceHost: extractSourceHost(cleanUrl),
      estimatedArea: attrs.estimatedArea ?? null,
      rentolaStatus: attrs.status ?? null,
    };
  }

  // Fallback to JSON-LD if propertyAttributes is missing
  const nodes = ldNodes(text);
  const listing = nodes.find((n) => n['@type'] === 'RealEstateListing');
  if (!listing) {
    return { inactive: true };
  }

  return {
    inactive: false,
    images: [...new Set([].concat(listing.image ?? []).map((i) => (typeof i === 'string' ? i : i?.url)).filter(Boolean))],
    description: htmlToText(listing.description),
    sourceUrl: null,
    sourceHost: null,
    estimatedArea: null,
    rentolaStatus: null,
  };
}

export async function fetchDirectDetails(sourceUrl) {
  if (!sourceUrl) return null;
  try {
    const res = await fetchText(sourceUrl, {
      retries: 1,
      timeout: 10000,
      full: true,
    });
    return parseDirectListing(res.text, res.url || sourceUrl, res.status);
  } catch (err) {
    if (/HTTP (?:404|410)/i.test(err?.message)) {
      return { inactive: true };
    }
    return null;
  }
}

export async function fetchDetails(url) {
  const res = await fetchText(url, {
    retries: 1,
    headers: { RSC: '1' },
    full: true,
  });
  const details = parseDetails(res.text, res.url || url);
  if (details.inactive || !details.sourceUrl) {
    return details;
  }

  // Fetch directly from original source host to correct Rentola's inaccurate data
  try {
    const direct = await fetchDirectDetails(details.sourceUrl);
    if (direct?.inactive) {
      return { inactive: true };
    }
    if (direct) {
      if (direct.area != null) {
        details.area = direct.area;
        details.estimatedArea = false;
      }
      if (direct.rooms != null) details.rooms = direct.rooms;
      if (direct.price != null) details.price = direct.price;
      if (direct.deposit != null) details.deposit = direct.deposit;
      if (direct.agency) details.agency = direct.agency;
      if (direct.agencyPhone) details.agencyPhone = direct.agencyPhone;
      if (direct.agencyEmail) details.agencyEmail = direct.agencyEmail;
      if (direct.images?.length) details.images = direct.images;
      if (direct.description) details.description = direct.description;
      details.directVerified = true;
    }
  } catch {
    // Keep Rentola details if direct source fetch encounters network issue
  }

  return details;
}

export async function addDetails(listings, stored) {
  const pending = [];
  for (const listing of listings) {
    const known = stored?.get(listing.id);
    if (known?.detailsAt && known?.sourceUrl) {
      Object.assign(listing, {
        price: known.price ?? listing.price,
        area: known.area ?? listing.area,
        rooms: known.rooms ?? listing.rooms,
        deposit: known.deposit ?? null,
        agency: known.agency ?? null,
        agencyPhone: known.agencyPhone ?? null,
        agencyEmail: known.agencyEmail ?? null,
        images: known.images ?? [],
        description: known.description ?? null,
        sourceUrl: known.sourceUrl,
        sourceHost: known.sourceHost ?? extractSourceHost(known.sourceUrl),
        estimatedArea: known.estimatedArea ?? null,
        rentolaStatus: known.rentolaStatus ?? null,
        directVerified: known.directVerified ?? false,
        detailsAt: known.detailsAt,
      });
    } else {
      pending.push(listing);
    }
  }

  const queue = pending.slice(0, MAX_DETAIL_FETCHES_PER_RUN);
  let failed = 0;
  const deactivatedIds = new Set();

  await Promise.all(Array.from({ length: DETAIL_CONCURRENCY }, async () => {
    for (let listing = queue.shift(); listing; listing = queue.shift()) {
      try {
        const details = await fetchDetails(listing.url);
        if (details.inactive) {
          deactivatedIds.add(listing.id);
          continue;
        }
        if (details.images?.length) listing.images = details.images;
        if (details.description) listing.description = details.description;
        if (details.sourceUrl) {
          listing.sourceUrl = details.sourceUrl;
          listing.sourceHost = details.sourceHost;
        }
        if (details.estimatedArea != null) listing.estimatedArea = details.estimatedArea;
        if (details.rentolaStatus != null) listing.rentolaStatus = details.rentolaStatus;
        if (details.area != null) listing.area = details.area;
        if (details.rooms != null) listing.rooms = details.rooms;
        if (details.price != null) listing.price = details.price;
        if (details.deposit != null) listing.deposit = details.deposit;
        if (details.agency) listing.agency = details.agency;
        if (details.agencyPhone) listing.agencyPhone = details.agencyPhone;
        if (details.agencyEmail) listing.agencyEmail = details.agencyEmail;
        if (details.directVerified) listing.directVerified = true;
        listing.detailsAt = new Date().toISOString();
      } catch {
        failed++;
      }
      await sleep(300);
    }
  }));

  if (failed) console.warn(`[rentola] ${failed} detail pages failed, retrying next run`);

  if (deactivatedIds.size > 0) {
    const active = listings.filter((l) => !deactivatedIds.has(l.id));
    listings.length = 0;
    listings.push(...active);
  }
  return listings;
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
