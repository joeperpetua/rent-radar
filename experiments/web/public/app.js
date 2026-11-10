import { applyStatic, feature, getLang, locale, setLang, t } from './i18n.js';
import { detectLanguage, translateText, translationAvailability, translationSupported } from './translate.js';
import { TRANSIT_MODES, rateLocation, ratingAvailability, ratingSupported, walkMinutes } from './location.js';

const SOURCE_LABELS = { willhaben: 'willhaben', immoscout: 'ImmoScout24', cooperatives: 'Genossenschaften', justimmo: 'JustImmo', wunderflats: 'Wunderflats', fify: 'Fify' };
const STORAGE_KEY = 'immo-tool:v1';
const RANGE_FIELDS = ['minPrice', 'maxPrice', 'minArea', 'maxArea', 'minRooms', 'maxRooms'];
const TOAST_LINGER_MS = 5000;
const ERROR_TOAST_LINGER_MS = 20000;

const state = {
  config: null,
  data: null,
  status: null,
  view: loadLocal(),
  favorites: new Set(),
  pollTimer: null,
  toasts: { runId: null, dismissed: new Set(), timers: [] },
};

const $ = (sel, root = document) => root.querySelector(sel);

function loadLocal() {
  const defaults = { fav: [], sort: 'new', onlyNew: false, onlyMulti: false, onlyDropped: false, onlyFav: false, q: '', lang: null };
  try {
    const { hidden, showHidden, ...stored } = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    return { ...defaults, ...stored };
  } catch {
    return defaults;
  }
}

function saveLocal() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.view));
  } catch {}
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const euro = (n, digits = 0) => (n == null ? '–' : new Intl.NumberFormat(locale(), { style: 'currency', currency: 'EUR', maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n));
const num = (n, digits = 0) => (n == null ? '–' : new Intl.NumberFormat(locale(), { maximumFractionDigits: digits }).format(n));
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' }) : '–');
const fmtDay = (iso) => (iso ? new Date(iso).toLocaleDateString(locale(), { day: 'numeric', month: 'short' }) : '–');
const isDrop = (g) => g.priceChange != null && g.priceChange.delta < 0;
const signedEuro = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${euro(Math.abs(n), Number.isInteger(n) ? 0 : 2)}`;

function priceHistoryHtml(g) {
  const withHistory = g.sources.filter((s) => s.priceHistory?.length > 1);
  if (!withHistory.length) return '';
  return `
    <div class="panel">
      <h2>${esc(t('priceHistory'))}</h2>
      ${withHistory.map((s) => `
        <div class="history">
          <strong class="history-source ${s.source}">${esc(SOURCE_LABELS[s.source])}</strong>
          <ol>
            ${s.priceHistory.map((h, i) => {
              const delta = i ? h.price - s.priceHistory[i - 1].price : 0;
              return `<li>
                <span class="h-date">${esc(fmtDay(h.at))}</span>
                <span class="h-price">${euro(h.price, 2)}</span>
                <span class="h-delta ${delta < 0 ? 'down' : delta > 0 ? 'up' : ''}">${i ? esc(signedEuro(Math.round(delta * 100) / 100)) : ''}</span>
              </li>`;
            }).join('')}
          </ol>
        </div>`).join('')}
    </div>`;
}

function relTime(iso) {
  if (!iso) return '–';
  const diff = (Date.now() - Date.parse(iso)) / 1000;
  const rtf = new Intl.RelativeTimeFormat(getLang(), { numeric: 'auto' });
  if (diff < 60) return t('justNow');
  if (diff < 3600) return rtf.format(-Math.round(diff / 60), 'minute');
  if (diff < 86400) return rtf.format(-Math.round(diff / 3600), 'hour');
  return rtf.format(-Math.round(diff / 86400), 'day');
}

function districtLabel(n) {
  const d = state.config?.districts.find((x) => x.number === n);
  return d ? `${n}. ${d.name}` : null;
}

const stateName = (id) => (id ? t(`state.${id}`) : null);

function placeLabel(g) {
  if (g.state === 'wien' && g.district) return districtLabel(g.district);
  return g.city ?? stateName(g.state);
}

const allTicked = (selector) => {
  const boxes = [...document.querySelectorAll(selector)];
  return boxes.every((i) => i.checked) || boxes.every((i) => !i.checked);
};

const BULK_TOGGLES = ['states', 'districts'];

function updateRegionControls() {
  const states = [...document.querySelectorAll('#states input:checked')].map((i) => i.value);
  $('#districts-field').hidden = !(allTicked('#states input') || states.includes('wien'));
  for (const id of BULK_TOGGLES) {
    const boxes = [...document.querySelectorAll(`#${id} input`)];
    $(`#${id}-all`).disabled = boxes.every((i) => i.checked);
    $(`#${id}-none`).disabled = boxes.every((i) => !i.checked);
  }
}

function tickAll(id, checked) {
  document.querySelectorAll(`#${id} input`).forEach((i) => { i.checked = checked; });
  updateRegionControls();
}

const memberIds = (g) => g.sources.map((s) => s.id);
const isFav = (g) => memberIds(g).some((id) => state.favorites.has(id));
const LISTING_ID = /^([a-z0-9_-]+):\S+$/;

async function toggleFav(g, rerender) {
  const ids = memberIds(g);
  if (!state.config.user) {
    state.view.fav = [...new Set([...state.view.fav, ...ids])];
    saveLocal();
    openAuth('favorites');
    return;
  }
  const add = !isFav(g);
  for (const id of ids) add ? state.favorites.add(id) : state.favorites.delete(id);
  rerender();
  try {
    const res = await api('/api/favorites', { method: 'POST', body: JSON.stringify(add ? { add: ids } : { remove: ids }) });
    state.favorites = new Set(res.favorites);
  } catch {
    for (const id of ids) add ? state.favorites.delete(id) : state.favorites.add(id);
  }
  rerender();
}

