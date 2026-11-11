import { decodeEntities, fetchText } from '../http.js';
import { toNumber } from '../geo.js';
import { applyPrefs, locate, outOfScope, pMap, reusable } from './crawl.js';
import { PARSER_VERSION } from './directParser.js';

export const id = 'findmyhome';
export const label = 'FindMyHome';
export const kind = 'portal';

const ORIGIN = 'https://www.findmyhome.at';
const CHARSET = 'windows-1252';
const PAGE_SIZE = 30;
const MAX_PAGES = 30;
const TYPE_PARAM = { apartment: 'w_m', house: 'h_m' };
const STATE_IDS = { burgenland: 1, kaernten: 2, niederoesterreich: 3, oberoesterreich: 4, salzburg: 5, steiermark: 6, tirol: 7, vorarlberg: 8, wien: 9 };

const absolute = (src) => (src ? new URL(src, ORIGIN).href : null);

const text = (html) => decodeEntities(decodeEntities((html ?? '').replace(/<[^>]+>/g, ' '))).replace(/\s+/g, ' ').trim();

export function searchUrl(prefs, type, state, entry) {
  const params = new URLSearchParams({ id: '14', module: 'select', lang: 'de', land: 'AT', plzRegionToggle: '0', [TYPE_PARAM[type]]: '1', bl: String(STATE_IDS[state]), pp: String(PAGE_SIZE), entry: String(entry) });
  if (prefs?.maxPrice) params.set('prb', String(prefs.maxPrice));
  if (prefs?.minArea) params.set('flv', String(prefs.minArea));
  if (prefs?.minRooms) params.set('zimmer', String(prefs.minRooms));
  return `${ORIGIN}/index.php?${params}`;
}

export function parseCards(html) {
  const cards = new Map();
  for (const chunk of html.split(/<div class="row margin-top-20">/).slice(1)) {
    const sourceId = /href='\/(\d{6,})/.exec(chunk)?.[1];
    if (!sourceId || cards.has(sourceId)) continue;
    const ort = /<strong>Ort:\s*(\d{4})<\/strong>\s*([^<]*)/.exec(chunk);
    cards.set(sourceId, {
      sourceId,
      postcode: ort?.[1] ?? null,
      city: ort ? text(ort[2]) : null,
      title: text(/class='btnHeadlineErgebnisliste'>([\s\S]*?)<\/a>/.exec(chunk)?.[1]),
      description: text(/class="immobilie_description[^"]*">([\s\S]*?)<a /.exec(chunk)?.[1]) || null,
      image: absolute(/<img src='([^']+)'/.exec(chunk)?.[1]),
      price: toNumber(/Mieten:\s*<\/strong><br>\s*([\d.,]+)/.exec(chunk)?.[1]),
      area: toNumber(/Fl&auml;che:\s*<\/strong><br>\s*([\d.,]+)/.exec(chunk)?.[1]),
      rooms: toNumber(/Zimmer:\s*<\/strong><br>\s*([\d.,]+)/.exec(chunk)?.[1]),
    });
  }
  return [...cards.values()];
}

export function parseDetail(html) {
  const layer = (key) => new RegExp(`'${key}':\\s*'([^']*)'`).exec(html)?.[1] ?? null;
  const title = text(/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1]).replace(/\s*-\s*Objektnr\.\s*\d+\s*$/, '');
  const images = [...new Set([...html.matchAll(/<img\b[^>]*>/g)]
    .filter((m) => /class="sliderGal"/.test(m[0]))
    .map((m) => /\bsrc="([^"]+)"/.exec(m[0])?.[1])
    .filter(Boolean)
    .map(absolute))];
  return {
    title: title || null,
    price: toNumber(layer('Immo_Preis')),
    area: toNumber(layer('Immo_Flaeche')),
    rooms: toNumber(layer('Immo_Zimmer')),
    postcode: layer('Immo_Lage'),
    kind: layer('Immo_Objektart'),
    rent: /miete/i.test(layer('Immo_Erwerbsart') ?? 'miete'),
    images,
  };
}

async function fetchCards(prefs, type, state) {
  const cards = new Map();
  for (let page = 0; page < MAX_PAGES; page++) {
    const html = await fetchText(searchUrl(prefs, type, state, page * PAGE_SIZE), { retries: 1, timeout: 15000, charset: CHARSET });
    const before = cards.size;
    for (const c of parseCards(html)) if (!cards.has(c.sourceId)) cards.set(c.sourceId, { ...c, type });
    const total = toNumber(/([\d.]+) Immobilien/.exec(html)?.[1]) ?? 0;
    if (cards.size === before || (page + 1) * PAGE_SIZE >= total) break;
  }
  return [...cards.values()];
}

export async function search(prefs, { onProgress = () => {}, stored } = {}) {
  const types = (prefs?.types?.length ? prefs.types : ['apartment']).filter((t) => TYPE_PARAM[t]);
  const states = prefs?.states?.length ? prefs.states.filter((s) => STATE_IDS[s]) : Object.keys(STATE_IDS);
  const cardLists = await pMap(types.flatMap((t) => states.map((s) => [t, s])), 3, async ([t, s]) => {
    try {
      return await fetchCards(prefs, t, s);
    } catch (err) {
      console.warn(`[findmyhome] ${t}/${s} failed:`, err?.message);
      return [];
    }
  });
  const seen = new Set();
  const cards = cardLists.flat().filter((c) => !seen.has(c.sourceId) && seen.add(c.sourceId) && !outOfScope(c, prefs));

  let count = 0;
  const listings = await pMap(cards, 6, async (card) => {
    const listingId = `findmyhome:${card.sourceId}`;
    const known = stored?.get(listingId);
    if (reusable(known)) {
      onProgress(++count);
      return known;
    }
    const url = `${ORIGIN}/${card.sourceId}`;
    let detail = {};
    try {
      detail = parseDetail(await fetchText(url, { retries: 1, timeout: 15000, charset: CHARSET }));
    } catch {
      detail = {};
    }
    if (detail.rent === false || (detail.kind && !/wohnung|haus|zimmer|appartement|apartment|loft|maisonette|penthouse/i.test(detail.kind))) return null;
    onProgress(++count);
    return {
      id: listingId,
      source: 'findmyhome',
      sourceId: card.sourceId,
      parserVersion: PARSER_VERSION,
      type: card.type,
      forSale: false,
      url,
      title: detail.title || card.title,
      price: detail.price ?? card.price,
      area: detail.area ?? card.area,
      rooms: detail.rooms ?? card.rooms,
      deposit: null,
      ...locate({ postcode: detail.postcode || card.postcode, city: card.city }),
      lat: null,
      lng: null,
      images: detail.images?.length ? detail.images : [card.image].filter(Boolean),
      description: card.description,
      sourceUrl: url,
      sourceHost: 'findmyhome.at',
      publishedAt: null,
      isPrivate: false,
      agency: null,
      floor: null,
      extras: [],
    };
  });

  return applyPrefs(listings, prefs);
}
