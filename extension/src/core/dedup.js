import { haversineMeters } from './geo.js';

const SOURCE_PRIORITY = ['willhaben', 'immoscout', 'cooperatives', 'justimmo', 'wunderflats', 'fify'];
const CROSS_SOURCE_THRESHOLD = 5;
const SAME_SOURCE_THRESHOLD = 6;
const TITLE_INFO_SATURATION = 15;
const MAX_PRECISE_DISTANCE_M = 2500;
const UNRELIABLE_AREA_SOURCES = new Set();
const NET_RENT_SOURCES = new Set();
const NET_TO_GROSS_RATIO = [0.6, 0.88];
const HARD_CONFLICT = -Infinity;

const STOPWORDS = new Set([
  'und', 'mit', 'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einer', 'im', 'in', 'zu', 'zur', 'zum',
  'von', 'vom', 'bei', 'nahe', 'wien', 'wohnung', 'miete', 'mietwohnung', 'zimmer', 'top', 'for', 'rent', 'the',
  'and', 'apartment', 'with', 'vienna', 'bezirk', 'ab', 'sofort', 'neu', 'new', 'vermieten', 'zum', 'auf', 'fur',
]);
const LEGAL_WORDS = new Set([
  'gmbh', 'mbh', 'gesmbh', 'ges', 'gesellschaft', 'co', 'kg', 'og', 'ag', 'immobilien', 'immobilienmakler',
  'immobilientreuhand', 'realitaten', 'real', 'estate', 'und', 'makler', 'treuhand', 'vermittlung',
]);
const STREET_SUFFIX = /(strasse|gasse|weg|platz|allee|ring|kai|zeile|promenade|steig|damm|markt|lande|ufer|brucke|berg|hof|park|siedlung|graben|gurtel|anger|feld)$/;

const normalize = (text) => (text ?? '')
  .toLowerCase()
  .replace(/ß/g, 'ss')
  .normalize('NFKD')
  .replace(/[̀-ͯ]/g, '');

function titleTokens(title) {
  return [...new Set(normalize(title).split(/[^a-z0-9]+/).filter((t) => (t.length > 2 || /\d/.test(t)) && !STOPWORDS.has(t)))];
}

const titleKey = (title) => normalize(title).replace(/[^a-z0-9]+/g, ' ').trim();

export function streetOf(address) {
  for (const part of (address ?? '').split(',')) {
    const raw = normalize(part).trim();
    if (!raw || /\b\d{4}\b/.test(raw)) continue;
    const street = raw
      .replace(/\b(stiege|stg|top|tur|tuer)\b.*$/, '')
      .replace(/str\b\.?/g, 'strasse')
      .replace(/[^a-z]/g, '');
    if (street.length >= 6 && STREET_SUFFIX.test(street)) return street;
  }
  return null;
}

export function normalizeImageKey(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (/(?:^|\.)justimmo\.at$/i.test(u.hostname)) return `justimmo/${u.pathname.split('/').pop()}`.toLowerCase();
    let pathname = u.pathname;
    pathname = pathname.replace(/\/(?:large|small|medium|thumb|thumbs|thumbnail|mini|preview|\d+x\d+|fc_h\d+(?:_w\d+)?)\//gi, '/');
    pathname = pathname.replace(/[-_](?:hd|2xl|xl|lg|md|sm|xs|org|large|medium|small|thumb|thumbnail|preview|\d+x\d+)\.(webp|jpg|jpeg|png|avif)$/i, '.$1');
    return `${u.hostname}${pathname}`.toLowerCase();
  } catch {
    return String(rawUrl).toLowerCase();
  }
}

export function imageQualityScore(url) {
  let score = 0;
  const lower = url.toLowerCase();
  if (lower.includes('_hd') || lower.includes('_2xl') || lower.includes('_org') || lower.includes('original') || lower.includes('/large/')) score += 100;
  if (lower.includes('_xl') || lower.includes('_lg') || lower.includes('1920') || lower.includes('1080')) score += 60;
  if (lower.includes('_md') || lower.includes('medium') || lower.includes('800')) score += 30;
  if (lower.includes('_xs') || lower.includes('_sm') || lower.includes('small') || lower.includes('thumb') || lower.includes('mini') || lower.includes('200')) score -= 50;

  const dim = /(\d{3,4})x(\d{3,4})/.exec(lower);
  if (dim) score += parseInt(dim[1], 10);

  const justimmoDim = /fc_h(\d+)(?:_w(\d+))?/.exec(lower);
  if (justimmoDim) score += parseInt(justimmoDim[1], 10);

  return score;
}