function applyLang(lang) {
  setLang(lang);
  state.view.lang = lang;
  saveLocal();
  if (!document.body.classList.contains('booting')) renderAll();
  renderAuth();
}

async function syncAccount() {
  const { user, locale } = state.config;
  if (!user) return;
  if (state.view.fav.length) {
    const pending = state.view.fav.filter((id) => LISTING_ID.test(id)).slice(0, 500);
    const res = pending.length
      ? await api('/api/favorites', { method: 'POST', body: JSON.stringify({ add: pending }) }).catch(() => null)
      : { favorites: [...state.favorites] };
    if (res) {
      state.favorites = new Set(res.favorites);
      state.view.fav = [];
      saveLocal();
    }
  }
  if (locale && locale !== getLang()) applyLang(locale);
  else if (!locale) api('/api/settings', { method: 'PUT', body: JSON.stringify({ locale: getLang() }) }).catch(() => {});
}

async function api(path, options = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  if (res.status === 401) {
    openAuth();
    throw new Error('unauthorized');
  }
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
  return res.json();
}

function renderAuth() {
  const login = state.config?.login ?? { google: false, signUp: true };
  if (!login.signUp) state.authMode = 'signIn';
  const signUp = state.authMode === 'signUp';
  $('#auth-title').textContent = t(signUp ? 'signUp' : 'signIn');
  $('#auth-lead').textContent = t(state.authReason ? `authReason.${state.authReason}` : 'authLead');
  $('#auth-submit').textContent = t(signUp ? 'signUp' : 'signIn');
  $('#auth-switch').textContent = t(signUp ? 'switchToSignIn' : 'switchToSignUp');
  $('#auth-switch').hidden = !login.signUp;
  $('#auth-social').hidden = !login.google;
  $('#auth-name-field').hidden = !signUp;
  $('#auth-form').elements.namedItem('password').autocomplete = signUp ? 'new-password' : 'current-password';
}

const authErrorText = (code, fallback = 'authError.generic') => {
  const key = `authError.${code}`;
  return t(key) === key ? t(fallback) : t(key);
};

function openAuth(reason = null, error = '') {
  closeLightbox();
  state.authReason = reason;
  document.body.classList.add('auth-open');
  $('#auth').hidden = false;
  $('#auth-error').textContent = error;
  renderAuth();
  window.scrollTo(0, 0);
}

function closeAuth() {
  document.body.classList.remove('auth-open');
  $('#auth').hidden = true;
}

