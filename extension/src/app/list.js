import { getLang, t } from './i18n.js';
import { icon } from './icons.js';
import { $, EASE_OUT, inViewport, reduceMotion } from './dom.js';
import { esc } from './format.js';
import { districtLabel, stateName } from './places.js';
import { PAGE_SIZE, activeSearch, api, isQueued, isScanning, saveView, state } from './state.js';
import { cardHtml, isDrop, onCardAction } from './card.js';
import { radarSearch, renderRadar, stopRadar } from './radar.js';
import { currentRoute, detailId, route } from './router.js';
import { renderStatus } from './status.js';
import { renderCategoryCounts } from './prefs.js';

const MAX_STAGGER = 14;
const PAGE_MARGIN_PX = 1200;

const cardMarkup = new WeakMap();
let filterCache = { data: null, key: '', groups: [] };
let listingsLoad = null;
let listingsReloadPending = false;

function filteredGroups() {
  const v = state.view;
  const key = JSON.stringify([v, getLang()]);
  if (filterCache.data === state.data && filterCache.key === key) return filterCache.groups;
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
  filterCache = { data: state.data, key, groups: groups.sort(by) };
  return filterCache.groups;
}

function emptyState() {
  const search = activeSearch();
  if (!search) return state.searches.length ? ['search', t('emptyPick')] : ['bookmark-plus', t('emptyStart')];
  if (state.data?.searchId !== search.id) return ['loader-circle', t('loading'), 'spin'];
  const busy = isScanning(search.id) || isQueued(search.id);
  if (!search.lastScanAt) return ['radar', busy ? t('emptyRunning') : t('emptyNoData')];
  return busy ? ['radar', t('emptyRunning')] : ['search-x', t('emptyFilters')];
}

export function fitLoading(el) {
  if (el.hidden || !el.classList.contains('loading')) {
    el.style.minHeight = '';
    return;
  }
  const nav = $('#bottom-nav');
  const bottom = nav.checkVisibility() ? nav.getBoundingClientRect().top : window.innerHeight;
  const padding = parseFloat(getComputedStyle($('.layout')).paddingBottom) || 0;
  el.style.minHeight = `${Math.max(160, Math.floor(bottom - el.getBoundingClientRect().top - padding))}px`;
}

function renderEmpty(el) {
  const [name, text, extra = ''] = emptyState();
  el.classList.toggle('loading', extra === 'spin');
  fitLoading(el);
  const key = `${name}|${text}`;
  if (el.dataset.key === key) return;
  el.dataset.key = key;
  el.innerHTML = `${icon(name, `empty-icon ${extra}`)}<p>${esc(text)}</p>`;
}

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
  const kids = [...grid.children];
  const grows = nodes.length >= kids.length && kids.every((k, i) => nodes[i] === k);
  if (!grows) grid.replaceChildren(...nodes);
  else if (nodes.length > kids.length) grid.append(...nodes.slice(kids.length));
  if (before) flipCards(grid, before);
}

const pager = new IntersectionObserver((entries) => {
  if (!entries.some((e) => e.isIntersecting) || currentRoute() !== 'list') return;
  state.listLimit += PAGE_SIZE;
  renderList();
}, { rootMargin: `0px 0px ${PAGE_MARGIN_PX}px 0px` });

export function renderList({ flip = false, reset = false } = {}) {
  if (reset) state.listLimit = PAGE_SIZE;
  const search = activeSearch();
  const groups = search ? filteredGroups() : [];
  const d = state.data;
  const radar = radarSearch();
  patchGrid(groups.slice(0, state.listLimit), { flip });
  const more = $('#grid-more');
  more.hidden = groups.length <= state.listLimit;
  pager.unobserve(more);
  if (!more.hidden) pager.observe(more);
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
  const count = search?.lastScanAt && d ? t('resultCount', { shown: groups.length, total: d.stats.groups, listings: d.stats.listings, merged: d.stats.merged }) : '';
  const countHtml = count && listingsLoad ? `${esc(count)}<span class="result-loading" title="${esc(t('loading'))}">${icon('loader-circle', 'spin')}</span>` : esc(count);
  if ($('#result-count').innerHTML !== countHtml) $('#result-count').innerHTML = countHtml;
  for (const btn of document.querySelectorAll('[data-toggle]')) btn.setAttribute('aria-pressed', String(state.view[btn.dataset.toggle]));
}

export async function loadListings() {
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
      if (currentRoute() === 'list') renderList();
    }
  })();
  if (currentRoute() === 'list') renderList();
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

export function bindList() {
  $('#q').value = state.view.q;
  $('#q').addEventListener('input', (e) => {
    state.view.q = e.target.value;
    saveView();
    renderList({ flip: true, reset: true });
  });

  $('#sort').value = state.view.sort;
  $('#sort').addEventListener('change', (e) => {
    state.view.sort = e.target.value;
    saveView();
    renderList({ flip: true, reset: true });
  });

  document.querySelectorAll('[data-toggle]').forEach((btn) => btn.addEventListener('click', () => {
    const key = btn.dataset.toggle;
    state.view[key] = !state.view[key];
    saveView();
    renderList({ flip: true, reset: true });
  }));

  $('#grid').addEventListener('animationend', (e) => {
    if (e.target.parentElement === e.currentTarget) e.target.classList.remove('entering');
  });

  $('#grid').addEventListener('click', (e) => onCardAction(e, (card) => state.data?.groups.find((x) => x.id === card.dataset.id), renderList));
}
