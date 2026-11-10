import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildStatus, buildView, emptyView, isRunning, needsRescrape, runScrape, SOURCES } from './scrape.js';
import { DEFAULT_PREFS, hasSavedSearch, loadPrefs, PROPERTY_TYPES, rememberGuestSearch, sanitizePrefs, savePrefs, scrapeScope } from './prefs.js';
import { closeDb, countFavorites, getFavorites, getListing, getLocale, getMeta, setLocale, updateFavorites, updateListingData } from './db.js';
import { DISTRICTS, STATES } from './geo.js';
import { CATEGORIES } from './categories.js';
import { authHandler, currentUser, loginOptions, migrateAuth } from './auth.js';

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST || undefined;
const REFRESH_MINUTES = Number(process.env.REFRESH_MINUTES ?? 30);
const REFRESH_COOLDOWN_MS = 2 * 60 * 1000;
const GUEST_COOKIE = 'rr_search';
const SECURE_COOKIES = (process.env.BETTER_AUTH_URL ?? '').startsWith('https://');
const LOCALES = ['de', 'en'];
const LISTING_ID = /^([a-z0-9_-]+):\S{1,200}$/;
const MAX_FAVORITES = 2000;
const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(res, status, data, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(data));
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return null;
}

function guestCookie(prefs) {
  const flags = `Path=/; HttpOnly; SameSite=Lax${SECURE_COOKIES ? '; Secure' : ''}`;
  if (!prefs) return `${GUEST_COOKIE}=; Max-Age=0; ${flags}`;
  return `${GUEST_COOKIE}=${Buffer.from(JSON.stringify(prefs)).toString('base64url')}; Max-Age=${365 * 24 * 60 * 60}; ${flags}`;
}

function guestPrefs(req) {
  const raw = readCookie(req, GUEST_COOKIE);
  if (!raw) return null;
  try {
    return sanitizePrefs(JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')));
  } catch {
    return null;
  }
}

function viewer(req, user) {
  if (user) return { prefs: loadPrefs(user.id), searched: hasSavedSearch(user.id) };
  const prefs = guestPrefs(req);
  return prefs ? { prefs, searched: true } : { prefs: { ...DEFAULT_PREFS }, searched: false };
}

function requireUser(user) {
  if (!user) throw new HttpError(401, 'unauthorized');
}

function listingIds(value) {
  if (!Array.isArray(value) || value.length > 500 || !value.every((id) => typeof id === 'string' && LISTING_ID.test(id))) {
    throw new HttpError(400, 'invalid listing ids');
  }
  return value;
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) throw new HttpError(413, 'body too large');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

function triggerScrape() {
  const scope = scrapeScope();
  if (!scope || isRunning()) return;
  runScrape(scope).catch((err) => console.error('[scrape] fatal', err));
}

function refreshAllowed() {
  const lastRun = getMeta('last_run');
  return !lastRun || Date.now() - Date.parse(lastRun) >= REFRESH_COOLDOWN_MS;
}

async function serveStatic(req, res) {
  const path = new URL(req.url, 'http://localhost').pathname;
  const file = normalize(join(PUBLIC_DIR, path === '/' ? 'index.html' : path));
  if (!file.startsWith(PUBLIC_DIR)) return sendJson(res, 403, { error: 'forbidden' });
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    sendJson(res, 404, { error: 'not found' });
  }
}

