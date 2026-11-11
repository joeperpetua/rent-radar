import { decodeEntities, fetchText } from '../http.js';
import { toNumber } from '../geo.js';
import { applyPrefs, locate } from './crawl.js';

export const id = 'sn';
export const label = 'SN Immo';
export const kind = 'portal';

const ORIGIN = 'https://immo.sn.at';
const PAGE_SIZE = 20;
const MAX_PAGES = 40;
const STATE_SLUGS = ['wien', 'niederoesterreich', 'burgenland', 'oberoesterreich', 'salzburg', 'steiermark', 'kaernten', 'tirol', 'vorarlberg'];
const HOUSE = /\b(?:haus|h[äa]user|einfamilienhaus|reihenhaus|doppelhaus|doppelhaush[äa]lfte|bungalow|villa)\b/i;

export function searchUrl(prefs, slug, page) {
  const params = new URLSearchParams({ t: 'all:rental:living', a: `at.${slug}`, s: 'most_recently_updated_first' });
  if (prefs?.minPrice) params.set('pf', String(prefs.minPrice));
  if (prefs?.maxPrice) params.set('pt', String(prefs.maxPrice));
  if (prefs?.minArea) params.set('sf', String(prefs.minArea));
  if (prefs?.maxArea) params.set('st', String(prefs.maxArea));
  if (page > 1) params.set('page', String(page));
  return `${ORIGIN}/suchergebnisse?${params}`;
}

const attr = (tag, name) => {
  const v = new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];
  return v == null ? null : decodeEntities(v);
};

export function parsePage(html) {
  if (/ergab keine Treffer/i.test(html)) return { total: 0, listings: [] };
  const listings = [];
  for (const m of html.matchAll(/<button\b[^>]*\bjs-bookmark-btn\b[^>]*>/g)) {
    const tag = m[0];
    const sourceId = attr(tag, 'data-id');
    const path = attr(tag, 'data-url');
    if (!sourceId || !path) continue;
    const title = attr(tag, 'data-title') ?? '';
    const address = attr(tag, 'data-address') ?? '';
    const pc = /\b(\d{4})\b\s*(.*)$/.exec(address);
    const image = attr(tag, 'data-image');
    const url = new URL(path, ORIGIN).href;
    listings.push({
      id: `sn:${sourceId}`,
      source: 'sn',
      sourceId,
      type: HOUSE.test(title) ? 'house' : 'apartment',
      forSale: false,
      url,
      title,
      price: toNumber(/([\d.]+(?:,\d+)?)/.exec(attr(tag, 'data-price') ?? '')?.[1]),
      area: toNumber(attr(tag, 'data-space')),
      rooms: toNumber(attr(tag, 'data-rooms')),
      deposit: null,
      ...locate({ postcode: pc?.[1], city: pc?.[2], street: pc ? address.slice(0, pc.index).replace(/[,\s]+$/, '') : null, text: address }),
      lat: null,
      lng: null,
      images: image ? [image.replace(/safescale=[^"]*$/, 'safescale=1200x900')] : [],
      description: null,
      sourceUrl: url,
      sourceHost: 'immo.sn.at',
      publishedAt: null,
      isPrivate: false,
      agency: null,
      floor: null,
      extras: [],
    });
  }
  return { total: toNumber(/breadcrumb-item active">\s*([\d.]+)\s*Ergebnisse/.exec(html)?.[1]) ?? 0, listings };
}

export async function search(prefs, { onProgress = () => {} } = {}) {
  const slugs = prefs?.states?.length ? prefs.states.filter((s) => STATE_SLUGS.includes(s)) : STATE_SLUGS;
  const byId = new Map();
  let partial = false;
  for (const slug of slugs) {
    for (let page = 1; page <= MAX_PAGES; page++) {
      let parsed;
      try {
        parsed = parsePage(await fetchText(searchUrl(prefs, slug, page), { retries: 1, timeout: 15000 }));
      } catch (err) {
        if (page === 1 && slug === slugs[0]) throw err;
        partial = true;
        break;
      }
      const before = byId.size;
      for (const l of parsed.listings) byId.set(l.id, l);
      onProgress(byId.size);
      if (byId.size === before || page * PAGE_SIZE >= parsed.total) break;
      if (page === MAX_PAGES) partial = true;
    }
  }
  const types = prefs?.types?.length ? prefs.types : ['apartment', 'house'];
  return { listings: applyPrefs([...byId.values()].filter((l) => types.includes(l.type)), prefs), partial };
}