export function dedupeImageUrls(urls, baseUrl = '') {
  if (!Array.isArray(urls) || !urls.length) return [];
  const byKey = new Map();
  const order = [];

  for (const raw of urls) {
    if (!raw || typeof raw !== 'string') continue;
    let fullUrl = raw;
    if (baseUrl) {
      try {
        fullUrl = new URL(raw, baseUrl).href;
      } catch {}
    }
    const lower = fullUrl.toLowerCase();
    if (
      lower.includes('logo') ||
      lower.includes('icon') ||
      lower.includes('avatar') ||
      lower.includes('banner') ||
      lower.includes('prismic.io') ||
      lower.includes('badge') ||
      lower.includes('/person/') ||
      lower.includes('/user/') ||
      lower.includes('placeholder') ||
      lower.includes('/public/pic/user') ||
      /storage\.justimmo\.at\/file\/[^/]+\.png$/.test(lower) ||
      Number(/justimmo\.at\/thumb\/[^/]+\/[^/]*?_h(\d+)[_/]/.exec(lower)?.[1] ?? 1000) < 200
    ) {
      continue;
    }

    const key = normalizeImageKey(fullUrl);
    if (!byKey.has(key)) {
      byKey.set(key, fullUrl);
      order.push(key);
    } else {
      const existing = byKey.get(key);
      if (imageQualityScore(fullUrl) > imageQualityScore(existing)) {
        byKey.set(key, fullUrl);
      }
    }
  }

  return order.map((k) => byKey.get(k));
}

const streetsMatch = (a, b) => a === b || a.endsWith(b) || b.endsWith(a);

function agencyTokens(name) {
  return new Set(normalize(name).split(/[^a-z0-9]+/).filter((t) => t.length >= 4 && !LEGAL_WORDS.has(t)));
}

