import { t } from './i18n.js';
import { icon } from './icons.js';
import { $ } from './dom.js';
import { esc, num } from './format.js';
import { SOURCE_LABELS, state } from './state.js';
import { STATE_ICONS, radarSearch } from './radar.js';

const TOAST_LINGER_MS = 2500;
const ERROR_TOAST_LINGER_MS = 20000;

function toastText(entry) {
  if (entry.state === 'running') return entry.count ? t('toast.loading', { n: entry.count }) : t('toast.loadingNone');
  if (entry.state === 'done') return t('toast.done', { n: entry.count, s: num((entry.ms ?? 0) / 1000, 1) });
  return t('toast.error', { msg: entry.error });
}

export function renderToasts() {
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
