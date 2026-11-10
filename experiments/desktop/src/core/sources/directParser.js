import { decodeEntities } from '../http.js';
import { toNumber } from '../geo.js';
import { dedupeImageUrls } from '../dedup.js';

/**
 * Universal Direct Source Detail Parser
 * Parses property pages directly from original Austrian real estate hosts
 * (JustImmo brokers, Housing Cooperatives, Fify/Dynamo, Wunderflats, onOffice, EDI-Real, WordPress/independents).
 */

const INACTIVE_PATTERNS = [
  /inactive_property_id/i,
  /search-object-not-found/i,
  /objekt-nicht-gefunden/i,
  /dieses objekt ist leider nicht mehr verf[üu]gbar/i,
  /objekt nicht mehr verf[üu]gbar/i,
  /objekt wurde vergeben/i,
  /bereits vergeben/i,
  /nicht mehr online/i,
  /\bvermietet\b/i,
  /\bvergeben\b/i,
  /\bdeaktiviert\b/i,
];

/**
 * Normalizes an area value from a string (e.g. "ca. 57,44 m²", "75 m2", "ca. 115,20 m<sup>2</sup>").
 */
export function parseArea(val) {
  if (val == null) return null;
  if (typeof val === 'number') return Number.isFinite(val) ? val : null;
  const str = String(val)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&sup2;/gi, '')
    .replace(/m\s*[\^]?\s*2\b/gi, '')
    .replace(/m²/gi, '')
    .replace(/qm\b/gi, '')
    .replace(/\bca\.?/gi, '')
    .trim();
  const m = /(\d+(?:[.,]\d+)?)/.exec(str);
  if (!m) return null;
  return toNumber(m[1]);
}

/**
 * Normalizes room counts (e.g. "3", "2.5", "2 Zimmer", "1-Zimmer-Wohnung").
 */
export function parseRooms(val) {
  if (val == null) return null;
  if (typeof val === 'number') return Number.isFinite(val) ? val : null;
  const str = String(val).replace(/<[^>]+>/g, ' ').trim();
  const m = /(\d+(?:[.,]\d+)?)/.exec(str);
  if (!m) return null;
  return toNumber(m[1]);
}

/**
 * Extracts key-value pairs from common real estate HTML structures:
 * - JustImmo / broker list items (.desc / .value)
 * - Tables (tr > th + td)
 * - Definition lists (dt + dd)
 */
export function extractKeyValuePairs(html) {
  const kv = {};

  // 1. Definition lists (<dt>Label</dt><dd>Value</dd>)
  const dlRegex = /<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi;
  for (const m of html.matchAll(dlRegex)) {
    const k = decodeEntities(m[1].replace(/<[^>]+>/g, '')).trim().toLowerCase().replace(/:$/, '');
    const v = decodeEntities(m[2].replace(/<[^>]+>/g, '')).trim();
    if (k && v && !kv[k]) kv[k] = v;
  }

  // 2. Table rows (<tr><th>Key</th><td>Value</td></tr> or <td>Key</td><td>Value</td>)
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  for (const m of html.matchAll(trRegex)) {
    const row = m[1];
    const cells = [...row.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) =>
      decodeEntities(c[1].replace(/<[^>]+>/g, '')).trim()
    );
    if (cells.length >= 2) {
      const k = cells[0].toLowerCase().replace(/:$/, '');
      const v = cells[1];
      if (k && v && !kv[k]) kv[k] = v;
    }
  }

  // 3. JustImmo / Broker list rows (<li class="..."><span class="desc">Key</span><span class="value">Val</span></li>)
  const liRegex = /<(?:li|div)[^>]*class="[^"]*(?:row|item|prop|spec|attr|feature|data|list-item|detail-item)[^"]*"[^>]*>([\s\S]*?)<\/(?:li|div)>/gi;
  for (const m of html.matchAll(liRegex)) {
    const item = m[1];
    const keyMatch = /class="[^"]*(?:desc|label|title|name|key)[^"]*"[^>]*>([\s\S]*?)<\/(?:span|div|p|dt|strong|b)>/i.exec(item);
    const valMatch = /class="[^"]*value[^"]*"[^>]*>([\s\S]*?)<\/(?:span|div|p|dd|strong|b)>/i.exec(item);
    if (keyMatch && valMatch) {
      const k = decodeEntities(keyMatch[1].replace(/<[^>]+>/g, '')).trim().toLowerCase().replace(/:$/, '');
      const v = decodeEntities(valMatch[1].replace(/<[^>]+>/g, '')).trim();
      if (k && v && !kv[k]) kv[k] = v;
    }
  }

  // Fallback for general <li> items
  const genLiRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  for (const m of html.matchAll(genLiRegex)) {
    const item = m[1];
    const keyMatch = /class="[^"]*(?:desc|label|title|name|key)[^"]*"[^>]*>([\s\S]*?)<\/(?:span|div|p|dt|strong|b)>/i.exec(item);
    const valMatch = /class="[^"]*value[^"]*"[^>]*>([\s\S]*?)<\/(?:span|div|p|dd|strong|b)>/i.exec(item);
    if (keyMatch && valMatch) {
      const k = decodeEntities(keyMatch[1].replace(/<[^>]+>/g, '')).trim().toLowerCase().replace(/:$/, '');
      const v = decodeEntities(valMatch[1].replace(/<[^>]+>/g, '')).trim();
      if (k && v && !kv[k]) kv[k] = v;
    }
  }

  return kv;
}

