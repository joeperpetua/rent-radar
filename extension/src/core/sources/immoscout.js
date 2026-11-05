import { decodeEntities, extractJsonObject, fetchText, htmlToText, postJson, sleep } from '../http.js';
import { cityFromAddress, districtFromPostcode, findPostcode, searchRegions, stateFromPostcode, stateIdFromImmoscoutCode, toNumber } from '../geo.js';

const BASE = 'https://www.immobilienscout24.at';
const GRAPHQL_URL = `${BASE}/portal/graphql`;
const EXPOSE_GRAPHQL_URL = `${BASE}/expose/graphql`;
const PICTURE_RESIZE_BASE = 'https://pictures.immobilienscout24.de/dims3/S3/quality/80/resize/1280x/format/webp/https://s3-eu-west-1.amazonaws.com/prod.www.immobilienscout24.at/';
const MAX_PAGES = 15;
const GRAPHQL_PAGE_SIZE = 100;
const EXPOSE_BATCH_SIZE = 50;
const ESTATE_TYPES = { apartment: 'APARTMENT', house: 'HOUSE' };
const URL_SEGMENTS = { apartment: 'wohnung-mieten', house: 'haus-mieten' };
const PICTURE_TYPES = ['RegularListing', 'DeveloperLightListing', 'TopListing', 'SmartPremiumListing', 'DeveloperPremiumListing', 'DeveloperTopListing'];
const GEO_HIERARCHY_TYPES = ['RegularListing', 'SmartPremiumListing', 'TopListing'];

const QUERY = `query findPropertiesByParams($params: SearchParamsInput) {
  findPropertiesByParams(params: $params) {
    hits {
      exposeId
      links { absoluteURL }
      mainKeyFacts { value label }
      headline
      addressString
      primaryPrice
      primaryArea
      numberOfRooms
      isPrivate
      dateCreated
      meta
      realtorContact { company name }
      typedBadges { ... on BadgeRegular { details { value } } }
      location { ... on PointLocation { lat lon } }
      ${PICTURE_TYPES.map((t) => `... on ${t} { primaryPictureImageProps { src }${GEO_HIERARCHY_TYPES.includes(t) ? ' geoHierarchy' : ''} }`).join('\n      ')}
    }
  }
}`;
const QUERY_HASH = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(QUERY)))].map((b) => b.toString(16).padStart(2, '0')).join('');

export const id = 'immoscout';
export const label = 'ImmoScout24';

function searchParams(prefs, type, region) {
  const params = {
    countryCode: 'AT',
    estateType: ESTATE_TYPES[type],
    transferType: 'RENT',
    useType: 'RESIDENTIAL',
  };
  if (region) params.region = region.immoscout;
  if (prefs.minPrice) params.primaryPriceFrom = String(prefs.minPrice);
  if (prefs.maxPrice) params.primaryPriceTo = String(prefs.maxPrice);
  if (prefs.minArea) params.primaryAreaFrom = String(prefs.minArea);
  if (prefs.maxArea) params.primaryAreaTo = String(prefs.maxArea);
  if (prefs.minRooms) params.numberOfRoomsFrom = String(prefs.minRooms);
  if (prefs.maxRooms) params.numberOfRoomsTo = String(prefs.maxRooms);
  return params;
}

function buildHtmlUrl(prefs, type, region, page) {
  const { estateType, countryCode, region: _r, transferType, useType, ...filters } = searchParams(prefs, type, region);
  const pagePath = page > 1 ? `/seite-${page}` : '';
  return `${BASE}/regional/${region?.immoscoutPath ?? 'oesterreich'}/${URL_SEGMENTS[type]}${pagePath}?${new URLSearchParams(filters)}`;
}

function badgeCodes(hit) {
  return (hit.typedBadges ?? []).map((b) => b.details?.value).filter((v) => typeof v === 'string' && v !== 'NEW');
}

function normalize(hit, type, region) {
  const postcode = findPostcode(hit.addressString);
  const state = region?.id ?? stateIdFromImmoscoutCode(hit.geoHierarchy?.[0]) ?? stateFromPostcode(postcode);
  const picture = hit.primaryPictureImageProps?.src;
  const point = hit.location?.lat != null && hit.location?.type !== 'CIRCLE' ? hit.location : null;
  return {
    id: `immoscout:${hit.exposeId}`,
    source: 'immoscout',
    sourceId: hit.exposeId,
    type,
    url: hit.links?.absoluteURL ?? `${BASE}/expose/${hit.exposeId}`,
    title: decodeEntities(hit.headline ?? ''),
    price: toNumber(hit.primaryPrice),
    area: toNumber(hit.primaryArea),
    rooms: toNumber(hit.numberOfRooms ?? hit.mainKeyFacts?.find((f) => f.label === 'Zi.')?.value),
    postcode,
    state,
    city: cityFromAddress(decodeEntities(hit.addressString)),
    district: state === 'wien' ? districtFromPostcode(postcode) : null,
    address: decodeEntities(hit.addressString?.trim()) ?? null,
    lat: toNumber(point?.lat),
    lng: toNumber(point?.lon),
    images: picture ? [picture.replace('/legacy_thumbnail/358x202/', '/legacy_thumbnail/716x404/')] : [],
    description: null,
    publishedAt: hit.dateCreated ?? null,
    isPrivate: Boolean(hit.isPrivate),
    agency: hit.realtorContact?.company ?? hit.realtorContact?.name ?? null,
    floor: null,
    extras: badgeCodes(hit),
  };
}