const routes = {
  'GET /api/listings': async (req, ctx) => {
    const { prefs, searched } = viewer(req, ctx.user);
    if (!searched) return emptyView();
    if (!ctx.user) rememberGuestSearch(prefs);
    return buildView(prefs);
  },
  'GET /api/status': async () => buildStatus(),
  'GET /api/config': async (req, ctx) => {
    const { user } = ctx;
    const guest = guestPrefs(req);
    if (user && guest) {
      if (!hasSavedSearch(user.id)) savePrefs(user.id, guest);
      ctx.headers['Set-Cookie'] = guestCookie(null);
    }
    return {
      user: user && { id: user.id, email: user.email, name: user.name },
      ...viewer(req, user),
      locale: user ? getLocale(user.id) : null,
      favorites: user ? getFavorites(user.id) : [],
      login: loginOptions,
      states: STATES.map(({ id, name }) => ({ id, name })),
      districts: DISTRICTS,
      types: PROPERTY_TYPES,
      categories: CATEGORIES,
      sources: Object.entries(SOURCES).map(([id, s]) => ({ id, label: s.label })),
    };
  },
  'PUT /api/prefs': async (req, ctx) => {
    const prefs = sanitizePrefs(await readBody(req));
    if (ctx.user) savePrefs(ctx.user.id, prefs);
    else {
      rememberGuestSearch(prefs);
      ctx.headers['Set-Cookie'] = guestCookie(prefs);
    }
    if (needsRescrape(prefs)) triggerScrape();
    return { prefs, running: isRunning() };
  },
  'POST /api/refresh': async (req, ctx) => {
    if (viewer(req, ctx.user).searched && refreshAllowed()) triggerScrape();
    return { running: isRunning() };
  },
  'PUT /api/settings': async (req, ctx) => {
    requireUser(ctx.user);
    const { locale } = await readBody(req);
    if (!LOCALES.includes(locale)) throw new HttpError(400, 'invalid locale');
    setLocale(ctx.user.id, locale);
    return { locale };
  },
  'POST /api/listings/detail': async (req) => {
    const { id } = await readBody(req);
    if (!id || typeof id !== 'string' || !LISTING_ID.test(id)) throw new HttpError(400, 'invalid listing id');
    const listing = getListing(id);
    if (!listing) throw new HttpError(404, 'listing not found');
    const source = SOURCES[listing.source];
    if (!source?.fetchDetails) return { description: listing.description };
    const details = await source.fetchDetails(listing.url);
    if (details) {
      const patch = { detailsAt: new Date().toISOString() };
      if (details.description) patch.description = details.description;
      if (details.sourceUrl) {
        patch.sourceUrl = details.sourceUrl;
        patch.sourceHost = details.sourceHost;
      }
      if (details.price != null) patch.price = details.price;
      if (details.area != null) patch.area = details.area;
      if (details.rooms != null) patch.rooms = details.rooms;
      if (details.deposit != null) patch.deposit = details.deposit;
      if (details.agency) patch.agency = details.agency;
      if (details.agencyPhone) patch.agencyPhone = details.agencyPhone;
      if (details.agencyEmail) patch.agencyEmail = details.agencyEmail;
      if (details.images?.length) patch.images = details.images;
      if (details.directVerified) patch.directVerified = true;
      updateListingData(id, patch);
      return { description: details.description ?? listing.description };
    }
    return { description: listing.description };
  },
  'POST /api/favorites': async (req, ctx) => {
    requireUser(ctx.user);
    const body = await readBody(req);
    const add = listingIds(body.add ?? []);
    const remove = listingIds(body.remove ?? []);
    if (countFavorites(ctx.user.id) + add.length > MAX_FAVORITES) throw new HttpError(400, 'too many favorites');
    updateFavorites(ctx.user.id, { add, remove });
    return { favorites: getFavorites(ctx.user.id) };
  },
};

const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path.startsWith('/api/auth/')) return authHandler(req, res);
  if (path === '/api/health') return sendJson(res, 200, { ok: true });
  const route = routes[`${req.method} ${path}`];
  if (!route) return path.startsWith('/api/') ? sendJson(res, 404, { error: 'not found' }) : serveStatic(req, res);
  const ctx = { user: null, headers: {} };
  try {
    ctx.user = await currentUser(req);
    const data = await route(req, ctx);
    sendJson(res, 200, data, ctx.headers);
  } catch (err) {
    if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message });
    if (err instanceof SyntaxError) return sendJson(res, 400, { error: 'invalid json' });
    console.error(err);
    sendJson(res, 500, { error: err.message });
  }
});

function autoRefresh() {
  if (!REFRESH_MINUTES) return;
  const lastRun = getMeta('last_run');
  const age = lastRun ? Date.now() - Date.parse(lastRun) : Infinity;
  if (age >= REFRESH_MINUTES * 60 * 1000) triggerScrape();
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close();
    closeDb();
    process.exit(0);
  });
}

await migrateAuth();

server.listen(PORT, HOST, () => {
  console.log(`RentRadar running at http://${HOST ?? 'localhost'}:${PORT}`);
  autoRefresh();
  setInterval(() => {
    try { autoRefresh(); } catch (err) { console.error(err); }
  }, 60 * 1000);
});