/**
 * Checks if a listing is for sale (buy / Kauf / Eigentum / Verkauf) instead of rent.
 */
export function isListingForSale(html, url = '', kv = null) {
  if (!html) return false;

  const data = kv || extractKeyValuePairs(html);

  const marketingType = (
    data.vermarktungsart
    || data.vertragsart
    || data.angebotsart
    || data.verkaufsart
    || data.geschaeftsart
    || data.rechtsform
    || ''
  ).toLowerCase();

  if (marketingType) {
    const isSale = /\b(?:kauf|verkauf|kaufen|eigentum)\b/i.test(marketingType);
    const isRent = /\b(?:miete|vermietung|pacht|nutzungsvertrag)\b/i.test(marketingType);
    if (isSale && !isRent) return true;
  }

  // Explicit purchase price without any rental amounts
  if (data.kaufpreis && !data.gesamtmiete && !data.bruttomiete && !data['miete brutto'] && !data.hauptmietzins && !data.nutzungsentgelt && !data['monatliches nutzungsentgelt']) {
    return true;
  }

  // Object type explicitly indicating purchase (Eigentumswohnung / Kaufobjekt) without rental agreement
  const objType = (data.objektart || data.typ || '').toLowerCase();
  if (objType && /\b(?:eigentumswohnung|kaufobjekt|kaufimmobilie)\b/i.test(objType) && !marketingType.includes('miete')) {
    return true;
  }

  // URL path signals (e.g. /kauf/, /kaufen/, /eigentumswohnungen/)
  if (url) {
    try {
      const pathname = new URL(url).pathname.toLowerCase();
      if (/(?:\/|^)(?:kauf|kaufen|eigentumswohnungen|kaufobjekte|kaufimmobilien)(?:\/|$)/.test(pathname) && !pathname.includes('miete')) {
        return true;
      }
    } catch {}
  }

  // Schema.org JSON-LD signals
  if (/<script type="application\/ld\+json">/i.test(html)) {
    if (/"@type"\s*:\s*"OfferForSale"/i.test(html)) return true;
    if (/"businessFunction"\s*:\s*"http:\/\/purl\.org\/goodrelations\/v1#Sell"/i.test(html)) return true;
  }

  // Title indicating purchase/sale
  const title = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || '');
  if (/\b(?:Kaufobjekt|Eigentumswohnung|Kaufimmobilie|zu verkaufen)\b/i.test(title) && !/\b(?:Miete|Mietwohnung|vermieten)\b/i.test(title)) {
    return true;
  }

  return false;
}

/**
 * Checks if a listing page indicates the ad is gone/inactive.
 */
export function isListingInactive(html, finalUrl = '', statusCode = 200) {
  if (statusCode === 404 || statusCode === 410 || statusCode === 403) return true;
  if (!html) return true;
  if (isListingForSale(html, finalUrl)) return true;

  if (finalUrl) {
    for (const pat of INACTIVE_PATTERNS) {
      if (pat.test(finalUrl)) return true;
    }
  }

  // Check head title or prominent badge
  const title = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || '');
  for (const pat of INACTIVE_PATTERNS) {
    if (pat.test(title)) return true;
  }

  // Prominent badges or banners
  const badgeRegex = /<(?:div|span|p|h[1-6]|b|strong)[^>]*class="[^"]*(?:badge|status|alert|warning|ribbon|sold|rented|inactive)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|span|p|h[1-6]|b|strong)>/gi;
  for (const m of html.matchAll(badgeRegex)) {
    const text = m[1].replace(/<[^>]+>/g, '').trim();
    for (const pat of INACTIVE_PATTERNS) {
      if (pat.test(text)) return true;
    }
  }

  return false;
}