async function graphqlGet(params) {
  const query = new URLSearchParams({
    operationName: 'findPropertiesByParams',
    variables: JSON.stringify({ params }),
    extensions: JSON.stringify({ persistedQuery: { version: 1, sha256Hash: QUERY_HASH } }),
  });
  return JSON.parse(await fetchText(`${GRAPHQL_URL}?${query}`, { accept: 'application/json' }));
}

function graphqlRegister(params) {
  return postJson(GRAPHQL_URL, {
    operationName: 'findPropertiesByParams',
    query: QUERY,
    variables: { params },
    extensions: { persistedQuery: { version: 1, sha256Hash: QUERY_HASH } },
  });
}

function galleryUrl(url) {
  const pictureId = new URL(url).searchParams.get('id');
  return pictureId ? PICTURE_RESIZE_BASE + pictureId : url;
}

async function fetchExposeDetails(exposeIds) {
  const safe = exposeIds.filter((id) => /^[0-9a-f]+$/i.test(id));
  const query = `query exposes { ${safe.map((id, i) => `e${i}: expose(id: "${id}") { id pictures { url } description { descriptionNote locationNote } }`).join(' ')} }`;
  const json = await postJson(EXPOSE_GRAPHQL_URL, { query });
  if (!json.data) throw new Error(json.errors?.[0]?.message ?? 'no data');
  const details = new Map();
  for (const expose of Object.values(json.data)) {
    if (!expose?.id) continue;
    const description = [expose.description?.descriptionNote, expose.description?.locationNote].map(htmlToText).filter(Boolean).join('\n\n');
    details.set(expose.id, {
      images: (expose.pictures ?? []).map((p) => p.url).filter(Boolean).map(galleryUrl),
      description: description || null,
    });
  }
  return details;
}

async function addExposeDetails(listings) {
  for (let i = 0; i < listings.length; i += EXPOSE_BATCH_SIZE) {
    const batch = listings.slice(i, i + EXPOSE_BATCH_SIZE);
    try {
      const details = await fetchExposeDetails(batch.map((l) => l.sourceId));
      for (const listing of batch) {
        const detail = details.get(listing.sourceId);
        if (detail?.images.length) listing.images = detail.images;
        if (detail?.description) listing.description = detail.description;
      }
    } catch (err) {
      console.warn(`[immoscout] expose details failed, keeping single picture: ${err.message}`);
    }
    if (i + EXPOSE_BATCH_SIZE < listings.length) await sleep(800);
  }
}

async function fetchHits(params) {
  let json = await graphqlGet(params);
  if (json.errors?.some((e) => e.extensions?.code === 'PERSISTED_QUERY_NOT_FOUND')) json = await graphqlRegister(params);
  if (json.errors?.length) throw new Error(`immoscout graphql: ${json.errors.map((e) => e.message).join('; ')}`);
  return json.data?.findPropertiesByParams?.hits ?? [];
}

async function searchGraphql(prefs, type, region, onPage) {
  const byId = new Map();
  for (let from = 0; from < GRAPHQL_PAGE_SIZE * MAX_PAGES; from += GRAPHQL_PAGE_SIZE) {
    const hits = (await fetchHits({ ...searchParams(prefs, type, region), from: String(from), size: String(GRAPHQL_PAGE_SIZE) })).filter((h) => h.exposeId);
    for (const hit of hits) byId.set(hit.exposeId, normalize(hit, type, region));
    onPage(byId.size);
    if (hits.length < GRAPHQL_PAGE_SIZE) break;
    await sleep(800);
  }
  return [...byId.values()];
}

async function searchHtml(prefs, type, region, onPage) {
  const listings = [];
  let totalPages = 1;
  for (let page = 1; page <= Math.min(totalPages, MAX_PAGES); page++) {
    const state = extractJsonObject(await fetchText(buildHtmlUrl(prefs, type, region, page)), 'window.__INITIAL_STATE__');
    const results = state?.reduxAsyncConnect?.pageData?.results;
    if (!results) throw new Error('immoscout: results not found in __INITIAL_STATE__ (layout changed or blocked)');
    totalPages = results.pagination?.totalPages ?? 1;
    const hits = (results.hits ?? []).filter((h) => h.exposeId);
    if (!hits.length) break;
    listings.push(...hits.map((h) => normalize(h, type, region)));
    onPage(listings.length);
    await sleep(800);
  }
  return listings;
}

export async function search(prefs, { onProgress = () => {} } = {}) {
  const listings = [];
  let partial = false;
  for (const region of searchRegions(prefs.states)) {
    for (const type of prefs.types.filter((t) => ESTATE_TYPES[t])) {
      const report = (n) => onProgress(listings.length + n);
      try {
        listings.push(...await searchGraphql(prefs, type, region, report));
      } catch (err) {
        console.warn(`[immoscout] graphql failed, falling back to HTML pages (first 15 per page only): ${err.message}`);
        listings.push(...await searchHtml(prefs, type, region, report));
        partial = true;
      }
    }
  }
  await addExposeDetails(listings);
  return { listings, partial };
}
