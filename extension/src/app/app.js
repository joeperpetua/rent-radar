import { applyStatic, feature, getLang, locale, setLang, t } from './i18n.js';
import { detectLanguage, translateText, translationAvailability, translationSupported } from './translate.js';
import { TRANSIT_MODES, rateLocation, ratingAvailability, ratingSupported, walkMinutes } from './location.js';
import { hydrateIcons, icon } from './icons.js';
import { missingGroups } from '../core/prefs.js';

const SOURCE_LABELS = {};
const SOURCE_KINDS = ['portal', 'broker', 'cooperative'];
const sourceLabel = (s) => s.sourceName || SOURCE_LABELS[s.source] || s.sourceHost || s.source;
const RANGE_FIELDS = ['minPrice', 'maxPrice', 'minArea', 'maxArea', 'minRooms', 'maxRooms'];
const VIEW_DEFAULTS = { sort: 'new', onlyNew: false, onlyMulti: false, onlyDropped: false, q: '' };
const TOAST_LINGER_MS = 2500;
const ERROR_TOAST_LINGER_MS = 20000;
const VIEW_SAVE_DELAY_MS = 400;
const CLOCK_TICK_MS = 60 * 1000;
const SEARCH_MENU_WIDTH = 360;
const SETTINGS_MENU_WIDTH = 320;
const STYLE_KEY = 'rentradar-style';
const THEME_KEY = 'rentradar-theme';
const RADAR_SWEEP_MS = 4000;
const RADAR_TICK_MS = 1000;
const MAX_BLIPS_PER_SOURCE = 12;
const LISTINGS_PER_BLIP = 25;
const MAX_STAGGER = 14;
const PULL_TRIGGER = 72;
const PULL_MAX = 110;
const PULL_RESISTANCE = 0.5;
const PULL_SETTLE_MS = 700;
const PULL_FADE_IN = 24;
const PULL_LEAVE_MS = 500;
const SWIPE_SLOP = 6;
const SWIPE_BACK_TRIGGER = 110;
const SWIPE_BACK_FOLLOW = 0.7;
const SWIPE_BACK_MAX = 400;
const SWIPE_BACK_SHRINK = 0.18;
const SWIPE_BACK_FADE = 160;
const EASE_OUT = 'cubic-bezier(.2, .8, .2, 1)';
const STATE_ICONS = { waiting: 'circle-dashed', running: 'loader-circle', done: 'circle-check', error: 'circle-alert' };

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
  toasts: { runId: null, dismissed: new Set(), timers: [], radarRuns: new Set() },
  knownSearches: new Set(),
  radarTimer: null,
  favData: null,
  favToken: 0,
  favSelected: null,
  statusHtml: '',
};

const $ = (sel, root = document) => root.querySelector(sel);

const api = (method, payload) => window.rentradar.call(method, payload);

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function inViewport(el) {
  const r = el.getBoundingClientRect();
  return r.bottom > 0 && r.top < window.innerHeight && r.width > 0;
}

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
          <strong class="history-source ${s.source}">${esc(sourceLabel(s))}</strong>
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
  const everywhere = !prefs.states.length || prefs.states.length === state.config.states.length;
  const states = everywhere ? [t('country')] : prefs.states.map(stateName);
  const parts = [states.length > 2 ? `${states.slice(0, 2).join(', ')} +${states.length - 2}` : states.join(', ')];
  if (prefs.types.length === 1) parts.push(t(`type.${prefs.types[0]}`));
  if (prefs.maxPrice) parts.push(t('upTo', { v: euro(prefs.maxPrice) }));
  if (prefs.minRooms) parts.push(`${t('fromRooms', { n: prefs.minRooms })}`);
  return parts.join(' · ');
}

const BULK_TOGGLES = ['states', 'categories', 'districts', 'sources'];
const AUTOSAVED = ['categories', 'sources'];

const tickedValues = (id) => [...document.querySelectorAll(`#${id} input:checked`)].map((i) => i.value);

function updateFormState() {
  $('#districts-field').hidden = !$('#states input[value="wien"]')?.checked;
  for (const id of BULK_TOGGLES) {
    const boxes = [...document.querySelectorAll(`#${id} input`)];
    $(`#${id}-all`).disabled = boxes.every((i) => i.checked);
    $(`#${id}-none`).disabled = boxes.every((i) => !i.checked);
  }
  const missing = missingGroups(readPrefsForm($('#prefs')));
  for (const tag of document.querySelectorAll('[data-pick]')) tag.hidden = !missing.includes(tag.dataset.pick);
  const blocked = !activeSearch() && missing.length > 0;
  $('#save-search').disabled = blocked;
  $('#prefs-hint').textContent = blocked ? t('pickRequired') : '';
}

function tickAll(id, checked) {
  document.querySelectorAll(`#${id} input`).forEach((i) => { i.checked = checked; });
  updateFormState();
  if (AUTOSAVED.includes(id)) savePrefsPatch({ [id]: tickedValues(id) });
}

const memberIds = (g) => g.sources.map((s) => s.id);
const isFav = (g) => memberIds(g).some((id) => state.favorites.has(id));

const visibleCard = (id) => [...document.querySelectorAll('.card')].find((c) => c.dataset.id === id && c.checkVisibility()) ?? null;

function findGroup(id) {
  const own = state.data?.groups.find((x) => x.id === id);
  if (own) return own;
  for (const groups of state.favData?.values() ?? []) {
    const g = groups.find((x) => x.id === id);
    if (g) return g;
  }
  return null;
}

function popStar(id) {
  if (reduceMotion()) return;
  const card = visibleCard(id);
  for (const btn of [card?.querySelector('.fav'), $('#detail-view .fav-detail')]) {
    if (!btn) continue;
    btn.classList.remove('pop');
    void btn.offsetWidth;
    btn.classList.add('pop');
  }
}

async function toggleFav(g, rerender) {
  const ids = memberIds(g);
  const add = !isFav(g);
  for (const id of ids) add ? state.favorites.add(id) : state.favorites.delete(id);
  rerender();
  if (add) popStar(g.id);
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
    let entering = 0;
    list.innerHTML = state.searches.map((s) => {
      const meta = isScanning(s.id) ? t('scanRunning')
        : isQueued(s.id) ? t('scanQueued')
          : s.lastScanAt ? `${t('objects', { n: num(s.listingCount) })} · ${relTime(s.lastScanAt)}` : t('neverScanned');
      const fresh = !state.knownSearches.has(s.id) && !reduceMotion();
      state.knownSearches.add(s.id);
      const busy = isScanning(s.id) || isQueued(s.id);
      return `
        <li ${fresh ? `class="entering" style="--i:${entering++}"` : ''}>
          <button type="button" class="search-item" data-search="${s.id}" aria-current="${s.id === state.activeId}">
            <span class="search-name">${esc(s.name)}</span>
            <span class="search-meta ${isScanning(s.id) ? 'running' : ''}">${isScanning(s.id) ? icon('radar', 'spin') : ''}${esc(meta)}</span>
          </button>
          <span class="search-actions">
            <button type="button" class="search-action" data-rescan="${s.id}" title="${esc(t('rescanSearch'))}" aria-label="${esc(t('rescanSearch'))}" ${busy ? 'disabled' : ''}>${icon('refresh-cw', isScanning(s.id) ? 'spin' : '')}</button>
            <button type="button" class="search-action search-delete" data-delete="${s.id}" title="${esc(t('deleteSearch'))}" aria-label="${esc(t('deleteSearch'))}">${icon('trash-2')}</button>
          </span>
        </li>`;
    }).join('');
  }
  $('#new-search').setAttribute('aria-current', String(state.activeId == null));
  renderSearchTrigger();
}

function renderSearchTrigger() {
  const trigger = $('#search-trigger');
  $('#search-trigger-name').textContent = activeSearch()?.name ?? t('newSearchTitle');
  trigger.classList.toggle('is-running', state.status?.running != null);
}

