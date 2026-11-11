import { extractJsonObject, fetchText } from '../http.js';
import { toNumber } from '../geo.js';
import { applyPrefs, locate } from './crawl.js';

export const id = 'derstandard';
export const label = 'DER STANDARD';
export const kind = 'portal';

const ORIGIN = 'https://immobilien.derstandard.at';
const PAGE_SIZE = 16;
const MAX_PAGES = 60;
const TENURE = { apartment: 'mieten-wohnung', house: 'mieten-haus' };
const STATE_SLUGS = ['wien', 'niederoesterreich', 'burgenland', 'oberoesterreich', 'salzburg', 'steiermark', 'kaernten', 'tirol', 'vorarlberg'];

export function searchUrl(prefs, slug, tenure, page) {
  const params = new URLSearchParams();
  if (prefs?.minPrice) params.set('priceFrom', String(prefs.minPrice));
  if (prefs?.maxPrice) params.set('priceTo', String(prefs.maxPrice));
  if (prefs?.minArea) params.set('areaFrom', String(prefs.minArea));
  if (prefs?.maxArea) params.set('areaTo', String(prefs.maxArea));
  if (prefs?.minRooms) params.set('roomCountFrom', String(prefs.minRooms));
  if (page > 1) params.set('page', String(page));
  const query = params.toString();
  return `${ORIGIN}/suche/${slug}/${tenure}${query ? `?${query}` : ''}`;
}

export function flightData(html) {
  return [...html.matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)]
    .map((m) => {
      try {
        return JSON.parse(`"${m[1]}"`);
      } catch {
        return '';
      }
    })
    .join('');
}

const objectAt = (text, marker) => {
  const i = text.indexOf(marker);
  return i < 0 ? null : extractJsonObject(text.slice(i), '');
};

const cost = (costs, kinds) => {
  for (const kind of kinds) {
    const c = costs?.details?.find((d) => d.kind === kind);
    const v = c?.gross ?? c?.net ?? toNumber(c?.text);
    if (v > 0) return v;
  }
  return null;
};

const area = (areas, kind) => areas?.details?.find((a) => a.kind === kind)?.value ?? (areas?.main?.kind === kind ? areas.main.value : null);

function toListing(entry, group = null) {
  const p = entry.property ?? {};
  const main = p.costs?.main;
  const price = main?.type === 'GROSS' && main.value > 0
    ? main.value
    : cost(p.costs, ['TOTAL_RENT', 'BASE_RENT_PLUS_UTILITIES', 'TOTAL_COSTS', 'MONTHLY_COSTS']) ?? main?.value ?? null;
  const depositRaw = cost(p.costs, ['DEPOSIT']);
  const deposit = depositRaw != null && depositRaw <= 12 && price ? Math.round(depositRaw * price * 100) / 100 : depositRaw;
  const location = p.location ?? group?.location ?? {};
  const company = (entry.advertiser ?? group?.advertiser)?.company;
  const images = (entry.media ?? group?.media)?.images?.map((i) => i.path).filter(Boolean) ?? [];
  const url = `${ORIGIN}/detail/${entry.id}`;
  return {
    id: `derstandard:${entry.id}`,
    source: 'derstandard',
    sourceId: String(entry.id),
    type: /HOUSE/i.test(p.basics?.propertyType ?? '') ? 'house' : 'apartment',
    forSale: false,
    url,
    title: entry.title,
    price,
    area: area(p.areas, 'LIVING_SPACE') ?? area(p.areas, 'USABLE_SPACE') ?? p.areas?.main?.value ?? null,
    rooms: area(p.areas, 'ROOM_COUNT'),
    deposit,
    ...locate({ postcode: location.zipCode, city: location.city, street: location.street }),
    lat: null,
    lng: null,
    images,
    description: null,
    sourceUrl: url,
    sourceHost: 'immobilien.derstandard.at',
    publishedAt: (entry.metaData ?? group?.metaData)?.publishedAt ?? null,
    isPrivate: !company,
    agency: company?.name ?? null,
    floor: null,
    extras: [],
  };
}

export function parsePage(html) {
  const data = flightData(html);
  const page = objectAt(data, '{"__typename":"PaginatedPropertyEntriesResponse"');
  if (!page) return null;
  const listings = (page.entries ?? []).map((e) => toListing(e));
  let rest = data;
  for (let i = rest.indexOf('{"__typename":"PropertyGroupWithPropertiesResponse"'); i >= 0; i = rest.indexOf('{"__typename":"PropertyGroupWithPropertiesResponse"')) {
    const group = extractJsonObject(rest.slice(i), '');
    rest = rest.slice(i + 1);
    for (const unit of group?.properties ?? []) {
      if (unit.matching && unit.property) listings.push(toListing(unit.property, group));
    }
  }
  return { total: page.totalEntries ?? 0, listings };
}

export async function search(prefs, { onProgress = () => {} } = {}) {
  const slugs = prefs?.states?.length ? prefs.states.filter((s) => STATE_SLUGS.includes(s)) : ['oesterreich'];
  const tenures = (prefs?.types?.length ? prefs.types : ['apartment']).map((t) => TENURE[t]).filter(Boolean);
  const byId = new Map();
  let partial = false;
  for (const slug of slugs) {
    for (const tenure of tenures) {
      for (let page = 1; page <= MAX_PAGES; page++) {
        let parsed;
        try {
          parsed = parsePage(await fetchText(searchUrl(prefs, slug, tenure, page), { retries: 1, timeout: 15000 }));
        } catch (err) {
          if (page === 1) throw err;
          partial = true;
          break;
        }
        if (!parsed?.listings.length) break;
        for (const l of parsed.listings) byId.set(l.id, l);
        onProgress(byId.size);
        if (page * PAGE_SIZE >= parsed.total) break;
        if (page === MAX_PAGES) partial = true;
      }
    }
  }
  return { listings: applyPrefs([...byId.values()], prefs), partial };
}
