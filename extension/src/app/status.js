import { t } from './i18n.js';
import { icon } from './icons.js';
import { $ } from './dom.js';
import { esc, fmtDate, num, relTime } from './format.js';
import { SOURCE_LABELS, activeSearch, api, isQueued, isScanning, state } from './state.js';
import { renderSourceCounts } from './prefs.js';
import { renderToasts } from './toasts.js';
import { loadStorage, renderStorage } from './settings.js';
import { refreshSearches } from './searches.js';
import { loadListings, renderList } from './list.js';
import { detailId, favoritesRoute } from './router.js';
import { loadFavorites, renderFavorites } from './favoritesView.js';

export function renderStatus() {
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

function sourceLanded(prev, next) {
  if (!next?.sources) return false;
  const same = prev?.searchId === next.searchId && prev?.startedAt === next.startedAt;
  return Object.entries(next.sources).some(([key, s]) => s.saved && !(same && prev.sources?.[key]?.saved));
}

export async function onScanStatus(status) {
  const prev = state.status;
  state.status = status;
  const finished = status.progress?.finishedAt && status.progress.finishedAt !== prev?.progress?.finishedAt;
  const queueChanged = JSON.stringify([prev?.running, prev?.queue]) !== JSON.stringify([status.running, status.queue]);
  renderToasts();
  if ($('#settings-menu').matches(':popover-open')) {
    if (finished) loadStorage();
    else renderStorage();
  }
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

export function bindRefresh() {
  $('#refresh').addEventListener('click', async () => {
    if (state.activeId == null) return;
    await api('scan', { id: state.activeId });
  });
}