function placeMenu(menu, trigger, maxWidth) {
  const rect = trigger.getBoundingClientRect();
  const gutter = 12;
  const width = Math.min(maxWidth, window.innerWidth - gutter * 2);
  menu.style.top = `${Math.round(rect.bottom + 8)}px`;
  menu.style.left = `${Math.round(Math.max(gutter, Math.min(rect.right - width, window.innerWidth - gutter - width)))}px`;
}

const placeSearchMenu = () => placeMenu($('#search-menu'), $('#search-trigger'), SEARCH_MENU_WIDTH);
const placeSettingsMenu = () => placeMenu($('#settings-menu'), $('#settings-trigger'), SETTINGS_MENU_WIDTH);

const closeSearchMenu = () => $('#search-menu').hidePopover();

function applyStyle(style) {
  const root = document.documentElement;
  if (style === 'modern') delete root.dataset.style;
  else root.dataset.style = style;
  for (const input of document.querySelectorAll('input[name="style"]')) input.checked = input.value === style;
  if ($('#settings-menu').matches(':popover-open')) placeSettingsMenu();
  try {
    localStorage.setItem(STYLE_KEY, style);
  } catch {}
}

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
  for (const btn of document.querySelectorAll('[data-theme-option]')) btn.setAttribute('aria-pressed', String(btn.dataset.themeOption === theme));
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {}
}

const withTransition = (fn) => (reduceMotion() || !document.startViewTransition ? fn() : document.startViewTransition(fn));

function switchStyle(style) {
  $('#settings-menu').hidePopover();
  if (style === (document.documentElement.dataset.style ?? 'modern')) return;
  withTransition(() => applyStyle(style));
  api('setSetting', { key: 'style', value: style }).catch(() => {});
}

