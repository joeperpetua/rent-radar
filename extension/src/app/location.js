const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const CACHE_KEY = 'immo-tool:nearby:v1';
const CACHE_TTL_MS = 30 * 86400000;
const CACHE_MAX = 200;
const RADIUS_M = 1000;
const WALK_M_PER_MIN = 80;
const OVERPASS_TIMEOUT_MS = 15000;
const PROMPT_TIMEOUT_MS = 60000;
const DESCRIPTION_CHARS = 1500;
const INPUT_LANGS = ['en', 'de'];

export const TRANSIT_MODES = ['subway', 'train', 'tram', 'bus'];
const AMENITIES = ['supermarket', 'shop', 'pharmacy', 'doctor', 'school', 'kindergarten', 'park', 'playground'];
const AMENITY_LABELS = {
  supermarket: 'Supermarkets', shop: 'Bakeries/drugstores', pharmacy: 'Pharmacies', doctor: 'Doctors/clinics',
  school: 'Schools', kindergarten: 'Kindergartens', park: 'Parks', playground: 'Playgrounds',
};
const MODE_LABELS = { subway: 'U-Bahn (metro)', train: 'S-Bahn/regional train', tram: 'Tram', bus: 'Bus' };
const MAP_NOTES = {
  none: 'No coordinates are known, so there is no map data. Use only the address and the description.',
  failed: 'Map data could not be loaded. Use only the address and the description.',
};

const SCORE = { type: 'integer', minimum: 1, maximum: 10 };
const SCHEMA = {
  type: 'object',
  properties: { overall: SCORE, transit: SCORE, everyday: SCORE, green: SCORE, summary: { type: 'string' } },
  required: ['overall', 'transit', 'everyday', 'green', 'summary'],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You rate the location of rental flats in Austria for a tenant without a car.
Scores are integers from 1 (very poor) to 10 (excellent):
- transit: access to public transport. U-Bahn or S-Bahn within 500 m walking is excellent; only buses or nothing within 1 km is poor.
- everyday: supermarkets, pharmacies, doctors, schools within walking distance.
- green: parks and playgrounds nearby.
- overall: the combined liveability of the location, weighted mostly by transit and everyday.
Base the scores strictly on the facts given. When facts are missing, score cautiously and say so.
The summary is 2-3 short sentences naming the concrete stops or places that matter most.`;

const facts = new Map();
const ratings = new Map();
const sessions = new Map();

const withTimeout = (promise, ms) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
]);

export const ratingSupported = () => 'LanguageModel' in self;

const modelOptions = (outputLang) => ({
  expectedInputs: [{ type: 'text', languages: INPUT_LANGS }],
  expectedOutputs: [{ type: 'text', languages: [outputLang] }],
});

export async function ratingAvailability(lang) {
  for (const outputLang of [...new Set([lang, 'en'])]) {
    try {
      const availability = await withTimeout(LanguageModel.availability(modelOptions(outputLang)), 8000);
      if (availability !== 'unavailable') return { availability, outputLang };
    } catch {}
  }
  return { availability: 'unavailable', outputLang: null };
}

function baseSession(outputLang, onProgress) {
  if (!sessions.has(outputLang)) {
    const created = LanguageModel.create({
      ...modelOptions(outputLang),
      initialPrompts: [{ role: 'system', content: SYSTEM_PROMPT }],
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => onProgress?.(e.loaded));
      },
    });
    sessions.set(outputLang, created.catch((err) => {
      sessions.delete(outputLang);
      throw err;
    }));
  }
  return sessions.get(outputLang);
}

function distance(lat1, lng1, lat2, lng2) {
  const rad = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2
    + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lng2 - lng1) * rad) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(a));
}

function classify(tags) {
  if (tags.railway === 'station' || tags.railway === 'halt' || tags.public_transport === 'station') {
    if (tags.station === 'subway' || tags.subway === 'yes') return 'subway';
    if (tags.railway) return 'train';
  }
  if (tags.railway === 'tram_stop') return 'tram';
  if (tags.highway === 'bus_stop') return 'bus';
  if (tags.shop === 'supermarket' || tags.shop === 'convenience') return 'supermarket';
  if (tags.shop === 'bakery' || tags.shop === 'chemist') return 'shop';
  if (tags.amenity === 'pharmacy') return 'pharmacy';
  if (tags.amenity === 'doctors' || tags.amenity === 'clinic') return 'doctor';
  if (tags.amenity === 'school') return 'school';
  if (tags.amenity === 'kindergarten') return 'kindergarten';
  if (tags.leisure === 'park') return 'park';
  if (tags.leisure === 'playground') return 'playground';
  return null;
}

function overpassQuery(lat, lng) {
  const around = `(around:${RADIUS_M},${lat},${lng})`;
  return `[out:json][timeout:20];
(
  nwr${around}[railway~"^(station|halt|tram_stop)$"];
  node${around}[highway=bus_stop];
  nwr${around}[shop~"^(supermarket|convenience|bakery|chemist)$"];
  nwr${around}[amenity~"^(pharmacy|doctors|clinic|school|kindergarten)$"];
  nwr${around}[leisure~"^(park|playground)$"];
);
out center tags;`;
}

async function fetchOverpass(query) {
  for (const url of OVERPASS_URLS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(OVERPASS_TIMEOUT_MS),
      });
      if (res.ok) return (await res.json()).elements;
    } catch {}
  }
  throw new Error('overpass unavailable');
}

const cacheKey = (g) => `${g.lat.toFixed(4)},${g.lng.toFixed(4)}`;

function readCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function writeCache(key, value) {
  try {
    const now = Date.now();
    const fresh = Object.entries(readCache()).filter(([, v]) => now - v.at < CACHE_TTL_MS).slice(-(CACHE_MAX - 1));
    localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries([...fresh, [key, { at: now, value }]])));
  } catch {}
}

async function loadFacts(g) {
  const key = cacheKey(g);
  const cached = readCache()[key];
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;
  const elements = await fetchOverpass(overpassQuery(g.lat, g.lng));
  const byKind = Object.fromEntries([...TRANSIT_MODES, ...AMENITIES].map((k) => [k, new Map()]));
  for (const el of elements) {
    const kind = classify(el.tags ?? {});
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (!kind || lat == null) continue;
    const name = el.tags.name ?? null;
    const m = Math.round(distance(g.lat, g.lng, lat, lng));
    const id = name ?? `#${el.type}${el.id}`;
    const prev = byKind[kind].get(id);
    if (!prev || m < prev.m) byKind[kind].set(id, { name, m });
  }
  const result = Object.fromEntries(Object.entries(byKind).map(([kind, places]) => [kind, [...places.values()].sort((a, b) => a.m - b.m)]));
  writeCache(key, result);
  return result;
}