async function authRequest(path, body) {
  const res = await fetch(`/api/auth/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message ?? res.statusText), { code: data.code ?? (res.status === 429 ? 'TOO_MANY_REQUESTS' : null) });
  return data;
}

function bindAuth() {
  const form = $('#auth-form');
  const field = (name) => form.elements.namedItem(name);
  $('#auth-switch').addEventListener('click', () => {
    state.authMode = state.authMode === 'signUp' ? 'signIn' : 'signUp';
    $('#auth-error').textContent = '';
    renderAuth();
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const button = $('#auth-submit');
    const email = field('email').value.trim();
    const password = field('password').value;
    button.disabled = true;
    $('#auth-error').textContent = '';
    try {
      if (state.authMode === 'signUp') await authRequest('sign-up/email', { email, password, name: field('name').value.trim() || email.split('@')[0] });
      else await authRequest('sign-in/email', { email, password });
      field('password').value = '';
      closeAuth();
      await startApp();
    } catch (err) {
      $('#auth-error').textContent = authErrorText(err.code);
    } finally {
      button.disabled = false;
    }
  });
  $('#auth-google').addEventListener('click', async () => {
    $('#auth-error').textContent = '';
    try {
      const { url } = await authRequest('sign-in/social', { provider: 'google', callbackURL: '/', errorCallbackURL: '/' });
      location.href = url;
    } catch (err) {
      $('#auth-error').textContent = authErrorText(err.code, 'authError.oauth');
    }
  });
  $('#auth-close').addEventListener('click', closeAuth);
  $('#sign-in').addEventListener('click', () => openAuth());
  $('#sign-out').addEventListener('click', async () => {
    await authRequest('sign-out', {}).catch(() => {});
    history.replaceState(null, '', '#/');
    await startApp();
  });
  $('#lang-switch').addEventListener('click', (e) => {
    const lang = e.target.closest('[data-lang]')?.dataset.lang;
    if (!lang || lang === getLang()) return;
    applyLang(lang);
    if (state.config?.user) api('/api/settings', { method: 'PUT', body: JSON.stringify({ locale: lang }) }).catch(() => {});
  });
}

function renderPrefs() {
  const { prefs, districts, sources, types, categories, states } = state.config;
  const form = $('#prefs');
  for (const key of RANGE_FIELDS) form[key].value = prefs[key] || '';

  $('#states').innerHTML = states.map((s) => `
    <label class="check">
      <input type="checkbox" name="state" value="${s.id}" ${!prefs.states.length || prefs.states.includes(s.id) ? 'checked' : ''}>
      <span>${esc(stateName(s.id))}</span>
    </label>`).join('');

  $('#types').innerHTML = types.map((type) => `
    <label>
      <input type="checkbox" name="type" value="${type}" ${prefs.types.includes(type) ? 'checked' : ''}>
      <span>${esc(t(`type.${type}`))}</span>
    </label>`).join('');

  $('#categories').innerHTML = categories.map((c) => `
    <label class="check">
      <input type="checkbox" name="category" value="${c}" ${prefs.categories.includes(c) ? 'checked' : ''}>
      <span class="cat-dot cat-${c}"></span><span>${esc(t(`cat.${c}`))}</span>
      <span class="count" data-cat-count="${c}"></span>
    </label>`).join('');
  renderCategoryCounts();

  $('#districts').innerHTML = districts.map((d) => `
    <label class="check" title="${esc(d.postcode)} ${esc(d.name)}">
      <input type="checkbox" name="district" value="${d.number}" ${!prefs.districts.length || prefs.districts.includes(d.number) ? 'checked' : ''}>
      <b>${d.number}</b><span>${esc(d.name)}</span>
    </label>`).join('');

  $('#sources').innerHTML = sources.map((s) => `
    <label class="check">
      <span class="dot ${s.id}"></span><span>${esc(s.label)}</span>
      <span class="count" data-count="${s.id}"></span>
      <input type="checkbox" class="switch" role="switch" name="source" value="${s.id}" ${prefs.sources.includes(s.id) ? 'checked' : ''}>
    </label>`).join('');

  updateRegionControls();
  renderSourceCounts();
}

function renderCategoryCounts() {
  for (const el of document.querySelectorAll('[data-cat-count]')) {
    el.textContent = state.data?.categoryCounts?.[el.dataset.catCount] ?? '';
  }
}

async function savePrefsPatch(patch) {
  if (!state.config.searched) {
    state.config.prefs = { ...state.config.prefs, ...patch };
    return;
  }
  const res = await api('/api/prefs', { method: 'PUT', body: JSON.stringify({ ...state.config.prefs, ...patch }) });
  state.config.prefs = res.prefs;
  await loadListings();
  if (res.running) await pollStatus();
}

function renderSourceCounts() {
  for (const el of document.querySelectorAll('[data-count]')) {
    const run = state.status?.runs?.[el.dataset.count];
    el.textContent = run ? (run.ok ? run.count : t('error')) : '';
  }
}

function renderStatus() {
  const s = state.status;
  if (!s) return;
  const btn = $('#refresh');
  btn.classList.toggle('is-running', s.running);
  btn.disabled = s.running || !state.config?.searched;
  $('.label', btn).textContent = s.running ? t('refreshing') : t('refresh');

  const parts = Object.entries(s.runs ?? {}).map(([id, r]) => r.ok
    ? `<span class="src-status" title="${esc(fmtDate(r.at))}"><span class="dot ${id}"></span>${esc(SOURCE_LABELS[id])} ${r.count}</span>`
    : `<span class="src-status err" title="${esc(r.error)}"><span class="dot ${id}"></span>${esc(SOURCE_LABELS[id])} ${esc(t('error'))}</span>`);
  if (s.lastRun) parts.push(`<span>${esc(t('updated', { time: relTime(s.lastRun) }))}</span>`);
  $('#status').innerHTML = parts.join('');
  renderSourceCounts();
}

function toastText(key, entry) {
  if (entry.state === 'running') return entry.count ? t('toast.loading', { n: entry.count }) : t('toast.loadingNone');
  if (entry.state === 'done') return t('toast.done', { n: entry.count, s: num((entry.ms ?? 0) / 1000, 1) });
  return t('toast.error', { msg: entry.error });
}

function renderToasts() {
  const progress = state.status?.progress;
  const box = $('#toasts');
  const ts = state.toasts;
  if (!progress) return;
  if (progress.startedAt !== ts.runId) {
    const stale = progress.finishedAt && Date.now() - Date.parse(progress.finishedAt) > TOAST_LINGER_MS;
    if (stale) return;
    ts.runId = progress.startedAt;
    ts.dismissed.clear();
    ts.timers.forEach(clearTimeout);
    ts.timers = [];
    box.innerHTML = '';
  }
  for (const [key, entry] of Object.entries(progress.sources)) {
    if (ts.dismissed.has(key)) continue;
    let el = box.querySelector(`[data-toast="${key}"]`);
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      el.dataset.toast = key;
      el.innerHTML = `
        <span class="toast-icon" aria-hidden="true"></span>
        <div class="toast-body"><strong class="${key}">${esc(SOURCE_LABELS[key])}</strong><span class="toast-text"></span></div>
        <button type="button" class="toast-close">×</button>`;
      $('.toast-close', el).addEventListener('click', () => dismissToast(key));
      box.append(el);
    }
    el.dataset.state = entry.state;
    $('.toast-text', el).textContent = toastText(key, entry);
    $('.toast-close', el).setAttribute('aria-label', t('close'));
    if (entry.state !== 'running' && !el.dataset.scheduled) {
      el.dataset.scheduled = '1';
      ts.timers.push(setTimeout(() => dismissToast(key), entry.state === 'error' ? ERROR_TOAST_LINGER_MS : TOAST_LINGER_MS));
    }
  }
}

function dismissToast(key) {
  state.toasts.dismissed.add(key);
  const el = $(`#toasts [data-toast="${key}"]`);
  if (!el) return;
  el.classList.add('leaving');
  setTimeout(() => el.remove(), 250);
}

function filteredGroups() {
  const v = state.view;
  const q = v.q.trim().toLowerCase();
  const groups = (state.data?.groups ?? []).filter((g) => {
    if (v.onlyFav && state.config.user && !isFav(g)) return false;
    if (v.onlyNew && !g.isNew) return false;
    if (v.onlyMulti && g.sources.length < 2) return false;
    if (v.onlyDropped && !isDrop(g)) return false;
    if (q) {
      const hay = [g.title, g.address, g.postcode, g.city, stateName(g.state), districtLabel(g.district), ...g.sources.map((s) => s.title)].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const by = {
    'new': (a, b) => (b.firstSeen ?? '').localeCompare(a.firstSeen ?? '') || (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''),
    'price-asc': (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity),
    'price-desc': (a, b) => (b.price ?? -Infinity) - (a.price ?? -Infinity),
    'sqm-asc': (a, b) => (a.pricePerSqm ?? Infinity) - (b.pricePerSqm ?? Infinity),
    'area-desc': (a, b) => (b.area ?? 0) - (a.area ?? 0),
    'drop': (a, b) => (isDrop(a) ? a.priceChange.pct : 0) - (isDrop(b) ? b.priceChange.pct : 0)
      || (b.priceChange?.at ?? '').localeCompare(a.priceChange?.at ?? ''),
  }[v.sort];
  return groups.sort(by);
}

function sourceChips(g) {
  const byPortal = new Map();
  for (const s of g.sources) byPortal.set(s.source, [...(byPortal.get(s.source) ?? []), s]);
  return [...byPortal].map(([source, items]) => {
    const primary = items[0];
    const isRentolaWithSource = source === 'rentola' && primary.sourceUrl;
    const url = isRentolaWithSource ? primary.sourceUrl : primary.url;
    const label = isRentolaWithSource && primary.sourceHost
      ? t('originalOn', { host: primary.sourceHost })
      : SOURCE_LABELS[source];
    const title = isRentolaWithSource && primary.sourceHost
      ? t('openOriginalOn', { host: primary.sourceHost })
      : t('openOn', { source: SOURCE_LABELS[source] });

    let html = `
    <a class="src ${source}" href="${esc(url)}" target="_blank" rel="noopener noreferrer" title="${esc(title)}">
      ${esc(label)}${items.length > 1 ? `<span class="src-count">×${items.length}</span>` : ''}<span class="ext">↗</span>
    </a>`;

    if (isRentolaWithSource) {
      html += `
    <a class="src rentola-sub" href="${esc(primary.url)}" target="_blank" rel="noopener noreferrer" title="${esc(t('openOn', { source: SOURCE_LABELS.rentola }))}">
      ${esc(t('viaRentola'))}<span class="ext">↗</span>
    </a>`;
    }
    return html;
  }).join('');
}

function cardHtml(g) {
  const img = g.images[0];
  const fav = isFav(g);
  const dropped = isDrop(g);
  const facts = [
    g.type === 'house' && t('type.house'),
    g.area && `${num(g.area, 1)} m²`,
    g.rooms && `${num(g.rooms, 1)} ${t('roomsShort')}`,
    placeLabel(g),
  ].filter(Boolean);
  return `
    <article class="card" data-id="${esc(g.id)}">
      <a class="card-link" href="#/l/${encodeURIComponent(g.id)}" aria-label="${esc(g.title)}"></a>
      <div class="thumb">
        ${img ? `<img src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<div class="noimg">${esc(t('noImage'))}</div>`}
        <div class="badges">
          ${g.isNew ? `<span class="badge new">${esc(t('badgeNew'))}</span>` : ''}
          ${dropped ? `<span class="badge drop">${esc(t('badgeDrop', { pct: num(Math.abs(g.priceChange.pct), 1) }))}</span>` : ''}
          ${g.categories.filter((c) => c !== 'regular').map((c) => `<span class="badge cat cat-${c}">${esc(t(`catShort.${c}`))}</span>`).join('')}
          ${g.sources.length > 1 ? `<span class="badge multi">${esc(t('listedTimes', { n: g.sources.length }))}</span>` : ''}
        </div>
        ${g.images.length > 1 ? `
          <button class="thumb-nav prev" type="button" data-action="img-prev" aria-label="${esc(t('prevPhoto'))}">‹</button>
          <button class="thumb-nav next" type="button" data-action="img-next" aria-label="${esc(t('nextPhoto'))}">›</button>` : ''}
        ${g.images.length ? `<span class="badge photos" data-photo-counter>1 / ${g.images.length}</span>` : ''}
      </div>
      <div class="card-actions">
        ${g.images.length ? `<button class="icon-btn" type="button" data-action="fullscreen" title="${esc(t('fullscreen'))}" aria-label="${esc(t('fullscreen'))}">⤢</button>` : ''}
        <button class="icon-btn fav" type="button" data-action="fav" aria-pressed="${fav}" title="${esc(t('favorite'))}">${fav ? '★' : '☆'}</button>
      </div>
      <div class="card-body">
        <div class="price-row">
          <span class="price">${euro(g.price)}</span>
          ${dropped ? `<s class="was" title="${esc(t('priceWas', { date: fmtDay(g.priceChange.at) }))}">${euro(g.priceChange.previous)}</s>` : ''}
          ${g.pricePerSqm ? `<span class="sqm">${euro(g.pricePerSqm, 2)}/m²</span>` : ''}
        </div>
        <div class="facts">${facts.map((f) => `<span>${esc(f)}</span>`).join('')}</div>
        <p class="title">${esc(g.title)}</p>
        <div class="address">${esc(g.address ?? '')}</div>
        <div class="sources">${sourceChips(g)}</div>
      </div>
    </article>`;
}

function renderList() {
  const groups = filteredGroups();
  const d = state.data;
  $('#grid').innerHTML = groups.map(cardHtml).join('');
  const empty = $('#empty');
  empty.hidden = groups.length > 0;
  if (!groups.length) {
    empty.textContent = !state.config?.searched ? t('emptyStart')
      : !d?.lastRun ? (state.status?.running ? t('emptyRunning') : t('emptyNoData'))
        : state.status?.running ? t('emptyRunning') : t('emptyFilters');
  }
  $('#result-count').textContent = d?.lastRun && state.config?.searched ? t('resultCount', { shown: groups.length, total: d.stats.groups, listings: d.stats.listings, merged: d.stats.merged }) : '';
  for (const btn of document.querySelectorAll('[data-toggle]')) btn.setAttribute('aria-pressed', String(state.view[btn.dataset.toggle]));
}

function renderDetail(id) {
  const g = state.data?.groups.find((x) => x.id === id);
  const el = $('#detail-view');
  if (!g) {
    el.innerHTML = `<div class="detail"><div class="empty">${esc(state.data ? t('notAvailable') : t('loading'))}</div></div>`;
    return;
  }
  const priceDiffers = g.priceMin != null && g.priceMax - g.priceMin >= 1;
  const features = [...new Set(g.extras.map(feature).filter(Boolean))];
  const advertiser = g.isPrivate ? t('private') : g.agency ?? (g.isPrivate === false ? t('agency') : '–');
  const facts = [
    ['fact.rent', euro(g.price, 2)],
    g.priceChange && ['fact.priceChange', `${signedEuro(g.priceChange.delta)} (${g.priceChange.pct > 0 ? '+' : g.priceChange.pct < 0 ? '−' : ''}${num(Math.abs(g.priceChange.pct), 1)} %) · ${fmtDay(g.priceChange.at)}`],
    priceDiffers && ['fact.priceRange', `${euro(g.priceMin)} – ${euro(g.priceMax)}`],
    ['fact.size', g.area ? `${num(g.area, 2)} m²` : '–'],
    ['fact.rooms', num(g.rooms, 1)],
    ['fact.sqm', g.pricePerSqm ? euro(g.pricePerSqm, 2) : '–'],
    ['fact.type', t(`type.${g.type}`)],
    ['fact.category', g.categories.map((c) => t(`cat.${c}`)).join(', ')],
    g.state === 'wien' && g.district
      ? ['fact.district', districtLabel(g.district)]
      : ['fact.place', [g.postcode, g.city].filter(Boolean).join(' ') || '–'],
    g.state && ['fact.region', stateName(g.state)],
    g.floor && ['fact.floor', g.floor],
    ['fact.advertiser', advertiser],
    g.deposit && ['fact.deposit', euro(g.deposit, 2)],
    g.agencyPhone && ['fact.phone', g.agencyPhone],
    g.agencyEmail && ['fact.email', g.agencyEmail],
    ['fact.published', fmtDate(g.publishedAt)],
    ['fact.firstSeen', fmtDate(g.firstSeen)],
  ].filter(Boolean);

  const mapQuery = g.lat != null ? `${g.lat},${g.lng}` : `${g.address ?? g.city ?? ''}, Österreich`;
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`;
  const osm = g.lat != null
    ? `https://www.openstreetmap.org/export/embed.html?bbox=${g.lng - 0.008},${g.lat - 0.005},${g.lng + 0.008},${g.lat + 0.005}&layer=mapnik&marker=${g.lat},${g.lng}`
    : null;

  el.innerHTML = `
    <div class="detail">
      ${galleryHtml(g)}
      <div class="detail-grid">
        <div>
          <div class="detail-head">
            <h1>${esc(g.title)}</h1>
            <button class="btn fav-detail" type="button" data-action="fav-detail"></button>
          </div>
          <div class="address">${esc(g.address ?? '')}</div>
          <dl class="keyfacts">${facts.map(([k, v]) => `<div><dt>${esc(t(k))}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
          ${features.length ? `<div class="panel"><h2>${esc(t('features'))}</h2><p class="description">${esc(features.join(' · '))}</p></div>` : ''}
          <div class="panel" id="description-panel">
            <div class="panel-head">
              <h2>${esc(t('description'))}</h2>
              <button type="button" class="link" id="translate-btn" hidden></button>
            </div>
            <p class="description" id="description-text">${esc(g.description || t('noDescription'))}</p>
            <p class="note" id="translate-note"></p>
          </div>
        </div>
        <aside>
          <div class="panel">
            <h2>${esc(t('originals', { n: g.sources.length }))}</h2>
            <div class="origin-list">
              ${g.sources.map((s) => {
                const url = s.sourceUrl || s.url;
                const label = SOURCE_LABELS[s.source] || s.sourceHost || s.source;
                const actionLabel = t('openListing');

                return `
                  <a class="origin ${s.source}" href="${esc(url)}" target="_blank" rel="noopener noreferrer">
                    <strong>${esc(label)}</strong>
                    <span class="o-price">${euro(s.price, 2)}</span>
                    <span class="o-title">${esc(s.title)}</span>
                    <span class="o-open">${esc(actionLabel)}</span>
                  </a>
                `;
              }).join('')}
            </div>
            ${priceDiffers ? `<div class="price-note">${esc(t('priceDiffers'))}</div>` : ''}
          </div>
          ${priceHistoryHtml(g)}
          <div class="panel">
            <h2>${esc(t('location'))}</h2>
            <div class="rating" id="rating" hidden>
              <div class="panel-head">
                <h3>${esc(t('rating.title'))}</h3>
                <button type="button" class="link" id="rating-btn" hidden>${esc(t('rating.run'))}</button>
              </div>
              <div id="rating-body"></div>
              <p class="note" id="rating-note"></p>
            </div>
            ${osm ? `<iframe class="map" src="${esc(osm)}" loading="lazy" title="${esc(t('map'))}"></iframe>` : ''}
            <a class="btn btn-block" href="${esc(mapsUrl)}" target="_blank" rel="noopener noreferrer">${esc(t('openMaps'))}</a>
            ${osm ? `<p class="note">${esc(t('approxPosition'))}</p>` : ''}
          </div>
        </aside>
      </div>
    </div>`;

  const favBtn = $('[data-action="fav-detail"]', el);
  const syncFav = () => {
    const fav = isFav(g);
    favBtn.setAttribute('aria-pressed', String(fav));
    favBtn.innerHTML = `<span class="star" aria-hidden="true">${fav ? '★' : '☆'}</span><span class="fav-label">${esc(t(fav ? 'favRemove' : 'favAdd'))}</span>`;
    favBtn.title = t(fav ? 'favRemove' : 'favAdd');
  };
  syncFav();
  favBtn.addEventListener('click', () => toggleFav(g, syncFav));
  bindGallery(el, g);
  setupTranslation(g);
  setupRating(g);
  ensureFullDescription(g);
}

async function ensureFullDescription(g) {
  if (g.description && !g.description.endsWith('...')) return;
  const sourceWithDetail = g.sources.find((s) => s.source === 'willhaben');
  if (!sourceWithDetail) return;
  try {
    const res = await api('/api/listings/detail', {
      method: 'POST',
      body: JSON.stringify({ id: sourceWithDetail.id }),
    });
    if (res?.description && res.description !== g.description) {
      g.description = res.description;
      const text = $('#description-text');
      if (text && state.detailShown === g.id) {
        text.textContent = res.description;
        setupTranslation(g);
        setupRating(g);
      }
    }
  } catch (err) {
    console.warn('[detail] fetch failed:', err);
  }
}

const RATING_SCORES = ['transit', 'everyday', 'green'];

function ratingHtml(r) {
  const bar = (key, score) => `
    <li>
      <span>${esc(t(`rating.${key}`))}</span>
      <span class="rating-bar"><i style="width:${score * 10}%"></i></span>
      <b>${score}</b>
    </li>`;
  const stops = r.nearby ? TRANSIT_MODES.map((mode) => {
    const stop = r.nearby[mode][0];
    return stop && `<li><span class="mode">${esc(t(`mode.${mode}`))}</span><span>${esc(stop.name ?? '–')}</span><span class="dist">${esc(t('walk', { m: num(stop.m), min: walkMinutes(stop.m) }))}</span></li>`;
  }).filter(Boolean) : [];
  return `
    <div class="rating-overall"><b>${r.overall}</b><span>/10</span></div>
    <ul class="rating-bars">${RATING_SCORES.map((k) => bar(k, r[k])).join('')}</ul>
    <p class="rating-summary">${esc(r.summary)}</p>
    ${stops.length ? `<ul class="rating-stops">${stops.join('')}</ul>` : ''}`;
}

async function setupRating(g) {
  const box = $('#rating');
  if (!box || !ratingSupported()) return;
  const target = getLang();
  const token = `${g.id}|${target}`;
  box.dataset.token = token;
  const alive = () => box.isConnected && box.dataset.token === token;

  const { availability, outputLang } = await ratingAvailability(target);
  if (!alive() || availability === 'unavailable') return;

  const body = $('#rating-body', box);
  const button = $('#rating-btn', box);
  const note = $('#rating-note', box);
  box.hidden = false;

  const run = async () => {
    button.hidden = true;
    note.textContent = t('rating.running');
    try {
      const result = await rateLocation(g, outputLang, (loaded) => {
        if (alive()) note.textContent = t('downloadingModel', { pct: Math.round(loaded * 100) });
      });
      let summary = result.summary;
      if (outputLang !== target && translationSupported()) {
        summary = await translateText(summary, outputLang, target).catch(() => summary);
      }
      if (!alive()) return;
      body.innerHTML = ratingHtml({ ...result, summary });
      note.textContent = t(`rating.source.${result.mapData}`);
    } catch {
      if (!alive()) return;
      note.textContent = t('rating.failed');
      button.hidden = false;
    }
  };

  button.addEventListener('click', run);
  if (availability === 'available') run();
  else button.hidden = false;
}

async function setupTranslation(g) {
  const panel = $('#description-panel');
  if (!panel || !g.description || !translationSupported()) return;
  const target = getLang();
  const token = `${g.id}|${target}`;
  panel.dataset.token = token;
  const alive = () => panel.isConnected && panel.dataset.token === token;

  const source = await detectLanguage(g.description);
  if (!alive() || !source || source === target) return;
  const availability = await translationAvailability(source, target);
  if (!alive() || availability === 'unavailable') return;

  const text = $('#description-text', panel);
  const button = $('#translate-btn', panel);
  const note = $('#translate-note', panel);
  const names = new Intl.DisplayNames([locale()], { type: 'language' });
  let translated = null;
  let showingTranslation = false;

  const show = (translation) => {
    showingTranslation = translation;
    text.textContent = translation ? translated : g.description;
    button.textContent = translation ? t('showOriginal') : t('translateTo', { lang: names.of(target) });
    note.textContent = translation ? t('translatedFrom', { lang: names.of(source) }) : '';
  };

  const run = async () => {
    button.disabled = true;
    note.textContent = t('translating');
    try {
      translated = await translateText(g.description, source, target, (loaded) => {
        if (alive()) note.textContent = t('downloadingModel', { pct: Math.round(loaded * 100) });
      });
      if (alive()) show(true);
    } catch {
      if (alive()) note.textContent = t('translateFailed');
    } finally {
      button.disabled = false;
    }
  };

  button.addEventListener('click', () => {
    if (showingTranslation) show(false);
    else if (translated) show(true);
    else run();
  });
  show(false);
  button.hidden = false;
  if (availability === 'available') run();
}

function galleryHtml(g) {
  if (!g.images.length) return '';
  return `
    <div class="gallery">
      <div class="gallery-main">
        <img src="${esc(g.images[0])}" alt="" referrerpolicy="no-referrer" data-index="0">
        ${g.images.length > 1 ? `
          <button class="gallery-nav prev" type="button" aria-label="${esc(t('prevImage'))}">‹</button>
          <button class="gallery-nav next" type="button" aria-label="${esc(t('nextImage'))}">›</button>
          <span class="badge photos gallery-count">1 / ${g.images.length}</span>` : ''}
      </div>
      ${g.images.length > 1 ? `<div class="thumbs">${g.images.map((src, i) => `
        <button type="button" data-index="${i}" aria-current="${i === 0}" aria-label="${esc(t('image', { n: i + 1 }))}">
          <img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer">
        </button>`).join('')}</div>` : ''}
    </div>`;
}

function bindGallery(el, g) {
  const main = $('.gallery-main img', el);
  if (!main) return;
  main.addEventListener('click', () => openLightbox(g.images, Number(main.dataset.index ?? 0)));
  if (g.images.length < 2) return;
  const show = (i) => {
    const idx = (i + g.images.length) % g.images.length;
    main.src = g.images[idx];
    main.dataset.index = idx;
    $('.gallery-count', el).textContent = `${idx + 1} / ${g.images.length}`;
    el.querySelectorAll('.thumbs button').forEach((b, j) => b.setAttribute('aria-current', String(j === idx)));
    el.querySelectorAll('.thumbs button')[idx]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  $('.prev', el).addEventListener('click', () => show(Number(main.dataset.index) - 1));
  $('.next', el).addEventListener('click', () => show(Number(main.dataset.index) + 1));
  el.querySelectorAll('.thumbs button').forEach((b) => b.addEventListener('click', () => show(Number(b.dataset.index))));
}

function openLightbox(images, index = 0) {
  if (!images?.length) return;
  state.lightbox = { images, index };
  const box = $('#lightbox');
  box.hidden = false;
  document.body.classList.add('lightbox-open');
  showLightboxImage(index);
}

function showLightboxImage(index) {
  const { images } = state.lightbox;
  const i = (index + images.length) % images.length;
  state.lightbox.index = i;
  const box = $('#lightbox');
  $('img', box).src = images[i];
  $('.lb-count', box).textContent = `${i + 1} / ${images.length}`;
  box.classList.toggle('single', images.length < 2);
  for (const n of [i + 1, i - 1]) new Image().src = images[(n + images.length) % images.length];
}

function closeLightbox() {
  if (!state.lightbox) return;
  state.lightbox = null;
  $('#lightbox').hidden = true;
  document.body.classList.remove('lightbox-open');
}

function bindLightbox() {
  const box = $('#lightbox');
  box.addEventListener('click', (e) => {
    const action = e.target.closest('[data-lb]')?.dataset.lb;
    if (action === 'close') closeLightbox();
    else if (action === 'prev') showLightboxImage(state.lightbox.index - 1);
    else if (action === 'next') showLightboxImage(state.lightbox.index + 1);
    else if (e.target === box) closeLightbox();
  });
  let startX = null;
  box.addEventListener('pointerdown', (e) => { startX = e.clientX; });
  box.addEventListener('pointerup', (e) => {
    if (startX == null || !state.lightbox) return;
    const dx = e.clientX - startX;
    startX = null;
    if (Math.abs(dx) > 50) showLightboxImage(state.lightbox.index + (dx < 0 ? 1 : -1));
  });
}

const detailId = () => /^#\/l\/(.+)$/.exec(location.hash)?.[1];

function route() {
  const id = detailId();
  if (id && state.route === 'list') {
    state.listScroll = window.scrollY;
    state.openedFromList = true;
  }
  document.body.classList.toggle('detail-mode', Boolean(id));
  $('#list-view').hidden = Boolean(id);
  $('#detail-view').hidden = !id;
  if (id) {
    renderDetail(decodeURIComponent(id));
    window.scrollTo(0, 0);
  } else {
    renderList();
    window.scrollTo(0, state.route === 'detail' ? state.listScroll ?? 0 : window.scrollY);
    state.openedFromList = false;
  }
  state.route = id ? 'detail' : 'list';
}

function goBack() {
  if (state.openedFromList) history.back();
  else location.hash = '#/';
}

function renderAll() {
  applyStatic();
  for (const btn of document.querySelectorAll('[data-lang]')) btn.setAttribute('aria-pressed', String(btn.dataset.lang === getLang()));
  renderPrefs();
  renderStatus();
  renderToasts();
  const id = detailId();
  if (id) renderDetail(decodeURIComponent(id));
  else renderList();
}

async function loadListings() {
  state.data = await api('/api/listings');
  renderCategoryCounts();
  if (detailId()) {
    if ($('#detail-view .empty')) route();
  } else {
    renderList();
  }
}

async function pollStatus() {
  clearTimeout(state.pollTimer);
  try {
    const prev = state.status;
    state.status = await api('/api/status');
    renderStatus();
    renderToasts();
    const finished = prev?.running && !state.status.running;
    if (!state.data || finished || state.status.lastRun !== state.data.lastRun) await loadListings();
  } catch (err) {
    if (!state.config) return;
    $('#status').textContent = `${t('error')}: ${err.message}`;
  }
  if (state.config) state.pollTimer = setTimeout(pollStatus, state.status?.running ? 1000 : 20000);
}

function readPrefsForm(form) {
  const checked = (name) => [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((i) => i.value);
  return {
    ...Object.fromEntries(RANGE_FIELDS.map((k) => [k, form[k].value])),
    states: checked('state'),
    types: checked('type'),
    categories: checked('category'),
    districts: allTicked('#districts input') ? [] : checked('district').map(Number),
    sources: checked('source'),
  };
}

function bindEvents() {
  $('#refresh').addEventListener('click', async () => {
    await api('/api/refresh', { method: 'POST' });
    await pollStatus();
  });

  $('#prefs').addEventListener('submit', async (e) => {
    e.preventDefault();
    const res = await api('/api/prefs', { method: 'PUT', body: JSON.stringify(readPrefsForm(e.currentTarget)) });
    state.config.prefs = res.prefs;
    state.config.searched = true;
    renderPrefs();
    renderStatus();
    $('#prefs-hint').textContent = res.running ? t('savedRunning') : t('saved');
    setTimeout(() => { $('#prefs-hint').textContent = ''; }, 4000);
    $('#sidebar').classList.remove('open');
    await loadListings();
    await pollStatus();
  });

  $('#categories').addEventListener('change', () => {
    savePrefsPatch({ categories: [...document.querySelectorAll('#categories input:checked')].map((i) => i.value) });
  });

  $('#categories-all').addEventListener('click', () => {
    document.querySelectorAll('#categories input').forEach((i) => { i.checked = true; });
    savePrefsPatch({ categories: state.config.categories });
  });

  $('#sources').addEventListener('change', (e) => {
    const sources = [...document.querySelectorAll('#sources input:checked')].map((i) => i.value);
    if (!sources.length) {
      e.target.checked = true;
      return;
    }
    savePrefsPatch({ sources });
  });

  $('#states').addEventListener('change', updateRegionControls);
  $('#districts').addEventListener('change', updateRegionControls);
  for (const id of BULK_TOGGLES) {
    $(`#${id}-all`).addEventListener('click', () => tickAll(id, true));
    $(`#${id}-none`).addEventListener('click', () => tickAll(id, false));
  }

  $('#filters-toggle').addEventListener('click', () => $('#sidebar').classList.toggle('open'));

  $('#q').value = state.view.q;
  $('#q').addEventListener('input', (e) => {
    state.view.q = e.target.value;
    saveLocal();
    renderList();
  });

  $('#sort').value = state.view.sort;
  $('#sort').addEventListener('change', (e) => {
    state.view.sort = e.target.value;
    saveLocal();
    renderList();
  });

  document.querySelectorAll('[data-toggle]').forEach((btn) => btn.addEventListener('click', () => {
    const key = btn.dataset.toggle;
    state.view[key] = !state.view[key];
    saveLocal();
    renderList();
  }));

  $('#grid').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    e.preventDefault();
    const card = btn.closest('.card');
    const g = state.data.groups.find((x) => x.id === card.dataset.id);
    if (btn.dataset.action === 'fav') {
      toggleFav(g, renderList);
      return;
    }
    const img = $('.thumb img', card);
    if (btn.dataset.action === 'fullscreen') {
      openLightbox(g.images, Number(img?.dataset.index ?? 0));
      return;
    }
    const step = btn.dataset.action === 'img-next' ? 1 : -1;
    const index = (Number(img.dataset.index ?? 0) + step + g.images.length) % g.images.length;
    img.dataset.index = index;
    img.src = g.images[index];
    $('[data-photo-counter]', card).textContent = `${index + 1} / ${g.images.length}`;
  });

  window.addEventListener('hashchange', route);
  $('#back').addEventListener('click', (e) => {
    e.preventDefault();
    goBack();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('auth-open')) {
      closeAuth();
      return;
    }
    if (state.lightbox) {
      if (e.key === 'Escape') closeLightbox();
      else if (e.key === 'ArrowLeft') showLightboxImage(state.lightbox.index - 1);
      else if (e.key === 'ArrowRight') showLightboxImage(state.lightbox.index + 1);
      else return;
      e.preventDefault();
      return;
    }
    if (!detailId() || e.target.matches('input, select, textarea')) return;
    if (e.key === 'Escape') goBack();
    if (e.key === 'ArrowLeft') $('.gallery-nav.prev')?.click();
    if (e.key === 'ArrowRight') $('.gallery-nav.next')?.click();
  });
}