function renderPrefs() {
  const { districts, sources, types, categories, states } = state.config;
  const prefs = currentPrefs();
  const search = activeSearch();
  const form = $('#prefs');
  $('#prefs-title').textContent = search ? t('editSearch') : t('newSearchTitle');
  $('#drawer-title').textContent = $('#prefs-title').textContent;
  $('#save-search').innerHTML = `${icon(search ? 'save' : 'radar')}<span>${esc(search ? t('saveSearch') : t('createSearch'))}</span>`;
  form.elements.namedItem('name').value = search?.name ?? '';
  form.elements.namedItem('name').placeholder = suggestName(prefs);
  for (const key of RANGE_FIELDS) form[key].value = prefs[key] || '';

  $('#states').innerHTML = states.map((s) => `
    <label class="check">
      <input type="checkbox" name="state" value="${s.id}" ${prefs.states.includes(s.id) ? 'checked' : ''}>
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
      <input type="checkbox" name="district" value="${d.number}" ${prefs.districts.includes(d.number) ? 'checked' : ''}>
      <b>${d.number}</b><span>${esc(d.name)}</span>
    </label>`).join('');

  $('#sources').innerHTML = SOURCE_KINDS.map((kind) => {
    const group = sources.filter((s) => (s.kind ?? 'portal') === kind);
    if (!group.length) return '';
    return `<div class="source-group" role="group" aria-label="${esc(t(`sourceKind.${kind}`))}">
      <span class="source-group-title">${esc(t(`sourceKind.${kind}`))}</span>
      ${group.map((s) => `
      <label class="check">
        <span class="dot ${s.id}"></span><span>${esc(s.label)}</span>
        <span class="count" data-count="${s.id}"></span>
        <input type="checkbox" class="switch" role="switch" name="source" value="${s.id}" ${prefs.sources.includes(s.id) ? 'checked' : ''}>
      </label>`).join('')}
    </div>`;
  }).join('');

  updateFormState();
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

  const runs = Object.entries((search && state.data?.searchId === search.id ? state.data.runs : null) ?? {});
  const total = runs.reduce((n, [, r]) => n + (r.ok ? r.count : 0), 0);
  const failed = runs.some(([, r]) => !r.ok);
  const html = runs.length ? `
    <div class="status-wrap">
      <button type="button" class="status-summary${failed ? ' err' : ''}" aria-describedby="status-detail">
        <span class="status-dots">${runs.map(([id]) => `<span class="dot ${id}"></span>`).join('')}</span>
        <span>${esc(t('statusTotal', { n: num(total) }))}</span>
        ${failed ? icon('circle-alert') : ''}
        ${search.lastScanAt ? `<span class="status-time">· ${esc(relTime(search.lastScanAt))}</span>` : ''}
      </button>
      <div class="status-detail" id="status-detail" role="tooltip">
        <ul>${runs.map(([id, r]) => `
          <li class="${r.ok ? '' : 'err'}">
            <span class="dot ${id}"></span>
            <span>${esc(SOURCE_LABELS[id])}</span>
            <span class="status-count">${r.ok ? esc(num(r.count)) : esc(t('error'))}</span>
            ${r.ok ? '' : `<span class="status-error">${esc(r.error)}</span>`}
          </li>`).join('')}
        </ul>
        ${search.lastScanAt ? `<p>${esc(t('updated', { time: fmtDate(search.lastScanAt) }))}</p>` : ''}
      </div>
    </div>` : '';
  if (html !== state.statusHtml) {
    state.statusHtml = html;
    $('#status').innerHTML = html;
  }
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
  if (!progress.finishedAt && progress.searchId === state.activeId && radarSearch()) ts.radarRuns.add(runId);
  if (ts.radarRuns.has(runId)) return;
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
        <button type="button" class="toast-close">${icon('x')}</button>`;
      $('.toast-close', el).addEventListener('click', () => dismissToast(key));
      box.append(el);
    }
    if (el.dataset.state !== entry.state) {
      el.dataset.state = entry.state;
      $('.toast-icon', el).innerHTML = icon(STATE_ICONS[entry.state] ?? 'loader-circle');
    }
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
    'new': (a, b) => (b.listedAt ?? '').localeCompare(a.listedAt ?? '') || (b.firstSeen ?? '').localeCompare(a.firstSeen ?? ''),
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
  for (const s of g.sources) {
    const key = `${s.source}|${s.sourceName ?? ''}`;
    byPortal.set(key, [...(byPortal.get(key) ?? []), s]);
  }
  return [...byPortal.values()].map((items) => {
    const primary = items[0];
    const source = primary.source;
    const url = primary.sourceUrl || primary.url;
    const label = sourceLabel(primary);
    const title = t('openOn', { source: label });

    return `
      <a class="src ${source}" href="${esc(url)}" target="_blank" rel="noopener noreferrer" title="${esc(title)}">
        ${esc(label)}${items.length > 1 ? `<span class="src-count">×${items.length}</span>` : ''}${icon('arrow-up-right', 'ext')}
      </a>`;
  }).join('');
}

function cardHtml(g) {
  const img = g.images[0];
  const fav = isFav(g);
  const dropped = isDrop(g);
  const area = g.area ? `${num(g.area, 1)} m²` : '';
  const sqm = g.pricePerSqm ? `${euro(g.pricePerSqm, 2)}/m²` : '';
  const facts = [
    g.type === 'house' && ['', t('type.house')],
    area && ['fact-area', area],
    g.rooms && ['', `${num(g.rooms, 1)} ${t('roomsShort')}`],
    placeLabel(g) && ['', placeLabel(g)],
    sqm && ['fact-sqm', sqm],
  ].filter(Boolean);
  return `
    <article class="card" data-id="${esc(g.id)}">
      <a class="card-link" href="#/l/${encodeURIComponent(g.id)}" aria-label="${esc(g.title)}"></a>
      <div class="thumb">
        ${img ? `<img src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<div class="noimg">${esc(t('noImage'))}</div>`}
        <div class="badges">
          ${g.isNew ? `<span class="badge new">${icon('sparkles')}${esc(t('badgeNew'))}</span>` : ''}
          ${dropped ? `<span class="badge drop">${icon('trending-down')}${esc(t('badgeDrop', { pct: num(Math.abs(g.priceChange.pct), 1) }))}</span>` : ''}
          ${g.categories.filter((c) => c !== 'regular').map((c) => `<span class="badge cat cat-${c}">${esc(t(`catShort.${c}`))}</span>`).join('')}
          ${g.sources.length > 1 ? `<span class="badge multi">${esc(t('listedTimes', { n: g.sources.length }))}</span>` : ''}
        </div>
        ${g.images.length > 1 ? `
          <button class="thumb-nav prev" type="button" data-action="img-prev" aria-label="${esc(t('prevPhoto'))}">${icon('chevron-left')}</button>
          <button class="thumb-nav next" type="button" data-action="img-next" aria-label="${esc(t('nextPhoto'))}">${icon('chevron-right')}</button>` : ''}
        ${g.images.length ? `<span class="badge photos">${icon('images')}<span data-photo-counter>1 / ${g.images.length}</span></span>` : ''}
      </div>
      <div class="card-actions">
        ${g.images.length ? `<button class="icon-btn" type="button" data-action="fullscreen" title="${esc(t('fullscreen'))}" aria-label="${esc(t('fullscreen'))}">${icon('maximize-2')}</button>` : ''}
        <button class="icon-btn fav" type="button" data-action="fav" aria-pressed="${fav}" title="${esc(t('favorite'))}" aria-label="${esc(t('favorite'))}">${icon('star')}</button>
      </div>
      <div class="card-body">
        <div class="price-row">
          <span class="price">${euro(g.price)}</span>
          ${dropped ? `<s class="was" title="${esc(t('priceWas', { date: fmtDay(g.priceChange.at) }))}">${euro(g.priceChange.previous)}</s>` : ''}
          ${sqm ? `<span class="sqm">${sqm}</span>` : ''}
          ${area ? `<span class="price-area">${area}</span>` : ''}
        </div>
        <div class="facts">${facts.map(([cls, text]) => `<span${cls ? ` class="${cls}"` : ''}>${esc(text)}</span>`).join('')}</div>
        <p class="title">${esc(g.title)}</p>
        <div class="address">${esc(g.address ?? '')}</div>
        <div class="sources">${sourceChips(g)}</div>
      </div>
    </article>`;
}

function emptyState() {
  const search = activeSearch();
  if (!search) return state.searches.length ? ['search', t('emptyPick')] : ['bookmark-plus', t('emptyStart')];
  const busy = isScanning(search.id) || isQueued(search.id);
  if (!search.lastScanAt) return ['radar', busy ? t('emptyRunning') : t('emptyNoData')];
  return busy ? ['radar', t('emptyRunning')] : ['search-x', t('emptyFilters')];
}

function renderEmpty(el) {
  const [name, text] = emptyState();
  const key = `${name}|${text}`;
  if (el.dataset.key === key) return;
  el.dataset.key = key;
  el.innerHTML = `${icon(name, 'empty-icon')}<p>${esc(text)}</p>`;
}

const cardMarkup = new WeakMap();

function cardNode(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  const el = tpl.content.firstElementChild;
  cardMarkup.set(el, html);
  return el;
}

function visibleRects(grid) {
  const rects = new Map();
  for (const el of grid.children) {
    if (inViewport(el)) rects.set(el.dataset.id, el.getBoundingClientRect());
  }
  return rects;
}

function flipCards(grid, before) {
  for (const el of grid.children) {
    if (el.classList.contains('entering')) continue;
    const prev = before.get(el.dataset.id);
    if (!prev) {
      if (inViewport(el)) el.animate([{ opacity: 0, transform: 'scale(.97)' }, {}], { duration: 260, easing: EASE_OUT });
      continue;
    }
    const r = el.getBoundingClientRect();
    const dx = prev.left - r.left;
    const dy = prev.top - r.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
    el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 420, easing: EASE_OUT });
  }
}

function patchGrid(groups, { flip = false } = {}) {
  const grid = $('#grid');
  const before = flip && !reduceMotion() && grid.children.length ? visibleRects(grid) : null;
  const existing = new Map([...grid.children].map((el) => [el.dataset.id, el]));
  let entering = 0;
  const nodes = groups.map((g) => {
    const html = cardHtml(g);
    const old = existing.get(g.id);
    if (old && cardMarkup.get(old) === html) return old;
    const el = cardNode(html);
    if (!old && !reduceMotion()) {
      el.classList.add('entering');
      el.style.setProperty('--i', Math.min(entering++, MAX_STAGGER));
    }
    return el;
  });
  const unchanged = nodes.length === grid.children.length && nodes.every((n, i) => grid.children[i] === n);
  if (!unchanged) grid.replaceChildren(...nodes);
  if (before) flipCards(grid, before);
}

function radarSearch() {
  const search = activeSearch();
  if (!search || !(isScanning(search.id) || isQueued(search.id))) return null;
  if (!search.lastScanAt) return search;
  if (state.data?.searchId !== search.id) return null;
  return state.data.groups.length ? null : search;
}

function radarSources(search) {
  const progress = state.status?.progress;
  if (isScanning(search.id) && progress?.searchId === search.id && !progress.finishedAt) return progress.sources;
  const ids = search.prefs.sources;
  return Object.fromEntries(ids.map((id) => [id, { state: 'waiting', count: 0 }]));
}

function seeded(text) {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

function clock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function radarCountText(entry) {
  if (entry.state === 'waiting') return t('radar.waiting');
  if (entry.state === 'error') return t('radar.error');
  if (entry.state === 'done') return t('radar.done', { n: num(entry.count), s: num((entry.ms ?? 0) / 1000, 1) });
  return entry.count ? t('radar.found', { n: num(entry.count) }) : t('radar.searching');
}

function addBlips(box, sources) {
  const layer = $('.radar-blips', box);
  const sweep = $('.radar-sweep', box).getAnimations()[0];
  const phase = Number(sweep?.currentTime ?? 0) % RADAR_SWEEP_MS;
  for (const [key, entry] of Object.entries(sources)) {
    const wanted = Math.min(MAX_BLIPS_PER_SOURCE, Math.ceil((entry.count ?? 0) / LISTINGS_PER_BLIP));
    for (let i = layer.querySelectorAll(`.${key}`).length; i < wanted; i++) {
      const rand = seeded(`${key}-${i}`);
      const angle = rand() * 360;
      const radius = 14 + rand() * 32;
      const rad = (angle * Math.PI) / 180;
      const blip = document.createElement('span');
      blip.className = `radar-blip ${key}`;
      blip.style.left = `${50 + radius * Math.sin(rad)}%`;
      blip.style.top = `${50 - radius * Math.cos(rad)}%`;
      const delay = (((angle / 360) * RADAR_SWEEP_MS - phase) % RADAR_SWEEP_MS + RADAR_SWEEP_MS) % RADAR_SWEEP_MS - RADAR_SWEEP_MS;
      blip.style.animationDelay = `0ms, ${Math.round(delay)}ms`;
      layer.append(blip);
    }
  }
}

function renderRadar(search) {
  const box = $('#radar');
  if (box.dataset.search !== String(search.id)) {
    box.dataset.search = search.id;
    box.innerHTML = `
      <div class="radar-scope" aria-hidden="true">
        <div class="radar-grid"></div>
        <div class="radar-sweep"></div>
        <div class="radar-blips"></div>
        <div class="radar-core">${icon('house')}</div>
      </div>
      <div class="radar-info">
        <h2 class="radar-title"></h2>
        <p class="radar-sub"></p>
        <ul class="radar-sources"></ul>
        <p class="radar-hint"></p>
      </div>`;
  }
  const scanning = isScanning(search.id);
  const progress = state.status?.progress;
  const sources = radarSources(search);
  box.classList.toggle('queued', !scanning);
  $('.radar-title', box).textContent = t('radar.title', { name: search.name });
  $('.radar-sub', box).textContent = scanning && progress?.searchId === search.id
    ? t('radar.elapsed', { time: clock(Date.now() - Date.parse(progress.startedAt)) })
    : t('radar.queued');
  $('.radar-hint', box).textContent = t('radar.hint');
  const list = $('.radar-sources', box);
  for (const [key, entry] of Object.entries(sources)) {
    let row = list.querySelector(`[data-source="${key}"]`);
    if (!row) {
      row = document.createElement('li');
      row.dataset.source = key;
      row.innerHTML = `
        <span class="radar-state"></span>
        <span class="dot ${key}"></span>
        <strong>${esc(SOURCE_LABELS[key])}</strong>
        <span class="radar-count"></span>
        <span class="radar-bar"><i></i></span>`;
      list.append(row);
    }
    if (row.dataset.state !== entry.state) {
      row.dataset.state = entry.state;
      $('.radar-state', row).innerHTML = icon(STATE_ICONS[entry.state] ?? 'loader-circle');
    }
    $('.radar-count', row).textContent = radarCountText(entry);
    row.title = entry.error ?? '';
  }
  addBlips(box, sources);
  state.radarTimer ??= setInterval(() => {
    const current = radarSearch();
    if (current && !detailId()) renderRadar(current);
  }, RADAR_TICK_MS);
}

function stopRadar() {
  clearInterval(state.radarTimer);
  state.radarTimer = null;
  const box = $('#radar');
  box.hidden = true;
  box.dataset.search = '';
  box.innerHTML = '';
}

function renderList({ flip = false } = {}) {
  const search = activeSearch();
  const groups = search ? filteredGroups() : [];
  const d = state.data;
  const radar = radarSearch();
  patchGrid(groups, { flip });
  if (radar) {
    $('#radar').hidden = false;
    renderRadar(radar);
  } else if (state.radarTimer || !$('#radar').hidden) {
    stopRadar();
  }
  $('#list-view').classList.toggle('no-results', Boolean(radar) || !(search && d?.searchId === search.id && d.groups.length));
  const empty = $('#empty');
  empty.hidden = groups.length > 0 || Boolean(radar);
  if (!empty.hidden) renderEmpty(empty);
  $('#result-count').textContent = search?.lastScanAt && d ? t('resultCount', { shown: groups.length, total: d.stats.groups, listings: d.stats.listings, merged: d.stats.merged }) : '';
  for (const btn of document.querySelectorAll('[data-toggle]')) btn.setAttribute('aria-pressed', String(state.view[btn.dataset.toggle]));
}

const favoritesRoute = () => location.hash === '#/favorites';

function favSectionHtml(search, groups, fresh) {
  const busy = isScanning(search.id) || isQueued(search.id);
  const meta = isScanning(search.id) ? t('scanRunning') : isQueued(search.id) ? t('scanQueued') : search.lastScanAt ? t('updated', { time: relTime(search.lastScanAt) }) : t('neverScanned');
  return `
    <section class="fav-section${fresh ? ' entering' : ''}" data-search-id="${search.id}">
      <header class="fav-section-head">
        <div class="fav-section-title">
          <h2>${esc(search.name)}</h2>
          <span class="fav-section-meta">${esc(meta)}</span>
        </div>
        <div class="fav-section-actions">
          <button type="button" class="btn" data-fav-open="${search.id}"><span>${esc(t('favOpen'))}</span>${icon('arrow-right')}</button>
          <button type="button" class="btn btn-icon" data-fav-rescan="${search.id}" title="${esc(t('rescanSearch'))}" aria-label="${esc(t('rescanSearch'))}" ${busy ? 'disabled' : ''}>${icon('refresh-cw', isScanning(search.id) ? 'spin' : '')}</button>
          <button type="button" class="btn btn-icon btn-icon-danger" data-fav-delete="${search.id}" title="${esc(t('deleteSearch'))}" aria-label="${esc(t('deleteSearch'))}">${icon('trash-2')}</button>
        </div>
      </header>
      ${groups.length
        ? `<div class="grid">${groups.map(cardHtml).join('')}</div>`
        : `<p class="fav-empty">${icon('star')}<span>${esc(t('favNone'))}</span></p>`}
    </section>`;
}

function favStatsHtml(groups) {
  const values = (key) => groups.map((g) => g[key]).filter((v) => v != null);
  const average = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);
  const prices = values('price');
  const avgSqm = average(values('pricePerSqm'));
  const avgArea = average(values('area'));
  const rows = [
    ['favorites', num(groups.length)],
    ['favAvgRent', euro(average(prices))],
    ['favAvgSqm', avgSqm == null ? '–' : `${euro(avgSqm, 2)}/m²`],
    ['favAvgArea', avgArea == null ? '–' : `${num(avgArea, 1)} m²`],
    ['favRange', prices.length ? `${euro(Math.min(...prices))} – ${euro(Math.max(...prices))}` : '–'],
  ];
  return `<dl class="fav-stats">${rows.map(([k, v]) => `<div><dt>${esc(t(k))}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
}

function favSelectedSearch() {
  const pick = [state.favSelected, state.activeId].find((id) => state.searches.some((s) => s.id === id));
  return state.searches.find((s) => s.id === pick) ?? state.searches[0];
}

function renderFavorites({ fresh = false } = {}) {
  const el = $('#favorites-view');
  if (!state.favData) {
    el.innerHTML = `<div class="empty">${icon('loader-circle', 'empty-icon spin')}<p>${esc(t('loading'))}</p></div>`;
    return;
  }
  if (!state.searches.length) {
    el.innerHTML = `<div class="empty">${icon('bookmark-plus', 'empty-icon')}<p>${esc(t('favNoSearches'))}</p></div>`;
    return;
  }
  const favsOf = (id) => (state.favData.get(id) ?? []).filter(isFav);
  const selected = favSelectedSearch();
  state.favSelected = selected.id;
  const groups = favsOf(selected.id);
  el.innerHTML = `
    <div class="favorites">
      <aside class="fav-index">
        <h1>${icon('star')}<span>${esc(t('favorites'))}</span></h1>
        <ul class="fav-searches">${state.searches.map((s) => {
          const n = favsOf(s.id).length;
          return `
          <li><button type="button" data-fav-select="${s.id}" aria-current="${s.id === selected.id}" class="${n ? '' : 'is-empty'}">
            <span>${esc(s.name)}</span><b>${esc(num(n))}</b>
          </button></li>`;
        }).join('')}
        </ul>
        ${favStatsHtml(groups)}
      </aside>
      <div class="fav-content">${favSectionHtml(selected, groups, fresh && !reduceMotion())}</div>
    </div>`;
}

async function loadFavorites() {
  const token = ++state.favToken;
  const entries = await Promise.all(state.searches.map(async (s) => [s.id, (await api('listings', { id: s.id })).groups]));
  if (token !== state.favToken) return;
  state.favData = new Map(entries);
  if (favoritesRoute()) renderFavorites();
  else if (detailId() && $('#detail-view .empty')) route();
}

function renderDetail(id) {
  const g = findGroup(id);
  const el = $('#detail-view');
  if (!g) {
    const pending = !state.data || !state.favData;
    el.innerHTML = `<div class="detail"><div class="empty">${esc(pending ? t('loading') : t('notAvailable'))}</div></div>`;
    if (!state.favData) loadFavorites();
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
                const label = sourceLabel(s);
                const actionLabel = t('openListing');

                return `
                  <a class="origin ${s.source}" href="${esc(url)}" target="_blank" rel="noopener noreferrer">
                    <strong>${esc(label)}</strong>
                    <span class="o-price">${euro(s.price, 2)}</span>
                    <span class="o-title">${esc(s.title)}</span>
                    <span class="o-open">${esc(actionLabel)}${icon('external-link')}</span>
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
            <a class="btn btn-block" href="${esc(mapsUrl)}" target="_blank" rel="noopener noreferrer">${icon('map')}<span>${esc(t('openMaps'))}</span>${icon('external-link', 'ext')}</a>
            ${osm ? `<p class="note">${esc(t('approxPosition'))}</p>` : ''}
          </div>
        </aside>
      </div>
    </div>`;

  const favBtn = $('[data-action="fav-detail"]', el);
  const syncFav = () => {
    const fav = isFav(g);
    favBtn.setAttribute('aria-pressed', String(fav));
    favBtn.innerHTML = `${icon('star', 'star')}<span class="fav-label">${esc(t(fav ? 'favRemove' : 'favAdd'))}</span>`;
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
          <button class="gallery-nav prev" type="button" aria-label="${esc(t('prevImage'))}">${icon('chevron-left')}</button>
          <button class="gallery-nav next" type="button" aria-label="${esc(t('nextImage'))}">${icon('chevron-right')}</button>
          <span class="badge photos gallery-count">1 / ${g.images.length}</span>` : ''}
      </div>
      ${g.images.length > 1 ? `<div class="thumbs">${g.images.map((src, i) => `
        <button type="button" data-index="${i}" aria-current="${i === 0}" aria-label="${esc(t('image', { n: i + 1 }))}">
          <img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer">
        </button>`).join('')}</div>` : ''}
    </div>`;
}

function bindSwipeBack(frame) {
  const page = frame.closest('.detail');
  let start = null;
  let active = false;
  let shift = 0;
  frame.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    start = e.touches.length === 1 && window.scrollY <= 0 ? { x: t.clientX, y: t.clientY } : null;
    active = false;
    shift = 0;
  }, { passive: true });
  frame.addEventListener('touchmove', (e) => {
    if (!start) return;
    const t = e.touches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (!active) {
      if (Math.abs(dx) < SWIPE_SLOP && Math.abs(dy) < SWIPE_SLOP) return;
      if (dy <= 0 || Math.abs(dx) > dy || !e.cancelable) {
        start = null;
        return;
      }
      active = true;
      frame.classList.add('dragging');
      page.classList.add('swiping');
    }
    e.preventDefault();
    shift = Math.max(0, dy);
    const scale = 1 - Math.min(shift, SWIPE_BACK_MAX) / SWIPE_BACK_MAX * SWIPE_BACK_SHRINK;
    frame.style.transform = `translateY(${Math.round(shift * SWIPE_BACK_FOLLOW)}px) scale(${scale.toFixed(3)})`;
    page.style.setProperty('--swipe', Math.min(1, shift / SWIPE_BACK_FADE).toFixed(3));
  }, { passive: false });
  const end = () => {
    if (!start) return;
    start = null;
    if (!active) return;
    active = false;
    if (shift >= SWIPE_BACK_TRIGGER) {
      goBack();
      return;
    }
    frame.classList.remove('dragging');
    page.classList.remove('swiping');
    frame.style.transform = '';
    page.style.removeProperty('--swipe');
  };
  frame.addEventListener('touchend', end);
  frame.addEventListener('touchcancel', end);
}

function preloadImage(url) {
  const pre = new Image();
  pre.referrerPolicy = 'no-referrer';
  pre.src = url;
  return pre;
}

async function swapImage(img, url, frames, options) {
  img.dataset.pending = url;
  await preloadImage(url).decode().catch(() => {});
  if (img.dataset.pending !== url) return;
  delete img.dataset.pending;
  img.src = url;
  if (frames && !reduceMotion()) img.animate(frames, options);
}

function bindGallery(el, g) {
  const main = $('.gallery-main img', el);
  if (!main) return;
  bindSwipeBack($('.gallery-main', el));
  main.addEventListener('click', () => openLightbox(g.images, Number(main.dataset.index ?? 0), main));
  if (g.images.length < 2) return;
  const show = (i) => {
    const idx = (i + g.images.length) % g.images.length;
    const dir = Math.sign(i - Number(main.dataset.index));
    swapImage(main, g.images[idx], dir && [{ opacity: 0.2, transform: `translateX(${dir * 24}px)` }, {}], { duration: 260, easing: EASE_OUT });
    preloadImage(g.images[(idx + (dir || 1) + g.images.length) % g.images.length]);
    main.dataset.index = idx;
    $('.gallery-count', el).textContent = `${idx + 1} / ${g.images.length}`;
    el.querySelectorAll('.thumbs button').forEach((b, j) => b.setAttribute('aria-current', String(j === idx)));
    el.querySelectorAll('.thumbs button')[idx]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  $('.prev', el).addEventListener('click', () => show(Number(main.dataset.index) - 1));
  $('.next', el).addEventListener('click', () => show(Number(main.dataset.index) + 1));
  el.querySelectorAll('.thumbs button').forEach((b) => b.addEventListener('click', () => show(Number(b.dataset.index))));
}

function fittedRect(img) {
  const r = img.getBoundingClientRect();
  const fit = getComputedStyle(img).objectFit;
  const { naturalWidth: w, naturalHeight: h } = img;
  if (fit !== 'contain' || !w || !h) return { rect: r, cover: fit === 'cover' };
  const k = Math.min(r.width / w, r.height / h);
  const width = w * k;
  const height = h * k;
  return { rect: { left: r.left + (r.width - width) / 2, top: r.top + (r.height - height) / 2, width, height }, cover: false };
}

function zoomFrames(target, source) {
  const d = target.getBoundingClientRect();
  const { rect: s, cover } = fittedRect(source);
  if (!d.width || !s.width) return null;
  const k = cover ? Math.max(s.width / d.width, s.height / d.height) : s.width / d.width;
  const dx = s.left + s.width / 2 - (d.left + d.width / 2);
  const dy = s.top + s.height / 2 - (d.top + d.height / 2);
  const ix = Math.max(0, (d.width * k - s.width) / 2 / k);
  const iy = Math.max(0, (d.height * k - s.height) / 2 / k);
  return [
    { transform: `translate(${dx}px, ${dy}px) scale(${k})`, clipPath: `inset(${iy}px ${ix}px)` },
    { transform: 'none', clipPath: 'inset(0px 0px)' },
  ];
}

const lightboxChrome = (box) => box.querySelectorAll('.lb-close, .lb-nav, .lb-count');

async function openLightbox(images, index = 0, source = null) {
  if (!images?.length) return;
  const box = $('#lightbox');
  const img = $('img', box);
  box.getAnimations({ subtree: true }).forEach((a) => a.cancel());
  const pushed = !state.lightbox?.pushed && history.state?.lightbox !== true;
  if (pushed) history.pushState({ lightbox: true }, '');
  state.lightbox = { images, index, source, startIndex: index, pushed: pushed || Boolean(state.lightbox?.pushed) };
  box.hidden = false;
  document.body.classList.add('lightbox-open');
  showLightboxImage(index);
  if (reduceMotion()) return;
  const opened = state.lightbox;
  box.animate([{ backgroundColor: 'rgba(0, 0, 0, 0)' }, {}], { duration: 320, easing: 'ease-out' });
  for (const el of lightboxChrome(box)) el.animate([{ opacity: 0 }, {}], { duration: 220, delay: 160, fill: 'backwards' });
  img.style.visibility = 'hidden';
  await img.decode().catch(() => {});
  img.style.visibility = '';
  if (state.lightbox !== opened || opened.closing || opened.index !== index) return;
  const frames = source?.isConnected && zoomFrames(img, source);
  if (frames) img.animate(frames, { duration: 420, easing: EASE_OUT });
  else img.animate([{ opacity: 0, transform: 'scale(.92)' }, {}], { duration: 260, easing: EASE_OUT });
}

function showLightboxImage(index, dir = 0) {
  const { images } = state.lightbox;
  const i = (index + images.length) % images.length;
  state.lightbox.index = i;
  const box = $('#lightbox');
  const img = $('img', box);
  img.style.visibility = '';
  if (dir) {
    swapImage(img, images[i], [{ opacity: 0, transform: `translateX(${dir * 60}px) scale(.98)` }, {}], { duration: 300, easing: EASE_OUT });
  } else {
    delete img.dataset.pending;
    img.src = images[i];
  }
  $('.lb-count', box).textContent = `${i + 1} / ${images.length}`;
  box.classList.toggle('single', images.length < 2);
  for (const n of [i + 1, i - 1]) preloadImage(images[(n + images.length) % images.length]);
}

const stepLightbox = (step) => showLightboxImage(state.lightbox.index + step, step);

function closeLightbox({ fromHistory = false } = {}) {
  const lb = state.lightbox;
  if (!lb || lb.closing) return;
  if (lb.pushed) {
    lb.pushed = false;
    if (!fromHistory && history.state?.lightbox) history.back();
  }
  const box = $('#lightbox');
  const img = $('img', box);
  const finish = () => {
    box.getAnimations({ subtree: true }).forEach((a) => a.cancel());
    if (state.lightbox === lb) state.lightbox = null;
    box.hidden = true;
    document.body.classList.remove('lightbox-open');
  };
  if (reduceMotion()) {
    finish();
    return;
  }
  lb.closing = true;
  const source = lb.index === lb.startIndex && lb.source?.isConnected && inViewport(lb.source) ? lb.source : null;
  img.getAnimations().forEach((a) => a.cancel());
  const frames = source && zoomFrames(img, source);
  const duration = frames ? 340 : 200;
  const anim = frames
    ? img.animate([...frames].reverse(), { duration, easing: 'cubic-bezier(.4, 0, .2, 1)', fill: 'forwards' })
    : img.animate([{}, { opacity: 0, transform: 'scale(.94)' }], { duration, easing: 'ease-in', fill: 'forwards' });
  box.animate([{}, { backgroundColor: 'rgba(0, 0, 0, 0)' }], { duration, easing: 'ease-in', fill: 'forwards' });
  for (const el of lightboxChrome(box)) el.animate([{}, { opacity: 0 }], { duration: 150, fill: 'forwards' });
  anim.finished.then(finish, finish);
}

function bindLightbox() {
  const box = $('#lightbox');
  box.addEventListener('click', (e) => {
    if (state.lightbox?.closing) return;
    const action = e.target.closest('[data-lb]')?.dataset.lb;
    if (action === 'close') closeLightbox();
    else if (action === 'prev') stepLightbox(-1);
    else if (action === 'next') stepLightbox(1);
    else if (e.target === box) closeLightbox();
  });
  let startX = null;
  box.addEventListener('pointerdown', (e) => { startX = e.clientX; });
  box.addEventListener('pointerup', (e) => {
    if (startX == null || !state.lightbox || state.lightbox.closing) return;
    const dx = e.clientX - startX;
    startX = null;
    if (Math.abs(dx) > 50) stepLightbox(dx < 0 ? 1 : -1);
  });
}

const detailId = () => /^#\/l\/(.+)$/.exec(location.hash)?.[1];

function syncBottomNav() {
  const drawer = $('#sidebar').classList.contains('open');
  const r = state.route === 'detail' ? state.returnRoute ?? 'list' : state.route;
  const active = drawer ? 'filters' : r === 'favorites' ? 'favorites' : 'listings';
  for (const item of document.querySelectorAll('[data-bottom]')) item.setAttribute('aria-current', String(item.dataset.bottom === active));
}

function setDrawer(open) {
  $('#sidebar').classList.toggle('open', open);
  document.body.classList.toggle('drawer-open', open);
  syncBottomNav();
}

const currentRoute = () => (detailId() ? 'detail' : favoritesRoute() ? 'favorites' : 'list');

function route() {
  const id = detailId();
  const next = currentRoute();
  const prev = state.route;
  if (next === 'detail' && prev && prev !== 'detail') {
    state.returnRoute = prev;
    state.returnScroll = window.scrollY;
    state.openedFromList = true;
  }
  document.body.classList.toggle('detail-mode', next === 'detail');
  document.body.classList.toggle('favorites-mode', next === 'favorites');
  $('#list-view').hidden = next !== 'list';
  $('#favorites-view').hidden = next !== 'favorites';
  $('#detail-view').hidden = next !== 'detail';
  $('#favorites-link').setAttribute('aria-current', next === 'favorites' ? 'page' : 'false');
  state.detailShown = id ? decodeURIComponent(id) : null;
  if (next === 'detail') {
    renderDetail(decodeURIComponent(id));
    window.scrollTo(0, 0);
  } else {
    if (next === 'list') renderList();
    else {
      if (prev !== 'detail') state.favSelected = null;
      renderFavorites({ fresh: prev !== 'detail' });
      if (prev !== 'detail' || !state.favData) loadFavorites();
    }
    const returning = prev === 'detail' && state.returnRoute === next;
    window.scrollTo(0, returning ? state.returnScroll ?? 0 : prev === next ? window.scrollY : 0);
    state.openedFromList = false;
  }
  state.route = next;
  if (next !== 'list') setDrawer(false);
  else syncBottomNav();
}

const HERO = 'listing-hero';

function cardThumb(id) {
  return visibleCard(id)?.querySelector('.thumb') ?? null;
}

function setHero(el) {
  document.querySelectorAll('.vt-hero').forEach((x) => {
    x.style.viewTransitionName = '';
    x.classList.remove('vt-hero');
  });
  if (!el) return;
  el.classList.add('vt-hero');
  el.style.viewTransitionName = HERO;
}

function navigate() {
  const id = detailId();
  const opening = Boolean(id) && state.route !== 'detail';
  const closing = !id && state.route === 'detail';
  if (reduceMotion() || !document.startViewTransition || state.lightbox) {
    route();
    return;
  }
  if (!opening && !closing) {
    if (currentRoute() === state.route) route();
    else document.startViewTransition(route);
    return;
  }
  const leaving = state.detailShown;
  setHero(opening ? cardThumb(decodeURIComponent(id)) : $('#detail-view .gallery-main'));
  document.documentElement.dataset.nav = opening ? 'forward' : 'back';
  const transition = document.startViewTransition(() => {
    route();
    setHero(opening ? $('#detail-view .gallery-main') : cardThumb(leaving));
  });
  transition.finished.finally(() => {
    setHero(null);
    delete document.documentElement.dataset.nav;
  });
}

function goBack() {
  if (state.openedFromList) history.back();
  else location.hash = '#/';
}

function renderAll() {
  applyStatic();
  for (const btn of document.querySelectorAll('[data-lang]')) btn.setAttribute('aria-pressed', String(btn.dataset.lang === getLang()));
  renderSearchList();
  renderPrefs();
  renderStatus();
  renderToasts();
  const id = detailId();
  if (id) renderDetail(decodeURIComponent(id));
  else if (favoritesRoute()) renderFavorites();
  else renderList();
}

let listingsLoad = null;
let listingsReloadPending = false;

async function loadListings() {
  if (listingsLoad) {
    listingsReloadPending = true;
    return listingsLoad;
  }
  listingsLoad = (async () => {
    try {
      do {
        listingsReloadPending = false;
        await fetchListings();
      } while (listingsReloadPending);
    } finally {
      listingsLoad = null;
    }
  })();
  return listingsLoad;
}

async function fetchListings() {
  const id = state.activeId;
  const data = await api('listings', { id });
  if (id !== state.activeId) return;
  state.data = data;
  renderCategoryCounts();
  renderStatus();
  if (detailId()) {
    if ($('#detail-view .empty')) route();
  } else {
    renderList({ flip: true });
  }
}

async function refreshSearches() {
  state.searches = await api('searches');
  renderSearchList();
}

async function selectSearch(id) {
  state.activeId = id;
  state.data = null;
  state.toasts.radarRuns.clear();
  if (id == null) state.draft = { ...state.config.defaults };
  api('setSetting', { key: 'activeSearchId', value: id }).catch(() => {});
  if (detailId()) location.hash = '#/';
  renderSearchList();
  renderPrefs();
  renderStatus();
  renderList();
  await loadListings();
}

function sourceLanded(prev, next) {
  if (!next?.sources) return false;
  const same = prev?.searchId === next.searchId && prev?.startedAt === next.startedAt;
  return Object.entries(next.sources).some(([key, s]) => s.saved && !(same && prev.sources?.[key]?.saved));
}

async function onScanStatus(status) {
  const prev = state.status;
  state.status = status;
  const finished = status.progress?.finishedAt && status.progress.finishedAt !== prev?.progress?.finishedAt;
  const queueChanged = JSON.stringify([prev?.running, prev?.queue]) !== JSON.stringify([status.running, status.queue]);
  renderToasts();
  if (finished || queueChanged) await refreshSearches();
  renderStatus();
  const progressive = Boolean(activeSearch()?.lastScanAt) && sourceLanded(prev?.progress, status.progress);
  const reload = status.progress?.searchId === state.activeId && (finished || progressive);
  if (!detailId() && !reload) renderList();
  if (favoritesRoute()) {
    if (finished) loadFavorites();
    else if (queueChanged) renderFavorites();
  }
  if (reload) await loadListings();
}

function readPrefsForm(form) {
  const checked = (name) => [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((i) => i.value);
  return {
    ...Object.fromEntries(RANGE_FIELDS.map((k) => [k, form[k].value])),
    states: checked('state'),
    types: checked('type'),
    categories: checked('category'),
    districts: checked('district').map(Number),
    sources: checked('source'),
  };
}

function closeModal(dialog, value) {
  if (dialog.classList.contains('closing') || !dialog.open) return;
  if (reduceMotion()) {
    dialog.close(value);
    return;
  }
  dialog.classList.add('closing');
  const done = (e) => {
    if (e.target !== dialog) return;
    dialog.removeEventListener('animationend', done);
    dialog.classList.remove('closing');
    dialog.close(value);
  };
  dialog.addEventListener('animationend', done);
}

function bindModal(dialog) {
  dialog.addEventListener('click', (e) => {
    const value = e.target.closest('[data-modal]')?.dataset.modal;
    if (value) closeModal(dialog, value);
    else if (e.target === dialog) closeModal(dialog, 'cancel');
  });
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    closeModal(dialog, 'cancel');
  });
}

function askConfirm(dialog) {
  return new Promise((resolve) => {
    dialog.returnValue = '';
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true });
    dialog.showModal();
    $('[data-modal="cancel"]', dialog).focus();
  });
}

async function confirmDelete(id) {
  const search = state.searches.find((s) => s.id === id);
  if (!search) return;
  const dialog = $('#confirm-delete');
  const menu = $('#search-menu');
  const menuOpen = menu.matches(':popover-open');
  $('#confirm-delete-text').textContent = t('confirmDelete', { name: search.name });
  const confirmed = await askConfirm(dialog);
  if (menuOpen) menu.showPopover();
  if (!confirmed) return;
  const row = [$(`#search-list [data-delete="${id}"]`)?.closest('li'), $(`#favorites-view [data-search-id="${id}"]`)]
    .find((el) => el?.checkVisibility());
  const { searches } = await api('deleteSearch', { id });
  if (row && !reduceMotion()) {
    const height = row.offsetHeight;
    row.style.overflow = 'hidden';
    await row.animate([
      { opacity: 1, transform: 'none', height: `${height}px` },
      { opacity: 0, transform: 'translateX(-16px)', height: `${height}px`, offset: 0.6 },
      { opacity: 0, transform: 'translateX(-16px)', height: '0px' },
    ], { duration: 320, easing: 'ease-in' }).finished.catch(() => {});
  }
  state.searches = searches;
  state.knownSearches.delete(id);
  state.favData?.delete(id);
  if (id === state.activeId) await selectSearch(searches[0]?.id ?? null);
  else renderSearchList();
  if (favoritesRoute()) renderFavorites();
}

function flashHint(text) {
  $('#prefs-hint').textContent = text;
  setTimeout(() => { $('#prefs-hint').textContent = ''; }, 4000);
}

function bindPullToRefresh() {
  const indicator = $('#pull');
  const phone = matchMedia('(max-width: 600px)');
  let start = null;
  let distance = 0;
  let leaveTimer = 0;
  const busy = () => {
    const search = activeSearch();
    return !search || isScanning(search.id) || isQueued(search.id);
  };
  const canPull = () => phone.matches && currentRoute() === 'list' && !document.body.classList.contains('drawer-open')
    && !state.lightbox && window.scrollY <= 0 && !indicator.classList.contains('refreshing');
  const draw = () => {
    const shift = Math.min(distance, PULL_MAX);
    indicator.style.top = `${Math.round($('.topbar').getBoundingClientRect().bottom)}px`;
    indicator.style.setProperty('--pull', `${shift}px`);
    indicator.style.setProperty('--turn', `${Math.round((shift / PULL_TRIGGER) * 270)}deg`);
    indicator.style.setProperty('--show', Math.min(1, shift / PULL_FADE_IN).toFixed(2));
    indicator.classList.toggle('ready', distance >= PULL_TRIGGER && !busy());
  };
  const reset = () => {
    const spinning = indicator.classList.contains('refreshing');
    distance = 0;
    clearTimeout(leaveTimer);
    indicator.classList.toggle('leaving', spinning);
    indicator.classList.remove('pulling', 'refreshing', 'ready');
    draw();
    if (spinning) leaveTimer = setTimeout(() => indicator.classList.remove('leaving'), PULL_LEAVE_MS);
  };
  document.addEventListener('touchstart', (e) => {
    start = e.touches.length === 1 && canPull() ? e.touches[0].clientY : null;
    distance = 0;
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (start == null) return;
    const dy = e.touches[0].clientY - start;
    if (!indicator.classList.contains('pulling') && (dy <= 0 || window.scrollY > 0 || !e.cancelable)) {
      start = null;
      return;
    }
    if (e.cancelable) e.preventDefault();
    distance = Math.max(0, dy) * PULL_RESISTANCE;
    clearTimeout(leaveTimer);
    indicator.classList.remove('leaving');
    indicator.classList.add('pulling');
    draw();
  }, { passive: false });
  const end = async () => {
    if (start == null) return;
    start = null;
    indicator.classList.remove('pulling');
    if (distance < PULL_TRIGGER || busy()) {
      reset();
      return;
    }
    indicator.classList.add('refreshing');
    distance = PULL_TRIGGER * 0.8;
    draw();
    await api('scan', { id: state.activeId }).catch(() => {});
    setTimeout(reset, PULL_SETTLE_MS);
  };
  document.addEventListener('touchend', end);
  document.addEventListener('touchcancel', end);
}

function bindEvents() {
  $('#refresh').addEventListener('click', async () => {
    if (state.activeId == null) return;
    await api('scan', { id: state.activeId });
  });
  bindPullToRefresh();

  $('#search-menu').addEventListener('beforetoggle', (e) => {
    if (e.newState === 'open') placeSearchMenu();
  });
  $('#settings-menu').addEventListener('beforetoggle', (e) => {
    if (e.newState === 'open') placeSettingsMenu();
  });
  $('#settings-menu').addEventListener('click', (e) => {
    if (e.target.matches('input[name="style"]')) switchStyle(e.target.value);
  });
  $('#theme-switch').addEventListener('click', (e) => {
    const theme = e.target.closest('[data-theme-option]')?.dataset.themeOption;
    if (!theme || theme === (document.documentElement.dataset.theme ?? 'system')) return;
    withTransition(() => applyTheme(theme));
    api('setSetting', { key: 'theme', value: theme }).catch(() => {});
  });
  window.addEventListener('resize', () => {
    if ($('#search-menu').matches(':popover-open')) placeSearchMenu();
    if ($('#settings-menu').matches(':popover-open')) placeSettingsMenu();
  });

  $('#new-search').addEventListener('click', () => {
    closeSearchMenu();
    if (favoritesRoute()) location.hash = '#/';
    setDrawer(true);
    selectSearch(null);
    $('#search-name').focus();
  });

  $('#search-list').addEventListener('click', (e) => {
    const remove = Number(e.target.closest('[data-delete]')?.dataset.delete);
    if (remove) {
      confirmDelete(remove);
      return;
    }
    const rescan = e.target.closest('[data-rescan]');
    if (rescan) {
      rescan.disabled = true;
      api('scan', { id: Number(rescan.dataset.rescan) }).catch((err) => flashHint(`${t('error')}: ${err.message}`));
      return;
    }
    const id = Number(e.target.closest('[data-search]')?.dataset.search);
    if (!id) return;
    closeSearchMenu();
    setDrawer(false);
    if (favoritesRoute()) location.hash = '#/';
    if (id !== state.activeId) selectSearch(id);
    else if (detailId()) location.hash = '#/';
  });

  $('#prefs').addEventListener('change', updateFormState);

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
      if (res.scanning) state.status = await api('status');
      api('setSetting', { key: 'activeSearchId', value: res.search.id }).catch(() => {});
      renderSearchList();
      renderPrefs();
      renderStatus();
      flashHint(res.scanning ? t('savedRunning') : t('saved'));
      setDrawer(false);
      await loadListings();
    } catch (err) {
      flashHint(`${t('error')}: ${err.message}`);
    } finally {
      button.disabled = false;
      updateFormState();
    }
  });

  bindModal($('#confirm-delete'));

  for (const id of AUTOSAVED) $(`#${id}`).addEventListener('change', () => savePrefsPatch({ [id]: tickedValues(id) }));

  for (const id of BULK_TOGGLES) {
    $(`#${id}-all`).addEventListener('click', () => tickAll(id, true));
    $(`#${id}-none`).addEventListener('click', () => tickAll(id, false));
  }

  $('#filters-toggle').addEventListener('click', () => setDrawer(!$('#sidebar').classList.contains('open')));
  $('#drawer-close').addEventListener('click', () => setDrawer(false));
  $('#bottom-nav').addEventListener('click', (e) => {
    const item = e.target.closest('[data-bottom]');
    if (!item) return;
    if (item.dataset.bottom === 'filters') {
      if (currentRoute() !== 'list') location.hash = '#/';
      setDrawer(!$('#sidebar').classList.contains('open'));
      return;
    }
    setDrawer(false);
  });

  $('#q').value = state.view.q;
  $('#q').addEventListener('input', (e) => {
    state.view.q = e.target.value;
    saveView();
    renderList({ flip: true });
  });

  $('#sort').value = state.view.sort;
  $('#sort').addEventListener('change', (e) => {
    state.view.sort = e.target.value;
    saveView();
    renderList({ flip: true });
  });

  document.querySelectorAll('[data-toggle]').forEach((btn) => btn.addEventListener('click', () => {
    const key = btn.dataset.toggle;
    state.view[key] = !state.view[key];
    saveView();
    renderList({ flip: true });
  }));

  $('#grid').addEventListener('animationend', (e) => {
    if (e.target.parentElement === e.currentTarget) e.target.classList.remove('entering');
  });

  $('#search-list').addEventListener('animationend', (e) => e.target.closest('li')?.classList.remove('entering'));

  const onCardAction = (e, lookup, rerender) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    e.preventDefault();
    const card = btn.closest('.card');
    const g = lookup(card);
    if (!g) return;
    if (btn.dataset.action === 'fav') {
      toggleFav(g, rerender);
      return;
    }
    const img = $('.thumb img', card);
    if (btn.dataset.action === 'fullscreen') {
      openLightbox(g.images, Number(img?.dataset.index ?? 0), img);
      return;
    }
    const step = btn.dataset.action === 'img-next' ? 1 : -1;
    const index = (Number(img.dataset.index ?? 0) + step + g.images.length) % g.images.length;
    img.dataset.index = index;
    swapImage(img, g.images[index], [{ opacity: 0.3, transform: `translateX(${step * 16}px)` }, {}], { duration: 240, easing: EASE_OUT });
    preloadImage(g.images[(index + step + g.images.length) % g.images.length]);
    $('[data-photo-counter]', card).textContent = `${index + 1} / ${g.images.length}`;
  };

  $('#grid').addEventListener('click', (e) => onCardAction(e, (card) => state.data?.groups.find((x) => x.id === card.dataset.id), renderList));

  $('#favorites-view').addEventListener('click', (e) => {
    if (e.target.closest('.card')) {
      const sectionGroups = (card) => state.favData?.get(Number(card.closest('[data-search-id]').dataset.searchId)) ?? [];
      onCardAction(e, (card) => sectionGroups(card).find((x) => x.id === card.dataset.id), renderFavorites);
      return;
    }
    const pick = Number(e.target.closest('[data-fav-select]')?.dataset.favSelect);
    if (pick) {
      if (pick !== state.favSelected) {
        state.favSelected = pick;
        renderFavorites({ fresh: true });
      }
      return;
    }
    const open = Number(e.target.closest('[data-fav-open]')?.dataset.favOpen);
    if (open) {
      if (open !== state.activeId) selectSearch(open);
      location.hash = '#/';
      return;
    }
    const rescan = e.target.closest('[data-fav-rescan]');
    if (rescan) {
      rescan.disabled = true;
      api('scan', { id: Number(rescan.dataset.favRescan) }).catch(() => { rescan.disabled = false; });
      return;
    }
    const remove = Number(e.target.closest('[data-fav-delete]')?.dataset.favDelete);
    if (remove) confirmDelete(remove);
  });

  $('#favorites-view').addEventListener('animationend', (e) => {
    if (e.target.classList.contains('fav-section')) e.target.classList.remove('entering');
  });

  $('#lang-switch').addEventListener('click', (e) => {
    const lang = e.target.closest('[data-lang]')?.dataset.lang;
    if (!lang || lang === getLang()) return;
    applyLang(lang);
    api('setSetting', { key: 'locale', value: lang }).catch(() => {});
  });

  window.addEventListener('hashchange', navigate);
  window.addEventListener('popstate', () => {
    if (history.state?.lightbox) {
      if (!state.lightbox) history.back();
      return;
    }
    if (state.lightbox) closeLightbox({ fromHistory: true });
  });
  $('#back').addEventListener('click', (e) => {
    e.preventDefault();
    goBack();
  });
  document.addEventListener('keydown', (e) => {
    if (state.lightbox) {
      if (state.lightbox.closing) return;
      if (e.key === 'Escape') closeLightbox();
      else if (e.key === 'ArrowLeft') stepLightbox(-1);
      else if (e.key === 'ArrowRight') stepLightbox(1);
      else return;
      e.preventDefault();
      return;
    }
    if (e.key === 'Escape' && document.body.classList.contains('drawer-open')) {
      setDrawer(false);
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
  hydrateIcons();
  applyStatic();
  state.config = await api('config');
  for (const s of state.config.sources) SOURCE_LABELS[s.id] = s.label;
  const { settings } = state.config;
  if (settings.locale) setLang(settings.locale);
  applyStyle(['styled', 'modern', 'compact'].includes(settings.style) ? settings.style : 'styled');
  applyTheme(['system', 'light', 'dark'].includes(settings.theme) ? settings.theme : 'system');
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
