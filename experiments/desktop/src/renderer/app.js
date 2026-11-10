import { applyStatic, feature, getLang, locale, setLang, t } from './i18n.js';
import { detectLanguage, translateText, translationAvailability, translationSupported } from './translate.js';
import { TRANSIT_MODES, rateLocation, ratingAvailability, ratingSupported, walkMinutes } from './location.js';

const SOURCE_LABELS = { willhaben: 'willhaben', immoscout: 'ImmoScout24', cooperatives: 'Genossenschaften', justimmo: 'JustImmo', wunderflats: 'Wunderflats', fify: 'Fify' };
const RANGE_FIELDS = ['minPrice', 'maxPrice', 'minArea', 'maxArea', 'minRooms', 'maxRooms'];
const VIEW_DEFAULTS = { sort: 'new', onlyNew: false, onlyMulti: false, onlyDropped: false, onlyFav: false, q: '' };
const TOAST_LINGER_MS = 5000;
const ERROR_TOAST_LINGER_MS = 20000;
const VIEW_SAVE_DELAY_MS = 400;
const CLOCK_TICK_MS = 60 * 1000;

const state = {
  config: null,
  searches: [],
  activeId: null,
  draft: null,
  data: null,
  status: null,
  view: { ...VIEW_DEFAULTS },
  favorites: new Set(),
  viewTimer: null,
  toasts: { runId: null, dismissed: new Set(), timers: [] },
};

const $ = (sel, root = document) => root.querySelector(sel);

const api = (method, payload) => window.rentradar.call(method, payload);