async function startApp() {
  clearTimeout(state.pollTimer);
  state.config = await api('/api/config');
  state.favorites = new Set(state.config.favorites);
  state.data = null;
  document.body.classList.toggle('guest', !state.config.user);
  $('#user-email').textContent = state.config.user?.email ?? '';
  if (!state.appBound) {
    bindEvents();
    bindLightbox();
    state.appBound = true;
  }
  await syncAccount();
  document.body.classList.remove('booting');
  state.route = null;
  renderAll();
  await pollStatus();
  route();
}

async function init() {
  history.scrollRestoration = 'manual';
  setLang(state.view.lang ?? (navigator.language?.toLowerCase().startsWith('de') ? 'de' : 'en'));
  applyStatic();
  for (const btn of document.querySelectorAll('[data-lang]')) btn.setAttribute('aria-pressed', String(btn.dataset.lang === getLang()));
  bindAuth();
  const oauthError = new URLSearchParams(location.search).get('error');
  if (oauthError) history.replaceState(null, '', location.pathname + location.hash);
  await startApp();
  if (oauthError) openAuth(null, authErrorText(oauthError, 'authError.oauth'));
}

init().catch((err) => {
  document.body.insertAdjacentHTML('beforeend', `<div class="empty">${esc(t('serverDown', { msg: err.message }))}</div>`);
});