/**
 * Parses a direct listing page HTML.
 */
export function parseDirectListing(html, url = '', statusCode = 200) {
  if (!html || isListingInactive(html, url, statusCode)) {
    return { inactive: true, forSale: isListingForSale(html, url) };
  }

  const cleanHtml = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ');

  const plainText = cleanHtml
    .replace(/<[^>]+>/g, ' ')
    .replace(/&shy;/gi, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&euro;/g, '€')
    .replace(/\s+/g, ' ');

  // 1. JSON-LD Nodes
  const jsonldNodes = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].flatMap((m) => {
    try {
      const parsed = JSON.parse(m[1]);
      return [].concat(parsed['@graph'] || parsed);
    } catch {
      return [];
    }
  });

  const accommodationTypes = ['Apartment', 'House', 'SingleFamilyResidence', 'Accommodation', 'Place', 'Residence'];
  const accommodation = jsonldNodes.find((n) => {
    const t = [].concat(n['@type'] || []);
    return t.some((type) => accommodationTypes.includes(type));
  }) || {};

  const listingNode = jsonldNodes.find((n) => {
    const t = [].concat(n['@type'] || []);
    return t.includes('RealEstateListing') || t.includes('Product');
  }) || {};

  const listing = { ...accommodation, ...listingNode };

  const agent = jsonldNodes.find((n) => {
    const t = [].concat(n['@type'] || []);
    return t.includes('RealEstateAgent') || t.includes('LocalBusiness') || t.includes('Organization');
  }) || {};

  const offers = [].concat(listing.offers || listingNode.offers || [])[0] || {};
  const place = accommodation.address ? accommodation : (offers.itemOffered || listing.itemOffered || accommodation);

  // 2. Structured Key-Value Pairs
  const kv = extractKeyValuePairs(cleanHtml);
  if (isListingForSale(cleanHtml, url, kv)) {
    return { inactive: true, forSale: true };
  }
  const keys = Object.keys(kv);

  function matchFact(regexes) {
    for (const re of regexes) {
      const m = re.exec(plainText);
      if (m && m[1]) return m[1].trim();
    }
    return null;
  }

  // --- Area ---
  const areaKey = keys.find((k) => k === 'wohnfläche' || k === 'nutzfläche' || k === 'gesamtnutzfläche' || k === 'fläche');
  const areaRaw = place.floorSize?.value
    || place.floorSize
    || listing.floorSize?.value
    || listing.floorSize
    || (areaKey ? kv[areaKey] : null)
    || matchFact([
      /(?:Wohnfl[aä]che|Nutzfl[aä]che|Gesamtnutzfl[aä]che|Fl[aä]che)\s*(?:ca\.?)?\s*[:\-]?\s*([0-9.,]+)\s*(?:m²|qm|m2)/i,
      /([0-9.,]+)\s*(?:m²|qm|m2)\s*(?:Wohnfl[aä]che|Nutzfl[aä]che|groß)/i,
      /([0-9.,]+)\s*m\s*2\s*,\s*Floor/i,
    ]);
  const area = parseArea(areaRaw);

  // --- Rooms ---
  const roomsKey = keys.find((k) => k === 'zimmer' || k === 'räume' || k === 'zimmeranzahl');
  const roomsRaw = place.numberOfRooms?.value
    || place.numberOfRooms
    || place.numberOfBedrooms?.value
    || listing.numberOfRooms
    || (roomsKey ? kv[roomsKey] : null)
    || matchFact([
      /(?:Zimmer|R[aä]ume|Zimmeranzahl)\s*[:\-]?\s*([0-9.,]+)/i,
      /([0-9.,]+)\s*[- ]Zimmer(?:\s*Wohnung|\b)/i,
      /([0-9.,]+)\s*Rooms\b/i,
    ]);
  const rooms = parseRooms(roomsRaw);

  // --- Price (Prioritize Gross Rent / Gesamtbelastung / Nutzungsentgelt) ---
  function tryNumber(val) {
    if (val == null) return null;
    const n = toNumber(val);
    return n != null && !Number.isNaN(n) && n > 0 ? n : null;
  }

  const grossRentKey = keys.find((k) => (
    k === 'gesamtbelastung'
    || k === 'monatliche gesamtbelastung'
    || k === 'gesamtmiete'
    || k === 'bruttomiete'
    || k === 'miete brutto'
    || k === 'pauschalmiete'
    || k === 'nutzungsentgelt'
    || k === 'monatliches nutzungsentgelt'
    || k.includes('gesamtbelastung')
    || k.includes('gesamtmiete')
    || k.includes('bruttomiete')
    || k.includes('miete brutto')
    || k.includes('nutzungsentgelt')
  ));

  const candidatePrices = [
    grossRentKey ? tryNumber(kv[grossRentKey]) : null,
    keys.includes('monatliche gesamtbelastung') ? tryNumber(kv['monatliche gesamtbelastung']) : null,
    keys.includes('gesamtmiete') ? tryNumber(kv['gesamtmiete']) : null,
    keys.includes('bruttomiete') ? tryNumber(kv['bruttomiete']) : null,
    keys.includes('miete brutto') ? tryNumber(kv['miete brutto']) : null,
    keys.includes('miete') ? tryNumber(kv['miete']) : null,
    keys.includes('hauptmietzins') ? tryNumber(kv['hauptmietzins']) : null,
    tryNumber(offers.price),
    tryNumber(offers.priceSpecification?.price),
    tryNumber(matchFact([
      /(?:Gesamtmiete|Miete brutto|Bruttomiete|Pauschalmiete|Gesamtbelastung|Monatsmiete|Nutzungsentgelt)\s*(?:\(brutto\)|\(inkl\.[^)]+\))?\s*[:\-]?\s*(?:€\s*|EUR\s*)?([0-9.,]+)(?!\s*\.?\s*obergescho[sß])/i,
      /(?:€|EUR)\s*([0-9.,]+)\s*(?:Gesamtmiete|Miete brutto|Bruttomiete|monatlich|Nutzungsentgelt)/i,
      /(?:Monthly rent|Rent)\s*[:\-]?\s*(?:€\s*)?([0-9.,]+)\s*(?:\/\s*month|per month)/i,
    ])),
  ];
  const price = candidatePrices.find((p) => p != null) ?? null;
  if (price != null && price > 30000) {
    return { inactive: true, forSale: true };
  }

  // --- Address ---
  const addressObj = place.address || listing.address || offers.itemOffered?.address || null;
  let address = null;
  if (typeof addressObj === 'string') {
    address = addressObj;
  } else if (typeof addressObj === 'object' && addressObj) {
    const street = addressObj.streetAddress || '';
    const postal = addressObj.postalCode || '';
    const locality = addressObj.addressLocality || '';
    const region = addressObj.addressRegion || '';
    const cityPart = [postal, locality].filter(Boolean).join(' ');
    address = [street, cityPart].filter(Boolean).join(', ')
      || [postal, locality, region].filter(Boolean).join(' ');
  }

  if (!address) {
    const addrKey = keys.find((k) => k === 'adresse' || k === 'lage' || k === 'standort' || k === 'anschrift' || k === 'ort');
    if (addrKey && kv[addrKey]) {
      address = kv[addrKey];
    }
  }

  if (!address) {
    const htmlAddr = /class="[^"]*(?:address|location|standort|objekt-address)[^"]*"[^>]*>([\s\S]*?)<\//i.exec(cleanHtml);
    if (htmlAddr && htmlAddr[1]) {
      const cleaned = decodeEntities(htmlAddr[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
      if (cleaned.length > 3 && !/^(adresse|lage|standort)$/i.test(cleaned)) address = cleaned;
    }
  }

  if (!address) {
    const pcMatch = /(?:([A-Za-zäöüÄÖÜß\s\-]+?)\s+\(([1-9]\d{3})\)|\b([1-9]\d{3})\s+([A-Za-zäöüÄÖÜß\s\-]+?))(?:,|<|\n|\s{2,}|$)/.exec(plainText);
    if (pcMatch) {
      if (pcMatch[1] && pcMatch[2]) {
        address = `${pcMatch[2]} ${pcMatch[1].trim()}`;
      } else if (pcMatch[3] && pcMatch[4]) {
        address = `${pcMatch[3]} ${pcMatch[4].trim()}`;
      }
    }
  }

  // --- Coordinates ---
  const lat = toNumber(place.latitude ?? place.geo?.latitude ?? listing.latitude ?? listing.geo?.latitude);
  const lng = toNumber(place.longitude ?? place.geo?.longitude ?? listing.longitude ?? listing.geo?.longitude);

  // --- Deposit / Equity Contribution (Finanzierungsbeitrag) ---
  const depositKey = keys.find((k) => (
    k === 'kaution' || k.includes('finanzierungsbeitrag') || k.includes('eigenmittel') || k.includes('baukostenzuschuss')
  ));
  const depositRaw = (depositKey ? kv[depositKey] : null)
    || matchFact([
      /(?:Kaution|Finanzierungsbeitrag|Eigenmittel|Baukostenzuschuss)\s*[:\-]?\s*(?:€\s*|EUR\s*)?([0-9.,]+)/i,
      /(?:€\s*|EUR\s*)([0-9.,]+)\s*(?:Kaution|Finanzierungsbeitrag|Eigenmittel|Baukostenzuschuss)/i,
      /Security deposit[^\d]*€([0-9.,]+)/i,
    ]);
  const deposit = toNumber(depositRaw);

  // --- Agency Name ---
  const agencyRaw = agent.name
    || agent.legalName
    || matchFact([
      /(?:Ihr(?:e)?\s+)?Ansprechpartner(?:in)?\s*[:\-]?\s*([A-Za-zäöüÄÖÜß\-]+(?:\s+[A-Za-zäöüÄÖÜß\-]+){1,3}?)(?=\s+(?:Tel|Mobil|E-Mail|Mail|Telefon|\+43|\d)|$|\s{2,}|[,<.\n])/i,
      /(?:Ihr(?:e)?\s+)?Ansprechpartner(?:in)?\s*[:\-]?\s*([A-Za-zäöüÄÖÜß\-]+(?:\s+[A-Za-zäöüÄÖÜß\-]+){1,3})/i,
      /(?:Makler(?:in)?|Anbieter|Immobilienkanzlei|Bautr[aä]ger)\s*[:\-]?\s*([A-Za-z0-9äöüÄÖÜß .,&]+?)(?:\s{2,}|[,<.\n]|$)/i,
    ]);
  let agency = agencyRaw ? agencyRaw.replace(/\s+/g, ' ').replace(/\s+(?:Tel|Mobil|E-Mail|Mail|Telefon)$/i, '').slice(0, 70).trim() : null;
  if (agency && /^(erklärt|anfrage|kontakt|impressum)$/i.test(agency)) agency = null;

  // --- Phone ---
  const phoneRaw = agent.telephone
    || agent.contactPoint?.[0]?.telephone
    || matchFact([
      /(?:Tel(?:efon)?\.?|Mobil(?:telefon)?|Hotline)\s*[:\-]?\s*(\+?[0-9 /()\-]{8,})/i,
      /(\+43[0-9 /()\-]{7,})/,
    ]);
  const agencyPhone = phoneRaw ? phoneRaw.replace(/\s+/g, ' ').trim() : null;

  // --- Email ---
  const emailRaw = agent.email
    || agent.contactPoint?.[0]?.email
    || matchFact([
      /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/,
    ]);
  const agencyEmail = emailRaw ? emailRaw.trim().toLowerCase() : null;

  // --- Images ---
  const ldImages = [].concat(listing.image || [], listing.photo || [])
    .map((i) => (typeof i === 'string' ? i : i?.url || i?.contentUrl))
    .filter(Boolean);

  const strippedHtml = html
    .replace(/<div[^>]*class="[^"]*(?:rounded-full|avatar|author|profile|ansprechpartner)[^"]*"[\s\S]*?<\/div>/gi, '')
    .replace(/<(?:div|section|aside)[^>]*class="[^"]*(?:ansprechpartner|kontakt-karte|agent-card|realtor)[^"]*"[\s\S]*?<\/(?:div|section|aside)>/gi, '');

  const htmlImages = [...strippedHtml.matchAll(/(?:href|src|data-src)="([^"]+?\.(?:jpg|jpeg|png|webp|avif)(?:\?[^"]*)?)"/gi)]
    .map((m) => m[1]);

  const images = dedupeImageUrls([...ldImages, ...htmlImages], url).slice(0, 25);

  // --- Description ---
  const description = listing.description || null;

  return {
    inactive: false,
    forSale: false,
    address,
    area,
    rooms,
    price,
    deposit,
    lat: lat != null && !Number.isNaN(lat) ? lat : null,
    lng: lng != null && !Number.isNaN(lng) ? lng : null,
    agency,
    agencyPhone,
    agencyEmail,
    images,
    description,
  };
}
