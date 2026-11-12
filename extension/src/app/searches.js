import { t } from './i18n.js';
import { icon } from './icons.js';
import { $, placeMenu, reduceMotion } from './dom.js';
import { esc, num, relTime } from './format.js';
import { activeSearch, api, isQueued, isScanning, state } from './state.js';
import { askConfirm, bindModal } from './modal.js';
import { loadListings, renderList } from './list.js';
import { closeFilters, detailId, favoritesRoute, openFilters } from './router.js';
import { renderFavorites } from './favoritesView.js';
import { flashHint, renderPrefs } from './prefs.js';
import { renderStatus } from './status.js';

const SEARCH_MENU_WIDTH = 360;

export const placeSearchMenu = () => placeMenu($('#search-menu'), $('#search-trigger'), SEARCH_MENU_WIDTH);

const closeSearchMenu = () => $('#search-menu').hidePopover();

export function renderSearchList() {
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

export function replaceSearch(search) {
  const i = state.searches.findIndex((s) => s.id === search.id);
  if (i >= 0) state.searches[i] = search;
  else state.searches.push(search);
}

export async function refreshSearches() {
  state.searches = await api('searches');
  renderSearchList();
}

export async function selectSearch(id) {
  state.activeId = id;
  state.data = null;
  state.toasts.radarRuns.clear();
  if (id == null) state.draft = { ...state.config.defaults };
  api('setSetting', { key: 'activeSearchId', value: id }).catch(() => {});
  if (detailId()) location.hash = '#/';
  renderSearchList();
  renderPrefs();
  renderStatus();
  renderList({ reset: true });
  await loadListings();
}

export async function confirmDelete(id) {
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

export function bindSearches() {
  $('#search-menu').addEventListener('beforetoggle', (e) => {
    if (e.newState === 'open') placeSearchMenu();
  });

  const startNewSearch = () => {
    closeSearchMenu();
    openFilters();
    selectSearch(null);
    $('#search-name').focus();
  };
  $('#new-search').addEventListener('click', startNewSearch);
  $('#prefs-new').addEventListener('click', startNewSearch);

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
    closeFilters();
    if (favoritesRoute()) location.hash = '#/';
    if (id !== state.activeId) selectSearch(id);
    else if (detailId()) location.hash = '#/';
  });

  $('#search-list').addEventListener('animationend', (e) => e.target.closest('li')?.classList.remove('entering'));

  bindModal($('#confirm-delete'));
}
