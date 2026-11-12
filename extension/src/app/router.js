import { $, reduceMotion, visibleCard } from './dom.js';
import { state } from './state.js';
import { renderList } from './list.js';
import { renderDetail } from './detail.js';
import { loadFavorites, renderFavorites } from './favoritesView.js';
import { closeLightbox } from './lightbox.js';

const HERO = 'listing-hero';

export const detailId = () => /^#\/l\/(.+)$/.exec(location.hash)?.[1];
export const favoritesRoute = () => location.hash === '#/favorites';
export const filtersRoute = () => location.hash === '#/filters';
export const currentRoute = () => (detailId() ? 'detail' : favoritesRoute() ? 'favorites' : filtersRoute() ? 'filters' : 'list');
export const listRoute = () => !detailId() && !favoritesRoute();

function syncBottomNav() {
  const drawer = $('#sidebar').classList.contains('open');
  const r = state.route === 'detail' ? state.returnRoute ?? 'list' : state.route;
  const active = drawer || r === 'filters' ? 'filters' : r === 'favorites' ? 'favorites' : 'listings';
  for (const item of document.querySelectorAll('[data-bottom]')) item.setAttribute('aria-current', String(item.dataset.bottom === active));
}

function setDrawer(open) {
  $('#sidebar').classList.toggle('open', open);
  document.body.classList.toggle('drawer-open', open);
  syncBottomNav();
}

export function openFilters() {
  if (filtersRoute()) return;
  state.filtersPushed = true;
  location.hash = '#/filters';
}

export function closeFilters() {
  if (!filtersRoute()) return;
  if (state.filtersPushed) history.back();
  else location.hash = '#/';
}

export function route() {
  const id = detailId();
  const next = currentRoute();
  const prev = state.route;
  if (next === 'detail' && prev && prev !== 'detail') {
    state.returnRoute = prev;
    state.returnScroll = window.scrollY;
    state.openedFromList = true;
  }
  const view = next === 'filters' ? 'list' : next;
  if (next !== 'filters') state.filtersPushed = false;
  document.body.classList.toggle('detail-mode', next === 'detail');
  document.body.classList.toggle('favorites-mode', next === 'favorites');
  $('#list-view').hidden = view !== 'list';
  $('#favorites-view').hidden = view !== 'favorites';
  $('#detail-view').hidden = view !== 'detail';
  $('#favorites-link').setAttribute('aria-current', next === 'favorites' ? 'page' : 'false');
  state.detailShown = id ? decodeURIComponent(id) : null;
  if (view === 'detail') {
    renderDetail(decodeURIComponent(id));
    window.scrollTo(0, 0);
  } else {
    if (view === 'list') renderList();
    else {
      if (prev !== 'detail') state.favSelected = null;
      renderFavorites({ fresh: prev !== 'detail' });
      if (prev !== 'detail' || !state.favData) loadFavorites();
    }
    const returning = prev === 'detail' && state.returnRoute === next;
    const kept = prev === next || (view === 'list' && (prev === 'list' || prev === 'filters'));
    window.scrollTo(0, returning ? state.returnScroll ?? 0 : kept ? window.scrollY : 0);
    state.openedFromList = false;
  }
  state.route = next;
  setDrawer(next === 'filters');
}

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
  const next = currentRoute();
  const filters = next === 'filters' || state.route === 'filters';
  if (reduceMotion() || !document.startViewTransition || state.lightbox || filters) {
    route();
    return;
  }
  if (!opening && !closing) {
    if (next === state.route) route();
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

export function goBack() {
  if (state.openedFromList) history.back();
  else location.hash = '#/';
}

export function bindNavigation() {
  const toggleFilters = () => (filtersRoute() ? closeFilters() : openFilters());
  $('#filters-toggle').addEventListener('click', toggleFilters);
  $('#drawer-close').addEventListener('click', closeFilters);
  $('#bottom-nav').addEventListener('click', (e) => {
    const item = e.target.closest('[data-bottom]');
    if (!item) return;
    if (item.dataset.bottom === 'filters') toggleFilters();
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
}
