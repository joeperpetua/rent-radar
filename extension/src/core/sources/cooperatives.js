import { decodeEntities, fetchText } from '../http.js';
import { cityFromAddress, districtFromPostcode, findPostcode, stateFromPostcode, toNumber } from '../geo.js';
import { PARSER_VERSION, parseDirectListing } from './directParser.js';
import { applyPrefs, fetchPages, locate, maxNumber, outOfScope, pMap, reusable } from './crawl.js';

export const SITES = [
  {
    id: 'bwsg',
    name: 'BWSG',
    pageUrl: (n) => `https://www.bwsg.at/immobilien/immobilie-suchen/?_vermarktungsart=miete&_objektart=wohnung${n > 1 ? `&_paged=${n}` : ''}`,
    lastPage: (html) => maxNumber(html, /data-page=\\?"(\d+)/g),
    linkPattern: /href="([^"]*\/objekt\/[^"]*)"/gi,
    resolveUrl: (href) => href,
    cardSplit: /data-objektnummer=/,
    card: (chunk) => ({
      postcode: /meta__location">(?:\s|<[^>]*>)*(\d{4})\b/.exec(chunk)?.[1] ?? null,
      price: toNumber(/meta__preis">\s*([\d.,]+)/.exec(chunk)?.[1]),
      residential: true,
    }),
  },
  {
    id: 'oevw',
    name: 'ÖVW',
    pageUrl: (n) => `https://www.oevw.at/suche?page=${n}`,
    lastPage: (html) => maxNumber(html, /[?&]page=(\d+)/g),
    linkPattern: /href="([^"]*\/suche\/\d+[^"]*)"/gi,
    resolveUrl: (href) => (href.startsWith('http') ? href : `https://www.oevw.at${href}`),
    cardSplit: /class="thumblist__item"/,
    card: (chunk) => {
      const info = /thumb__info[^>]*>([^<]+)/.exec(chunk)?.[1] ?? '';
      return {
        postcode: /\b(\d{4})\b/.exec(info)?.[1] ?? null,
        price: toNumber(/thumb__subheading__item">\s*€\s*([\d.,]+)/.exec(chunk)?.[1]),
        residential: !info || (/wohnung|haus|maisonette|penthouse|reihenhaus/i.test(info) && !/kauf|eigentum/i.test(info)),
      };
    },
  },
  {
    id: 'nebau',
    name: 'NEBAU',
    pageUrl: () => 'https://www.nebau.at/wohnen-immobilien/immobiliensuche/',
    linkPattern: /href="([^"]*\/wohnen-immobilien\/immobiliensuche\/immobilie\/[^"]*)"/gi,
    resolveUrl: (href) => (href.startsWith('http') ? href : `https://www.nebau.at${href}`),
    projects: true,
  },
];

const cellText = (html) => decodeEntities((html ?? '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const HOUSE_PROJECT = /reihenh[äa]us|doppelh[äa]us|einfamilienh[äa]us|\bh[äa]user\b/i;

export function parseNebauProject(html, projectUrl) {
  const origin = new URL(projectUrl).origin;
  const name = cellText(/<div class="project-detail">[\s\S]*?<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1]) || null;
  const location = cellText(/class="project-location">([\s\S]*?)<\/div>/.exec(html)?.[1]).replace(/^Standort\s*/, '');
  const postcode = findPostcode(location);
  const lat = toNumber(/class="project-map"[^>]*data-latitude="([^"]+)"/.exec(html)?.[1]);
  const lng = toNumber(/class="project-map"[^>]*data-longitude="([^"]+)"/.exec(html)?.[1]);
  const description = cellText(/class="project-description">([\s\S]*?)<\/div>/.exec(html)?.[1]) || null;
  const gallery = /class="project-gallery">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/.exec(html)?.[1] ?? html;
  const images = [...new Set([...gallery.matchAll(/<a href="([^"]+\.(?:jpe?g|png|webp))"[^>]*class="lightbox"/gi)].map((m) => new URL(m[1], origin).href))];
  const type = HOUSE_PROJECT.test(name ?? '') ? 'house' : 'apartment';
  const units = /class="project-units[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/.exec(html)?.[1] ?? '';
  return [...units.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].flatMap(([, row]) => {
    const href = /class="unit-link" href="([^"]+)"/.exec(row)?.[1];
    const rent = toNumber(/class="rent">\s*<span>\s*([\d.,]+)/.exec(row)?.[1]);
    if (!href || !rent) return [];
    const url = new URL(href, origin).href;
    const spans = [...(/class="apartment-number">([\s\S]*?)<\/th>/.exec(row)?.[1] ?? '').matchAll(/<span[^>]*>([\s\S]*?)<\/span>/g)].map((m) => cellText(m[1]));
    const unitAddress = spans.at(-1) ?? '';
    const [town, street] = unitAddress.split(/,\s*/);
    const slug = url.replace(/\/$/, '').split('/').pop();
    const where = locate({ postcode, city: town, street });
    return [{
      id: `nebau:${slug}`,
      source: 'nebau',
      sourceId: slug,
      parserVersion: PARSER_VERSION,
      type,
      forSale: false,
      url,
      title: [name, unitAddress].filter(Boolean).join(' – '),
      price: rent,
      area: toNumber(cellText(/class="living-space">([\s\S]*?)<\/td>/.exec(row)?.[1]).replace(/m².*$/, '')),
      rooms: toNumber(cellText(/class="rooms">([\s\S]*?)<\/td>/.exec(row)?.[1])) || null,
      deposit: toNumber(/class="price">\s*<span>\s*([\d.,]+)/.exec(row)?.[1]),
      ...where,
      address: [street, [postcode, town].filter(Boolean).join(' ')].filter(Boolean).join(', ') || where.address,
      lat,
      lng,
      images,
      description,
      sourceUrl: url,
      sourceHost: 'nebau.at',
      publishedAt: null,
      isPrivate: false,
      agency: 'NEBAU',
      floor: null,
      extras: ['Genossenschaftswohnung'],
    }];
  });
}

async function searchProjects(site, prefs, { onProgress = () => {} } = {}) {
  const projects = (await fetchSiteCards(site)).map((card) => card.url);
  let count = 0;
  const listings = (await pMap(projects, 4, async (url) => {
    try {
      const units = parseNebauProject(await fetchText(url, { retries: 1, timeout: 10000 }), url);
      count += units.length;
      onProgress(count);
      return units;
    } catch {
      return null;
    }
  })).flat();
  return applyPrefs(listings, prefs);
}

const links = (site, html) => [...html.matchAll(site.linkPattern)].map((m) => site.resolveUrl(m[1].replace(/&amp;/g, '&')));

export function parseSiteCards(site, html) {
  const chunks = site.cardSplit ? html.split(site.cardSplit).slice(1) : [];
  const cards = chunks.flatMap((chunk) => {
    const url = links(site, chunk)[0];
    return url ? [{ url, ...site.card(chunk) }] : [];
  });
  return cards.length ? cards : links(site, html).map((url) => ({ url, postcode: null, price: null, residential: true }));
}

export async function fetchSiteCards(site) {
  const pages = await fetchPages(site, site.id);
  const seen = new Set();
  return pages.flatMap((html) => parseSiteCards(site, html)).filter((c) => !seen.has(c.url) && seen.add(c.url));
}

async function searchSite(site, prefs, { onProgress = () => {}, stored } = {}) {
  const urls = (await fetchSiteCards(site))
    .filter((card) => card.residential && !outOfScope(card, prefs))
    .map((card) => card.url);

  let count = 0;
  const listings = await pMap(urls, 6, async (url) => {
    try {
      const u = new URL(url);
      const host = u.hostname.replace(/^www\./i, '');
      const slug = u.pathname.replace(/\/$/, '').split('/').pop();
      const listingId = `${site.id}:${slug}`;

      const known = stored?.get(listingId);
      if (reusable(known)) {
        if (known.forSale || known.price == null || known.price <= 0) return null;
        onProgress(++count);
        return known;
      }

      const pageHtml = await fetchText(url, { retries: 1, timeout: 10000 });
      const parsed = parseDirectListing(pageHtml, url);
      if (parsed.inactive || parsed.forSale || parsed.price == null || parsed.price <= 0) return null;

      const title = decodeEntities(pageHtml.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || `${site.name} Wohnung`)
        .replace(/\s*[-|–]\s*(?:BWSG|ÖVW|NEBAU)\b.*$/i, '')
        .replace(/\s+/g, ' ')
        .trim();

      const postcode = findPostcode(parsed.address) || findPostcode(parsed.description) || findPostcode(title);
      const state = stateFromPostcode(postcode);
      const district = state === 'wien' ? districtFromPostcode(postcode) : null;
      const city = cityFromAddress(parsed.address) || (state === 'wien' ? 'Wien' : null);
      const address = parsed.address || [postcode, city].filter(Boolean).join(' ') || null;

      onProgress(++count);

      return {
        id: listingId,
        source: site.id,
        sourceId: slug,
        parserVersion: PARSER_VERSION,
        type: 'apartment',
        forSale: false,
        url,
        title,
        price: parsed.price,
        area: parsed.area,
        rooms: parsed.rooms,
        deposit: parsed.deposit,
        postcode,
        state,
        city,
        district,
        address,
        lat: parsed.lat ?? null,
        lng: parsed.lng ?? null,
        images: parsed.images || [],
        description: parsed.description,
        sourceUrl: url,
        sourceHost: host,
        publishedAt: null,
        isPrivate: false,
        agency: site.name,
        floor: null,
        extras: ['Genossenschaftswohnung'],
      };
    } catch {
      return null;
    }
  });

  return applyPrefs(listings, prefs);
}

export const sources = SITES.map((site) => ({
  id: site.id,
  label: site.name,
  kind: 'cooperative',
  search: (prefs, options) => (site.projects ? searchProjects(site, prefs, options) : searchSite(site, prefs, options)),
}));
