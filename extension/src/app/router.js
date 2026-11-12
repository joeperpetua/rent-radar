import { $, reduceMotion, visibleCard } from './dom.js';
import { state } from './state.js';
import { renderList } from './list.js';
import { renderDetail } from './detail.js';
import { loadFavorites, renderFavorites } from './favoritesView.js';
import { closeLightbox } from './lightbox.js';

const HERO = 'listing-hero';

export const detailId = () => /^#\/l\/(.+)$/.exec(location.hash)?.[1];
export const favoritesRoute = () => location.hash === '#/favorites';
export const currentRoute = () => (detailId() ? 'detail' : favoritesRoute() ? 'favorites' : 'list');

function syncBottomNav() {
  const drawer = $('#sidebar').classList.contains('open');
  const r = state.route === 'detail' ? state.returnRoute ?? 'list' : state.route;
  const active = drawer ? 'filters' : r === 'favorites' ? 'favorites' : 'listings';
  for (const item of document.querySelectorAll('[data-bottom]')) item.setAttribute('aria-current', String(item.dataset.bottom === active));
}

export function setDrawer(open) {
  $('#sidebar').classList.toggle('open', open);
  document.body.classList.toggle('drawer-open', open);
  syncBottomNav();
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

export function goBack() {
  if (state.openedFromList) history.back();
  else location.hash = '#/';
}

export function bindNavigation() {
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
