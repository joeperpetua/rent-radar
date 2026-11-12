import { applyStatic, getLang, setLang, t } from './i18n.js';
import { hydrateIcons } from './icons.js';
import { $ } from './dom.js';
import { esc } from './format.js';
import { SOURCE_LABELS, VIEW_DEFAULTS, api, state } from './state.js';
import { bindLightbox, closeLightbox, stepLightbox } from './lightbox.js';
import { bindList, fitLoading, loadListings, renderList } from './list.js';
import { bindNavigation, detailId, favoritesRoute, goBack, route, setDrawer } from './router.js';
import { renderDetail } from './detail.js';
import { bindFavorites, renderFavorites } from './favoritesView.js';
import { bindSearches, placeSearchMenu, renderSearchList } from './searches.js';
import { bindPrefs, renderPrefs } from './prefs.js';
import { bindRefresh, onScanStatus, renderStatus } from './status.js';
import { renderToasts } from './toasts.js';
import { applyStyle, applyTheme, bindSettings, placeSettingsMenu, renderStorage } from './settings.js';
import { bindPullToRefresh } from './pullToRefresh.js';

const CLOCK_TICK_MS = 60 * 1000;

function renderAll() {
  applyStatic();
  for (const btn of document.querySelectorAll('[data-lang]')) btn.setAttribute('aria-pressed', String(btn.dataset.lang === getLang()));
  renderSearchList();
  renderPrefs();
  renderStatus();
  renderToasts();
  if (state.storage) renderStorage();
  const id = detailId();
  if (id) renderDetail(decodeURIComponent(id));
  else if (favoritesRoute()) renderFavorites();
  else renderList();
}

function applyLang(lang) {
  setLang(lang);
  if (!document.body.classList.contains('booting')) renderAll();
}

function onKeydown(e) {
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
}

function bindEvents() {
  bindRefresh();
  bindPullToRefresh();
  bindSearches();
  bindSettings();
  bindPrefs();
  bindNavigation();
  bindList();
  bindFavorites();
  bindLightbox();

  window.addEventListener('resize', () => {
    fitLoading($('#empty'));
    if ($('#search-menu').matches(':popover-open')) placeSearchMenu();
    if ($('#settings-menu').matches(':popover-open')) placeSettingsMenu();
  });

  $('#lang-switch').addEventListener('click', (e) => {
    const lang = e.target.closest('[data-lang]')?.dataset.lang;
    if (!lang || lang === getLang()) return;
    applyLang(lang);
    api('setSetting', { key: 'locale', value: lang }).catch(() => {});
  });

  document.addEventListener('keydown', onKeydown);

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
  document.body.classList.remove('booting');
  state.route = null;
  renderAll();
  await loadListings();
  route();
}

init().catch((err) => {
  document.body.insertAdjacentHTML('beforeend', `<div class="empty">${esc(t('serverDown', { msg: err.message }))}</div>`);
});
