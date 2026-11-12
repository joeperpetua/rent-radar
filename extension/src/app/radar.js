import { t } from './i18n.js';
import { icon } from './icons.js';
import { $ } from './dom.js';
import { clock, esc, num } from './format.js';
import { SOURCE_LABELS, activeSearch, isQueued, isScanning, state } from './state.js';
import { detailId } from './router.js';

const RADAR_SWEEP_MS = 4000;
const RADAR_TICK_MS = 1000;
const MAX_BLIPS_PER_SOURCE = 12;
const LISTINGS_PER_BLIP = 25;

export const STATE_ICONS = { waiting: 'circle-dashed', running: 'loader-circle', done: 'circle-check', error: 'circle-alert' };

export function radarSearch() {
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

export function renderRadar(search) {
  const box = $('#radar');
  if (box.dataset.search !== String(search.id)) {
    box.dataset.search = search.id;
    box.innerHTML = `
      <div class="radar-body">
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
        </div>
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

export function stopRadar() {
  clearInterval(state.radarTimer);
  state.radarTimer = null;
  const box = $('#radar');
  box.hidden = true;
  box.dataset.search = '';
  box.innerHTML = '';
}
