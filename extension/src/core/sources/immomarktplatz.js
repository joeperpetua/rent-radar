import { decodeEntities, fetchText } from '../http.js';
import { toNumber } from '../geo.js';
import { PARSER_VERSION, parseDirectListing } from './directParser.js';
import { applyPrefs, locate, outOfScope, pMap, reusable } from './crawl.js';

const ORIGIN = 'https://www.immomarktplatz.at';
const NAME = 'Immomarktplatz';
const PAGE_SIZE = 20;
const MAX_PAGES = 40;
const STATE_IDS = { burgenland: 1, kaernten: 2, niederoesterreich: 3, oberoesterreich: 4, salzburg: 5, steiermark: 6, tirol: 7, vorarlberg: 8, wien: 9 };
const OBJECT_TYPES = { apartment: '2', house: '3' };
const SESSION = { credentials: 'include', retries: 1, timeout: 15000 };

const text = (html) => decodeEntities((html ?? '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

export function filterBody(prefs, state) {
  const p = new URLSearchParams();
  const f = (key, value) => p.append(`objekt_filters_wohnen[${key}]`, value);
  f('mandanten_id', '');
  f('nutzung', 'wohnen');
  f('vermarktung][', '2');
  f('land_bundesland_id', state ? String(STATE_IDS[state]) : 'AUT');
  for (const type of prefs?.types?.length ? prefs.types : ['apartment']) if (OBJECT_TYPES[type]) f('objektart_id][', OBJECT_TYPES[type]);
  f('preis_von', prefs?.minPrice ? String(prefs.minPrice) : '');
  f('preis_bis', prefs?.maxPrice ? String(prefs.maxPrice) : '');
  f('wohnflaeche_von', prefs?.minArea ? String(prefs.minArea) : '');
  f('wohnflaeche_bis', prefs?.maxArea ? String(prefs.maxArea) : '');
  f('zimmer_von', prefs?.minRooms ? String(prefs.minRooms) : '');
  f('zimmer_bis', prefs?.maxRooms ? String(prefs.maxRooms) : '');
  f('ort_input', '');
  f('stichwort', '');
  return p.toString();
}

export function parseResults(html) {
  const rows = [];
  for (const [row] of html.matchAll(/<tr itemscope itemtype="http:\/\/schema\.org\/Offer">[\s\S]*?<\/tr>/g)) {
    const href = /itemprop="url" href="(\/de\/immobilien\/(\d+)-[^"]*)"/.exec(row);
    if (!href) continue;
    const category = text(/itemprop="category">([\s\S]*?)<\/span>/.exec(row)?.[1]);
    rows.push({
      sourceId: href[2],
      url: new URL(href[1], ORIGIN).href,
      title: text(/itemprop="name">([\s\S]*?)<\/h3>/.exec(row)?.[1]),
      postcode: /itemprop="postalCode">\s*(\d{4})/.exec(row)?.[1] ?? null,
      city: text(/itemprop="addressLocality">([\s\S]*?)<\/span>/.exec(row)?.[1]) || null,
      category,
      rent: /goodrelations\/v1#LeaseOut/.test(row),
      price: toNumber(/itemprop="price">\s*([\d.,]+)/.exec(row)?.[1]),
      image: /itemprop="image" src="([^"]+)"/.exec(row)?.[1] ?? null,
    });
  }
  return { total: toNumber(/([\d.]+)\s*Ergebnisse/.exec(html)?.[1]) ?? 0, rows };
}

export function parseDetail(html) {
  const images = [...new Set([...html.matchAll(/https:\/\/files\.immomarktplatz\.at\/public\/pic\/t4\/[A-Za-z0-9_-]+\.(?:jpe?g|png|webp)/g)].map((m) => m[0]))];
  const seller = /itemprop="seller"[\s\S]*?<img[^>]*\balt="([^"]+)"/.exec(html)?.[1];
  const description = text(/Beschreibung der Immobilie\s*<\/h\d>([\s\S]*?)<h\d/.exec(html)?.[1] ?? /Beschreibung der Immobilie([\s\S]{0,4000}?)<h\d/.exec(html)?.[1]);
  return { images, agency: seller ? decodeEntities(seller) : null, description: description || null };
}

async function stateRows(prefs, state) {
  await fetchText(`${ORIGIN}/de/immobilien?reset_filter`, SESSION);
  await fetchText(`${ORIGIN}/de/immobilien`, { ...SESSION, method: 'POST', body: filterBody(prefs, state), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  const rows = new Map();
  let partial = false;
  for (let page = 1; page <= MAX_PAGES; page++) {
    let parsed;
    try {
      parsed = parseResults(await fetchText(`${ORIGIN}/de/immobilien?page=${page}`, SESSION));
    } catch (err) {
      if (page === 1) throw err;
      partial = true;
      break;
    }
    if (page === 1 && parsed.rows.some((r) => !r.rent)) throw new Error('search filter was not applied');
    const before = rows.size;
    for (const r of parsed.rows) rows.set(r.sourceId, r);
    if (rows.size === before || page * PAGE_SIZE >= parsed.total) break;
    if (page === MAX_PAGES) partial = true;
  }
  return { rows: [...rows.values()], partial };
}

export async function search(prefs, { onProgress = () => {}, stored } = {}) {
  const states = prefs?.states?.length ? prefs.states.filter((s) => STATE_IDS[s]) : [null];
  const rows = new Map();
  let partial = false;
  for (const state of states) {
    const result = await stateRows(prefs, state);
    partial ||= result.partial;
    for (const r of result.rows) rows.set(r.sourceId, r);
  }
  const candidates = [...rows.values()].filter((r) => r.rent && /wohnung|haus/i.test(r.category || 'wohnung') && !outOfScope(r, prefs));

  let count = 0;
  const listings = await pMap(candidates, 6, async (card) => {
    const listingId = `immo:immomarktplatz:${card.sourceId}`;
    const known = stored?.get(listingId);
    if (reusable(known)) {
      onProgress(++count);
      return known;
    }
    try {
      const html = await fetchText(card.url, { retries: 1, timeout: 15000 });
      const parsed = parseDirectListing(html, card.url);
      if (parsed.inactive || parsed.forSale) return null;
      const detail = parseDetail(html);
      onProgress(++count);
      return {
        id: listingId,
        source: 'immo',
        sourceId: `immomarktplatz:${card.sourceId}`,
        sourceName: NAME,
        parserVersion: PARSER_VERSION,
        type: /haus/i.test(card.category) ? 'house' : 'apartment',
        forSale: false,
        url: card.url,
        title: card.title,
        price: parsed.price ?? card.price,
        area: parsed.area,
        rooms: parsed.rooms,
        deposit: parsed.deposit,
        ...locate({ postcode: card.postcode, city: card.city }),
        lat: parsed.lat ?? null,
        lng: parsed.lng ?? null,
        images: detail.images.length ? detail.images : [card.image].filter(Boolean),
        description: detail.description,
        sourceUrl: card.url,
        sourceHost: 'immomarktplatz.at',
        publishedAt: null,
        isPrivate: false,
        agency: detail.agency,
        floor: null,
        extras: [],
      };
    } catch {
      return null;
    }
  });

  return { listings: applyPrefs(listings, prefs), partial };
}