function editDistanceAtMostOne(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

function titleSimilarity(a, b, idf) {
  const bSet = new Set(b._tokens);
  const unmatchedB = new Set(b._tokens);
  let shared = 0;
  let onlyA = 0;
  for (const t of a._tokens) {
    if (bSet.has(t)) {
      shared += idf(t);
      unmatchedB.delete(t);
      continue;
    }
    const fuzzy = t.length >= 6 && [...unmatchedB].find((u) => u.length >= 6 && editDistanceAtMostOne(t, u));
    if (fuzzy) {
      shared += Math.min(idf(t), idf(fuzzy));
      unmatchedB.delete(fuzzy);
    } else {
      onlyA += idf(t);
    }
  }
  let onlyB = 0;
  for (const t of unmatchedB) onlyB += idf(t);
  const union = shared + onlyA + onlyB;
  return { sim: union ? shared / union : 0, info: Math.min(1, shared / TITLE_INFO_SATURATION) };
}

function templateTitles(items) {
  const prices = new Map();
  for (const item of items) {
    if (NET_RENT_SOURCES.has(item.source) || item.price == null) continue;
    const key = `${item.source}|${titleKey(item.title)}`;
    if (!prices.has(key)) prices.set(key, new Set());
    prices.get(key).add(Math.round(item.price));
  }
  return new Set([...prices].filter(([, set]) => set.size > 1).map(([key]) => key.slice(key.indexOf('|') + 1)));
}

function prepare(listings) {
  const items = listings.map((l) => ({ ...l, _tokens: titleTokens(l.title), _street: streetOf(l.address), _agency: agencyTokens(l.agency) }));
  const templates = templateTitles(items);
  for (const item of items) item._template = templates.has(titleKey(item.title));
  const df = new Map();
  for (const item of items) for (const t of item._tokens) df.set(t, (df.get(t) ?? 0) + 1);
  const n = items.length;
  const idf = (t) => Math.log((n + 1) / ((df.get(t) ?? 0) + 1)) + 1;
  return { items, idf };
}

export function compare(a, b, idf) {
  if (a.postcode && b.postcode && a.postcode !== b.postcode) return HARD_CONFLICT;
  const roomDiff = a.rooms != null && b.rooms != null ? Math.abs(a.rooms - b.rooms) : 0;
  if (roomDiff > 1) return HARD_CONFLICT;
  const precise = a._street && b._street && a.lat != null && b.lat != null;
  const distance = precise ? haversineMeters(a, b) : null;
  if (distance != null && distance > MAX_PRECISE_DISTANCE_M) return HARD_CONFLICT;

  const { sim, info } = titleSimilarity(a, b, idf);
  const titleConfirmed = sim >= 0.9 && info >= 0.8;
  let score = 5 * sim * info;

  const areaUnreliable = UNRELIABLE_AREA_SOURCES.has(a.source) || UNRELIABLE_AREA_SOURCES.has(b.source);
  const areaDiff = a.area != null && b.area != null ? Math.abs(a.area - b.area) : null;
  if (areaDiff != null) score += areaDiff <= 0.6 ? 2.5 : areaDiff <= 2 ? 1.5 : areaDiff <= 5 || areaUnreliable ? 0 : -2;

  const sameSource = a.source === b.source;
  const hasPrices = a.price != null && b.price != null;
  const priceAbs = hasPrices ? Math.abs(a.price - b.price) : 0;
  const priceRel = hasPrices ? priceAbs / Math.max(a.price, b.price) : 0;
  const priceMatches = priceAbs <= 1 || priceRel <= 0.005;
  const ratio = hasPrices ? Math.min(a.price, b.price) / Math.max(a.price, b.price) : 1;
  const netVsGross = hasPrices && titleConfirmed
    && (NET_RENT_SOURCES.has(a.source) || NET_RENT_SOURCES.has(b.source))
    && ratio >= NET_TO_GROSS_RATIO[0] && ratio <= NET_TO_GROSS_RATIO[1]
    && ((areaDiff != null && areaDiff <= 2) || (sameSource && areaUnreliable));
  if (hasPrices) {
    const round = a.price % 50 === 0 && b.price % 50 === 0;
    score += priceAbs <= 1 ? (round ? 2 : 3)
      : priceRel <= 0.005 ? 2
        : priceRel <= 0.03 ? 1
          : netVsGross ? 0
            : priceRel <= 0.1 ? (titleConfirmed ? 0 : -1)
              : -2;
  }

  if (a._street && b._street) score += streetsMatch(a._street, b._street) ? 1.5 : -4;
  if (distance != null && distance < 150) score += 1;
  if ([...a._agency].some((t) => b._agency.has(t))) score += 1;
  if (!a.postcode || !b.postcode) score -= 1;
  if (roomDiff > 0.5) score -= 2.5;

  const capped = Math.min(score, CROSS_SOURCE_THRESHOLD - 1);
  if ((a._template || b._template) && !priceMatches) return capped;
  if (sameSource) {
    const sameUnit = areaUnreliable || (areaDiff != null && areaDiff <= 1);
    const sameRooms = roomDiff <= 0.5;
    const samePrice = priceMatches || netVsGross;
    if (!titleConfirmed || !sameUnit || !sameRooms || !samePrice) return capped;
  }
  return score;
}

const thresholdFor = (a, b) => (a.source === b.source ? SAME_SOURCE_THRESHOLD : CROSS_SOURCE_THRESHOLD);

function pickPrimary(members) {
  return [...members].sort((x, y) => SOURCE_PRIORITY.indexOf(x.source) - SOURCE_PRIORITY.indexOf(y.source)
    || (y.images?.length ?? 0) - (x.images?.length ?? 0))[0];
}

function buildGroup(members) {
  const primary = pickPrimary(members);
  const ordered = [primary, ...members.filter((m) => m !== primary)
    .sort((x, y) => SOURCE_PRIORITY.indexOf(x.source) - SOURCE_PRIORITY.indexOf(y.source))];
  const first = (key) => ordered.find((m) => m[key] != null && m[key] !== '')?.[key] ?? null;
  const prices = members.map((m) => m.price).filter((p) => p != null);
  const dates = (key) => members.map((m) => m[key]).filter(Boolean).sort();
  const images = dedupeImageUrls(ordered.reduce((best, m) => ((m.images?.length ?? 0) > best.length ? m.images : best), []));
  const description = ordered.map((m) => m.description).filter(Boolean).sort((x, y) => y.length - x.length)[0] ?? null;
  const address = ordered.map((m) => m.address).filter(Boolean).sort((x, y) => y.length - x.length)[0] ?? null;
  const price = primary.price ?? prices[0] ?? null;
  const area = first('area');
  return {
    id: [...members].map((m) => m.id).sort()[0],
    type: primary.type ?? 'apartment',
    title: primary.title,
    price,
    priceMin: prices.length ? Math.min(...prices) : null,
    priceMax: prices.length ? Math.max(...prices) : null,
    area,
    rooms: first('rooms'),
    pricePerSqm: price && area ? Math.round((price / area) * 100) / 100 : null,
    postcode: first('postcode'),
    state: first('state'),
    city: first('city'),
    district: first('district'),
    address,
    lat: first('lat'),
    lng: first('lng'),
    images,
    description,
    publishedAt: dates('publishedAt')[0] ?? null,
    firstSeen: dates('firstSeen')[0] ?? null,
    isPrivate: first('isPrivate'),
    agency: first('agency'),
    deposit: first('deposit'),
    floor: first('floor'),
    extras: [...new Set(members.flatMap((m) => m.extras ?? []))],
    portals: new Set(members.map((m) => m.source)).size,
    sources: ordered.map((m) => ({
      id: m.id,
      source: m.source,
      url: m.url,
      title: m.title,
      price: m.price,
      area: m.area,
      rooms: m.rooms,
      firstSeen: m.firstSeen,
      sourceUrl: m.sourceUrl ?? null,
      sourceHost: m.sourceHost ?? null,
      agency: m.agency ?? null,
    })),
  };
}

export function dedupe(listings) {
  const { items, idf } = prepare(listings);
  const n = items.length;
  const memo = new Map();
  const score = (i, j) => {
    const key = i < j ? i * n + j : j * n + i;
    if (!memo.has(key)) memo.set(key, compare(items[i], items[j], idf));
    return memo.get(key);
  };

  const byPostcode = new Map();
  items.forEach((item, i) => {
    const key = item.postcode ?? '?';
    if (!byPostcode.has(key)) byPostcode.set(key, []);
    byPostcode.get(key).push(i);
  });
  const unknown = byPostcode.get('?') ?? [];

  const pairs = [];
  const consider = (i, j) => {
    const s = score(i, j);
    if (s >= thresholdFor(items[i], items[j])) pairs.push([s, i, j]);
  };
  for (const [key, members] of byPostcode) {
    for (let x = 0; x < members.length; x++) {
      for (let y = x + 1; y < members.length; y++) consider(members[x], members[y]);
      if (key !== '?') for (const u of unknown) consider(members[x], u);
    }
  }
  pairs.sort((p, q) => q[0] - p[0]);

  const cluster = items.map((_, i) => [i]);
  const owner = items.map((_, i) => i);
  const compatible = (ci, cj) => cluster[ci].every((x) => cluster[cj].every((y) => {
    const s = score(x, y);
    return s !== HARD_CONFLICT && (items[x].source !== items[y].source || s >= SAME_SOURCE_THRESHOLD);
  }));

  for (const [, i, j] of pairs) {
    const ci = owner[i];
    const cj = owner[j];
    if (ci === cj || !compatible(ci, cj)) continue;
    for (const m of cluster[cj]) owner[m] = ci;
    cluster[ci].push(...cluster[cj]);
    cluster[cj] = [];
  }

  const strip = ({ _tokens, _street, _agency, _template, ...listing }) => listing;
  return cluster.filter((c) => c.length).map((c) => buildGroup(c.map((i) => strip(items[i]))));
}
