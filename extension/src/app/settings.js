import { t } from './i18n.js';
import { $, placeMenu, withTransition } from './dom.js';
import { fmtBytes, num } from './format.js';
import { VIEW_DEFAULTS, api, scanIdle, state } from './state.js';
import { askConfirm, bindModal } from './modal.js';
import { refreshSearches, selectSearch } from './searches.js';
import { loadListings } from './list.js';
import { detailId, favoritesRoute, route } from './router.js';
import { loadFavorites } from './favoritesView.js';
import { BACKUP_EXTENSION, InvalidBackupFile, decodeBackup, encodeBackup } from '../core/backupFile.js';

const SETTINGS_MENU_WIDTH = 320;
const STYLE_KEY = 'rentradar-style';
const THEME_KEY = 'rentradar-theme';

export const placeSettingsMenu = () => placeMenu($('#settings-menu'), $('#settings-trigger'), SETTINGS_MENU_WIDTH);

export function applyStyle(style) {
  const root = document.documentElement;
  if (style === 'modern') delete root.dataset.style;
  else root.dataset.style = style;
  for (const input of document.querySelectorAll('input[name="style"]')) input.checked = input.value === style;
  if ($('#settings-menu').matches(':popover-open')) placeSettingsMenu();
  try {
    localStorage.setItem(STYLE_KEY, style);
  } catch {}
}

export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
  for (const btn of document.querySelectorAll('[data-theme-option]')) btn.setAttribute('aria-pressed', String(btn.dataset.themeOption === theme));
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {}
}

function switchStyle(style) {
  $('#settings-menu').hidePopover();
  if (style === (document.documentElement.dataset.style ?? 'modern')) return;
  withTransition(() => applyStyle(style));
  api('setSetting', { key: 'style', value: style }).catch(() => {});
}

export function renderStorage() {
  const s = state.storage;
  const idle = scanIdle();
  $('#storage-size').textContent = s ? fmtBytes(s.bytes) : t('loading');
  $('#storage-detail').textContent = !s ? '' : s.prunable
    ? t('storageDetailPrunable', { n: num(s.listings), p: num(s.prunable) })
    : t('storageDetail', { n: num(s.listings) });
  $('#prune-listings').disabled = !s?.prunable || !idle || state.storageBusy;
  $('#clear-listings').disabled = !s?.listings || !idle || state.storageBusy;
  $('#storage-hint').textContent = s && !idle ? t('storageScanning') : state.storageHint;
}

export async function loadStorage() {
  const token = ++state.storageToken;
  try {
    const storage = await api('storage');
    if (token === state.storageToken) state.storage = storage;
  } catch {}
  renderStorage();
}

async function reloadData() {
  state.favData = null;
  await refreshSearches();
  await loadListings();
  if (favoritesRoute()) loadFavorites();
  else if (detailId()) route();
}

async function storageAction(method) {
  state.storageBusy = true;
  state.storageToken++;
  renderStorage();
  try {
    const { removed, storage } = await api(method);
    state.storage = storage;
    state.storageHint = t('storageRemoved', { n: num(removed) });
    await reloadData();
  } catch (err) {
    state.storageHint = `${t('error')}: ${err.message}`;
  } finally {
    state.storageBusy = false;
    renderStorage();
  }
}

async function confirmClear() {
  const menu = $('#settings-menu');
  $('#confirm-clear-text').textContent = t('confirmClear', { n: num(state.storage?.listings) });
  const confirmed = await askConfirm($('#confirm-clear'));
  if (!menu.matches(':popover-open')) menu.showPopover();
  if (confirmed) await storageAction('clearListings');
}

export function renderBackup() {
  $('#export-backup').disabled = state.backupBusy;
  $('#import-backup').disabled = state.backupBusy || !scanIdle();
  $('#backup-hint').textContent = !scanIdle() ? t('storageScanning') : state.backupHint;
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function backupAction(fn) {
  state.backupBusy = true;
  state.backupHint = '';
  renderBackup();
  try {
    state.backupHint = await fn();
  } catch (err) {
    state.backupHint = err instanceof InvalidBackupFile ? t('importInvalid') : `${t('error')}: ${err.message}`;
  } finally {
    state.backupBusy = false;
    renderBackup();
  }
}

const exportBackup = () => backupAction(async () => {
  const backup = await api('exportBackup');
  download(await encodeBackup(backup), `rentradar-backup-${backup.exportedAt.slice(0, 10)}.${BACKUP_EXTENSION}`);
  return t('exportDone', { s: num(backup.searches.length), f: num(backup.favorites.length) });
});

const importBackup = (file, applyLang) => backupAction(async () => {
  const result = await api('importBackup', await decodeBackup(await file.arrayBuffer()));
  const { settings } = result;
  applyStyle(settings.style);
  applyTheme(settings.theme);
  state.view = { ...VIEW_DEFAULTS, ...settings.view };
  state.favorites = new Set(result.favorites);
  state.searches = result.searches;
  if (settings.locale) applyLang(settings.locale);
  if (state.activeId == null && state.searches.length) await selectSearch(state.searches[0].id);
  await reloadData();
  loadStorage();
  const skipped = result.skipped.searches + result.skipped.favorites;
  const done = t('importDone', { s: num(result.added.searches), f: num(result.added.favorites) });
  return skipped ? `${done}. ${t('importSkipped', { n: num(skipped) })}` : done;
});

export function bindSettings(applyLang) {
  $('#settings-menu').addEventListener('beforetoggle', (e) => {
    if (e.newState !== 'open') return;
    placeSettingsMenu();
    if (!state.backupBusy) state.backupHint = '';
    renderBackup();
    if (state.storageBusy) return;
    state.storageHint = '';
    renderStorage();
    loadStorage();
  });
  $('#prune-listings').addEventListener('click', () => storageAction('pruneListings'));
  $('#export-backup').addEventListener('click', exportBackup);
  $('#import-backup').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', async (e) => {
    const [file] = e.target.files;
    e.target.value = '';
    if (!file) return;
    const menu = $('#settings-menu');
    const done = importBackup(file, applyLang);
    if (!menu.matches(':popover-open')) menu.showPopover();
    await done;
  });
  $('#clear-listings').addEventListener('click', confirmClear);
  $('#settings-menu').addEventListener('click', (e) => {
    if (e.target.matches('input[name="style"]')) switchStyle(e.target.value);
  });
  $('#theme-switch').addEventListener('click', (e) => {
    const theme = e.target.closest('[data-theme-option]')?.dataset.themeOption;
    if (!theme || theme === (document.documentElement.dataset.theme ?? 'system')) return;
    withTransition(() => applyTheme(theme));
    api('setSetting', { key: 'theme', value: theme }).catch(() => {});
  });
  bindModal($('#confirm-clear'));
}
