import { fetchText, htmlToText } from '../http.js';
import { applyPrefs, locate } from './crawl.js';

export const id = 'dibeo';
export const label = 'dibeo';
export const kind = 'portal';

const ORIGIN = 'https://www.dibeo.at';
const PAGE_SIZE = 100;
const MAX_PAGES = 30;
const CATEGORY = { apartment: 'WOHNUNG', house: 'HAUS' };
const STATE_IDS = { burgenland: 1, kaernten: 2, niederoesterreich: 3, oberoesterreich: 4, salzburg: 5, steiermark: 6, tirol: 7, vorarlberg: 8, wien: 9 };

export function searchUrl(prefs, category, page) {
  const params = new URLSearchParams({ size: String(PAGE_SIZE), page: String(page), sort: 'id,desc', category, legalForm: 'MIETE' });
  for (const s of prefs?.states ?? []) if (STATE_IDS[s]) params.append('locationSuggestions', `${STATE_IDS[s]}:SUB_COUNTRY`);
  if (prefs?.minPrice) params.set('price.from', String(prefs.minPrice));
  if (prefs?.maxPrice) params.set('price.to', String(prefs.maxPrice));
  if (prefs?.minArea) params.set('areaSize.from', String(prefs.minArea));
  if (prefs?.maxArea) params.set('areaSize.to', String(prefs.maxArea));
  if (prefs?.minRooms) params.set('roomsCount.from', String(prefs.minRooms));
  if (prefs?.maxRooms) params.set('roomsCount.to', String(prefs.maxRooms));
  return `${ORIGIN}/api/realEstate/list?${params}`;
}

export function toListing(item) {
  const url = `${ORIGIN}/expose/${item.id}`;
  const loc = item.location ?? {};
  return {
    id: `dibeo:${item.id}`,
    source: 'dibeo',
    sourceId: String(item.id),
    type: item.category === 'HAUS' ? 'house' : 'apartment',
    forSale: item.legalForm !== 'MIETE',
    url,
    title: item.title,
    price: item.minPrice > 0 ? item.minPrice : null,
    area: item.minArea ?? null,
    rooms: item.minRoomsCount ?? null,
    deposit: null,
    ...locate({ postcode: loc.zip, city: loc.municipality ?? loc.district }),
    lat: null,
    lng: null,
    images: (item.images ?? []).map((i) => `${i.domain}/${i.path}/big-jpeg/${i.title || 'bild'}.jpeg`),
    description: htmlToText(item.description),
    sourceUrl: url,
    sourceHost: 'dibeo.at',
    publishedAt: item.stateFrom ?? null,
    isPrivate: item.vendor === 'PRIVAT',
    agency: item.agentCompanyName ?? null,
    floor: null,
    extras: [],
  };
}

export async function search(prefs, { onProgress = () => {} } = {}) {
  const categories = (prefs?.types?.length ? prefs.types : ['apartment']).map((t) => CATEGORY[t]).filter(Boolean);
  const byId = new Map();
  let partial = false;
  for (const category of categories) {
    for (let page = 0; page < MAX_PAGES; page++) {
      let body;
      try {
        body = JSON.parse(await fetchText(searchUrl(prefs, category, page), { retries: 1, timeout: 15000, accept: 'application/json' }));
      } catch (err) {
        if (page === 0) throw err;
        partial = true;
        break;
      }
      for (const item of body.content ?? []) {
        const l = toListing(item);
        if (!l.forSale) byId.set(l.id, l);
      }
      onProgress(byId.size);
      if (body.last || !body.content?.length) break;
      if (page === MAX_PAGES - 1) partial = true;
    }
  }
  return { listings: applyPrefs([...byId.values()], prefs), partial };
}
