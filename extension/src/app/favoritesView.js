import { t } from './i18n.js';
import { icon } from './icons.js';
import { $, reduceMotion } from './dom.js';
import { esc, euro, num, relTime } from './format.js';
import { api, isFav, isQueued, isScanning, state } from './state.js';
import { cardHtml, onCardAction } from './card.js';
import { detailId, favoritesRoute, route } from './router.js';
import { confirmDelete, selectSearch } from './searches.js';

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

export function renderFavorites({ fresh = false } = {}) {
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

export async function loadFavorites() {
  const token = ++state.favToken;
  const entries = await Promise.all(state.searches.map(async (s) => [s.id, (await api('listings', { id: s.id })).groups]));
  if (token !== state.favToken) return;
  state.favData = new Map(entries);
  if (favoritesRoute()) renderFavorites();
  else if (detailId() && $('#detail-view .empty')) route();
}

export function bindFavorites() {
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
}