function saveView() {
  clearTimeout(state.viewTimer);
  state.viewTimer = setTimeout(() => api('setSetting', { key: 'view', value: state.view }).catch(() => {}), VIEW_SAVE_DELAY_MS);
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const euro = (n, digits = 0) => (n == null ? '–' : new Intl.NumberFormat(locale(), { style: 'currency', currency: 'EUR', maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n));
const num = (n, digits = 0) => (n == null ? '–' : new Intl.NumberFormat(locale(), { maximumFractionDigits: digits }).format(n));
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' }) : '–');
const fmtDay = (iso) => (iso ? new Date(iso).toLocaleDateString(locale(), { day: 'numeric', month: 'short' }) : '–');
const isDrop = (g) => g.priceChange != null && g.priceChange.delta < 0;
const signedEuro = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${euro(Math.abs(n), Number.isInteger(n) ? 0 : 2)}`;

const activeSearch = () => state.searches.find((s) => s.id === state.activeId) ?? null;
const currentPrefs = () => activeSearch()?.prefs ?? state.draft;
const isScanning = (id) => state.status?.running === id;
const isQueued = (id) => state.status?.queue?.includes(id) ?? false;

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

function suggestName(prefs) {
  const states = prefs.states.length ? prefs.states.map(stateName) : [t('country')];
  const parts = [states.length > 2 ? `${states.slice(0, 2).join(', ')} +${states.length - 2}` : states.join(', ')];
  if (prefs.types.length === 1) parts.push(t(`type.${prefs.types[0]}`));
  if (prefs.maxPrice) parts.push(t('upTo', { v: euro(prefs.maxPrice) }));
  if (prefs.minRooms) parts.push(`${t('fromRooms', { n: prefs.minRooms })}`);
  return parts.join(' · ');
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

async function toggleFav(g, rerender) {
  const ids = memberIds(g);
  const add = !isFav(g);
  for (const id of ids) add ? state.favorites.add(id) : state.favorites.delete(id);
  rerender();
  try {
    const res = await api('favorites', add ? { add: ids } : { remove: ids });
    state.favorites = new Set(res.favorites);
  } catch {
    for (const id of ids) add ? state.favorites.delete(id) : state.favorites.add(id);
  }
  rerender();
}

function applyLang(lang) {
  setLang(lang);
  if (!document.body.classList.contains('booting')) renderAll();
}

function renderSearchList() {
  const list = $('#search-list');
  if (!state.searches.length) {
    list.innerHTML = `<li class="search-empty">${esc(t('noSearches'))}</li>`;
  } else {
    list.innerHTML = state.searches.map((s) => {
      const meta = isScanning(s.id) ? t('scanRunning')
        : isQueued(s.id) ? t('scanQueued')
          : s.lastScanAt ? `${t('objects', { n: num(s.listingCount) })} · ${relTime(s.lastScanAt)}` : t('neverScanned');
      return `
        <li>
          <button type="button" class="search-item" data-search="${s.id}" aria-current="${s.id === state.activeId}">
            <span class="search-name">${esc(s.name)}</span>
            <span class="search-meta ${isScanning(s.id) ? 'running' : ''}">${esc(meta)}</span>
          </button>
        </li>`;
    }).join('');
  }
  $('#new-search').setAttribute('aria-current', String(state.activeId == null));
  $('#scan-all').disabled = !state.searches.length || state.searches.every((s) => isScanning(s.id) || isQueued(s.id));
}

function renderAutoRefresh() {
  const select = $('#auto-refresh');
  const current = state.config.settings.autoRefreshMinutes ?? 0;
  select.innerHTML = state.config.refreshChoices.map((m) => `
    <option value="${m}" ${m === current ? 'selected' : ''}>${esc(m === 0 ? t('autoRefreshOff') : m < 60 ? t('everyMinutes', { n: m }) : t('everyHours', { n: m / 60 }))}</option>`).join('');
}

function renderPrefs() {
  const { districts, sources, types, categories, states } = state.config;
  const prefs = currentPrefs();
  const search = activeSearch();
  const form = $('#prefs');
  $('#prefs-title').textContent = search ? t('editSearch') : t('newSearchTitle');
  $('#save-search').textContent = search ? t('saveSearch') : t('createSearch');
  $('#delete-search').hidden = !search;
  form.elements.namedItem('name').value = search?.name ?? '';
  form.elements.namedItem('name').placeholder = suggestName(prefs);
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
    el.textContent = activeSearch() ? state.data?.categoryCounts?.[el.dataset.catCount] ?? '' : '';
  }
}

async function savePrefsPatch(patch) {
  const search = activeSearch();
  if (!search) {
    state.draft = { ...state.draft, ...patch };
    return;
  }
  const res = await api('saveSearch', { id: search.id, name: search.name, prefs: { ...search.prefs, ...patch } });
  replaceSearch(res.search);
  await loadListings();
}

function replaceSearch(search) {
  const i = state.searches.findIndex((s) => s.id === search.id);
  if (i >= 0) state.searches[i] = search;
  else state.searches.push(search);
}

function renderSourceCounts() {
  for (const el of document.querySelectorAll('[data-count]')) {
    const run = activeSearch() ? state.data?.runs?.[el.dataset.count] : null;
    el.textContent = run ? (run.ok ? run.count : t('error')) : '';
  }
}

function renderStatus() {
  const search = activeSearch();
  const btn = $('#refresh');
  const busy = search && (isScanning(search.id) || isQueued(search.id));
  btn.classList.toggle('is-running', Boolean(busy));
  btn.disabled = !search || Boolean(busy);
  $('.label', btn).textContent = !search ? t('refresh') : isScanning(search.id) ? t('refreshing') : isQueued(search.id) ? t('scanQueued') : t('refresh');

  const runs = search && state.data?.searchId === search.id ? state.data.runs : {};
  const parts = Object.entries(runs ?? {}).map(([id, r]) => r.ok
    ? `<span class="src-status" title="${esc(fmtDate(r.at))}"><span class="dot ${id}"></span>${esc(SOURCE_LABELS[id])} ${r.count}</span>`
    : `<span class="src-status err" title="${esc(r.error)}"><span class="dot ${id}"></span>${esc(SOURCE_LABELS[id])} ${esc(t('error'))}</span>`);
  if (search?.lastScanAt) parts.push(`<span>${esc(t('updated', { time: relTime(search.lastScanAt) }))}</span>`);
  $('#status').innerHTML = parts.join('');
  renderSourceCounts();
}

function toastText(entry) {
  if (entry.state === 'running') return entry.count ? t('toast.loading', { n: entry.count }) : t('toast.loadingNone');
  if (entry.state === 'done') return t('toast.done', { n: entry.count, s: num((entry.ms ?? 0) / 1000, 1) });
  return t('toast.error', { msg: entry.error });
}

function renderToasts() {
  const progress = state.status?.progress;
  const box = $('#toasts');
  const ts = state.toasts;
  if (!progress) return;
  const runId = `${progress.searchId}|${progress.startedAt}`;
  if (runId !== ts.runId) {
    const stale = progress.finishedAt && Date.now() - Date.parse(progress.finishedAt) > TOAST_LINGER_MS;
    if (stale) return;
    ts.runId = runId;
    ts.dismissed.clear();
    ts.timers.forEach(clearTimeout);
    ts.timers = [];
    box.innerHTML = '';
  }
  const searchName = state.searches.find((s) => s.id === progress.searchId)?.name ?? '';
  for (const [key, entry] of Object.entries(progress.sources)) {
    if (ts.dismissed.has(key)) continue;
    let el = box.querySelector(`[data-toast="${key}"]`);
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      el.dataset.toast = key;
      el.innerHTML = `
        <span class="toast-icon" aria-hidden="true"></span>
        <div class="toast-body"><strong class="${key}">${esc(SOURCE_LABELS[key])}</strong><span class="toast-search"></span><span class="toast-text"></span></div>
        <button type="button" class="toast-close">×</button>`;
      $('.toast-close', el).addEventListener('click', () => dismissToast(key));
      box.append(el);
    }
    el.dataset.state = entry.state;
    $('.toast-search', el).textContent = searchName;
    $('.toast-text', el).textContent = toastText(entry);
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
    if (v.onlyFav && !isFav(g)) return false;
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
  }[v.sort] ?? (() => 0);
  return groups.sort(by);
}

function sourceChips(g) {
  const byPortal = new Map();
  for (const s of g.sources) byPortal.set(s.source, [...(byPortal.get(s.source) ?? []), s]);
  return [...byPortal].map(([source, items]) => {
    const primary = items[0];
    const url = primary.sourceUrl || primary.url;
    const label = SOURCE_LABELS[source] || primary.sourceHost || source;
    const title = t('openOn', { source: label });

    return `
      <a class="src ${source}" href="${esc(url)}" target="_blank" rel="noopener noreferrer" title="${esc(title)}">
        ${esc(label)}${items.length > 1 ? `<span class="src-count">×${items.length}</span>` : ''}<span class="ext">↗</span>
      </a>`;
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

function emptyText() {
  const search = activeSearch();
  if (!search) return state.searches.length ? t('emptyPick') : t('emptyStart');
  const busy = isScanning(search.id) || isQueued(search.id);
  if (!search.lastScanAt) return busy ? t('emptyRunning') : t('emptyNoData');
  return busy ? t('emptyRunning') : t('emptyFilters');
}

function renderList() {
  const search = activeSearch();
  const groups = search ? filteredGroups() : [];
  const d = state.data;
  $('#grid').innerHTML = groups.map(cardHtml).join('');
  const empty = $('#empty');
  empty.hidden = groups.length > 0;
  if (!groups.length) empty.textContent = emptyText();
  $('#result-count').textContent = search?.lastScanAt && d ? t('resultCount', { shown: groups.length, total: d.stats.groups, listings: d.stats.listings, merged: d.stats.merged }) : '';
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
    const res = await api('fetchDetail', { id: sourceWithDetail.id });
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
  renderSearchList();
  renderAutoRefresh();
  renderPrefs();
  renderStatus();
  renderToasts();
  const id = detailId();
  if (id) renderDetail(decodeURIComponent(id));
  else renderList();
}

async function loadListings() {
  const id = state.activeId;
  const data = await api('listings', { id });
  if (id !== state.activeId) return;
  state.data = data;
  renderCategoryCounts();
  renderStatus();
  if (detailId()) {
    if ($('#detail-view .empty')) route();
  } else {
    renderList();
  }
}

async function refreshSearches() {
  state.searches = await api('searches');
  renderSearchList();
}

async function selectSearch(id) {
  state.activeId = id;
  state.data = null;
  if (id == null) state.draft = { ...state.config.defaults };
  api('setSetting', { key: 'activeSearchId', value: id }).catch(() => {});
  if (detailId()) location.hash = '#/';
  renderSearchList();
  renderPrefs();
  renderStatus();
  renderList();
  await loadListings();
}

async function onScanStatus(status) {
  const prev = state.status;
  state.status = status;
  const finished = status.progress?.finishedAt && status.progress.finishedAt !== prev?.progress?.finishedAt;
  const queueChanged = JSON.stringify([prev?.running, prev?.queue]) !== JSON.stringify([status.running, status.queue]);
  renderToasts();
  if (finished || queueChanged) await refreshSearches();
  renderStatus();
  if (!detailId()) renderList();
  if (finished && status.progress.searchId === state.activeId) await loadListings();
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

function flashHint(text) {
  $('#prefs-hint').textContent = text;
  setTimeout(() => { $('#prefs-hint').textContent = ''; }, 4000);
}

function bindEvents() {
  $('#refresh').addEventListener('click', async () => {
    if (state.activeId == null) return;
    await api('scan', { id: state.activeId });
  });

  $('#scan-all').addEventListener('click', () => api('scanAll'));

  $('#new-search').addEventListener('click', () => {
    $('#sidebar').classList.add('open');
    selectSearch(null);
    $('#search-name').focus();
  });

  $('#search-list').addEventListener('click', (e) => {
    const id = Number(e.target.closest('[data-search]')?.dataset.search);
    if (!id) return;
    $('#sidebar').classList.remove('open');
    if (id !== state.activeId) selectSearch(id);
    else if (detailId()) location.hash = '#/';
  });

  $('#auto-refresh').addEventListener('change', async (e) => {
    const value = Number(e.target.value);
    await api('setSetting', { key: 'autoRefreshMinutes', value });
    state.config.settings.autoRefreshMinutes = value;
  });

  $('#prefs').addEventListener('input', (e) => {
    if (e.target.name !== 'name') $('#search-name').placeholder = suggestName({ ...currentPrefs(), ...readPrefsForm(e.currentTarget) });
  });

  $('#prefs').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const prefs = readPrefsForm(form);
    const name = form.elements.namedItem('name').value.trim() || suggestName({ ...currentPrefs(), ...prefs });
    const button = $('#save-search');
    button.disabled = true;
    try {
      const res = await api('saveSearch', { id: state.activeId, name, prefs });
      replaceSearch(res.search);
      state.activeId = res.search.id;
      api('setSetting', { key: 'activeSearchId', value: res.search.id }).catch(() => {});
      renderSearchList();
      renderPrefs();
      renderStatus();
      flashHint(res.scanning ? t('savedRunning') : t('saved'));
      $('#sidebar').classList.remove('open');
      await loadListings();
    } catch (err) {
      flashHint(`${t('error')}: ${err.message}`);
    } finally {
      button.disabled = false;
    }
  });

  $('#delete-search').addEventListener('click', async () => {
    const search = activeSearch();
    if (!search || !window.confirm(t('confirmDelete', { name: search.name }))) return;
    const { searches } = await api('deleteSearch', { id: search.id });
    state.searches = searches;
    await selectSearch(searches[0]?.id ?? null);
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
    saveView();
    renderList();
  });

  $('#sort').value = state.view.sort;
  $('#sort').addEventListener('change', (e) => {
    state.view.sort = e.target.value;
    saveView();
    renderList();
  });

  document.querySelectorAll('[data-toggle]').forEach((btn) => btn.addEventListener('click', () => {
    const key = btn.dataset.toggle;
    state.view[key] = !state.view[key];
    saveView();
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

  $('#lang-switch').addEventListener('click', (e) => {
    const lang = e.target.closest('[data-lang]')?.dataset.lang;
    if (!lang || lang === getLang()) return;
    applyLang(lang);
    api('setSetting', { key: 'locale', value: lang }).catch(() => {});
  });

  window.addEventListener('hashchange', route);
  $('#back').addEventListener('click', (e) => {
    e.preventDefault();
    goBack();
  });
  document.addEventListener('keydown', (e) => {
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

  setInterval(() => {
    renderSearchList();
    renderStatus();
  }, CLOCK_TICK_MS);
}

async function init() {
  history.scrollRestoration = 'manual';
  setLang(navigator.language?.toLowerCase().startsWith('de') ? 'de' : 'en');
  applyStatic();
  state.config = await api('config');
  const { settings } = state.config;
  if (settings.locale) setLang(settings.locale);
  state.view = { ...VIEW_DEFAULTS, ...settings.view };
  state.searches = state.config.searches;
  state.favorites = new Set(state.config.favorites);
  state.draft = { ...state.config.defaults };
  state.activeId = state.searches.some((s) => s.id === settings.activeSearchId) ? settings.activeSearchId : state.searches[0]?.id ?? null;
  state.status = await api('status');
  window.rentradar.onScanStatus(onScanStatus);
  bindEvents();
  bindLightbox();
  document.body.classList.remove('booting');
  state.route = null;
  renderAll();
  await loadListings();
  route();
}

init().catch((err) => {
  document.body.insertAdjacentHTML('beforeend', `<div class="empty">${esc(t('serverDown', { msg: err.message }))}</div>`);
});