export function nearbyFacts(g) {
  if (g.lat == null || g.lng == null) return Promise.resolve(null);
  if (!facts.has(g.id)) {
    facts.set(g.id, loadFacts(g).catch((err) => {
      facts.delete(g.id);
      throw err;
    }));
  }
  return facts.get(g.id);
}

export const walkMinutes = (m) => Math.max(1, Math.round(m / WALK_M_PER_MIN));

function factsText(nearby) {
  const describe = (places) => {
    if (!places.length) return `none within ${RADIUS_M} m`;
    const named = places.filter((p) => p.name).slice(0, 3).map((p) => `"${p.name}" ${p.m} m`);
    return `${places.length} within ${RADIUS_M} m; nearest ${places[0].m} m${named.length ? ` (${named.join(', ')})` : ''}`;
  };
  return [
    ...TRANSIT_MODES.map((k) => `- ${MODE_LABELS[k]} stops: ${describe(nearby[k])}`),
    ...AMENITIES.map((k) => `- ${AMENITY_LABELS[k]}: ${describe(nearby[k])}`),
  ].join('\n');
}

function promptText(g, nearby, mapData, outputLang) {
  const postcodeCity = [g.postcode, g.city].filter(Boolean).join(' ');
  const place = postcodeCity && g.address?.includes(postcodeCity) ? g.address : [g.address, postcodeCity].filter(Boolean).join(', ');
  const language = new Intl.DisplayNames(['en'], { type: 'language' }).of(outputLang);
  const mapFacts = nearby ? `Straight-line distances from the flat, from OpenStreetMap:\n${factsText(nearby)}` : MAP_NOTES[mapData];
  return `Listing: ${g.title}
Address: ${place || 'unknown'}
${mapFacts}
Description excerpt (may mention transport or surroundings):
${(g.description ?? '').slice(0, DESCRIPTION_CHARS) || 'none'}

Rate the location. Write the summary in ${language}.`;
}

export async function rateLocation(g, outputLang, onProgress) {
  const key = `${g.id}|${outputLang}`;
  if (ratings.has(key)) return ratings.get(key);
  const sessionReady = baseSession(outputLang, onProgress);
  const nearby = await nearbyFacts(g).catch(() => undefined);
  const mapData = nearby ? 'osm' : nearby === null ? 'none' : 'failed';
  const session = await (await sessionReady).clone();
  try {
    const raw = await withTimeout(session.prompt(promptText(g, nearby, mapData, outputLang), { responseConstraint: SCHEMA }), PROMPT_TIMEOUT_MS);
    const result = { ...JSON.parse(raw), nearby, mapData };
    if (mapData !== 'failed') ratings.set(key, result);
    return result;
  } finally {
    session.destroy();
  }
}
