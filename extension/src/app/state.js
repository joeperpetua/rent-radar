import { call } from './bridge.js';

export const PAGE_SIZE = 48;
export const VIEW_DEFAULTS = { sort: 'new', onlyNew: false, onlyMulti: false, onlyDropped: false, q: '' };
const VIEW_SAVE_DELAY_MS = 400;

export const SOURCE_LABELS = {};
export const sourceLabel = (s) => s.sourceName || SOURCE_LABELS[s.source] || s.sourceHost || s.source;

export const state = {
  config: null,
  searches: [],
  activeId: null,
  draft: null,
  data: null,
  status: null,
  view: { ...VIEW_DEFAULTS },
  favorites: new Set(),
  viewTimer: null,
  toasts: { runId: null, dismissed: new Set(), timers: [], radarRuns: new Set() },
  knownSearches: new Set(),
  radarTimer: null,
  favData: null,
  favToken: 0,
  favSelected: null,
  statusHtml: '',
  storage: null,
  storageBusy: false,
  storageHint: '',
  storageToken: 0,
  listLimit: PAGE_SIZE,
  route: null,
  returnRoute: null,
  returnScroll: null,
  openedFromList: false,
  filtersPushed: false,
  detailShown: null,
  lightbox: null,
};

export const api = (method, payload) => call(method, payload);

export function saveView() {
  clearTimeout(state.viewTimer);
  state.viewTimer = setTimeout(() => api('setSetting', { key: 'view', value: state.view }).catch(() => {}), VIEW_SAVE_DELAY_MS);
}

export const activeSearch = () => state.searches.find((s) => s.id === state.activeId) ?? null;
export const currentPrefs = () => activeSearch()?.prefs ?? state.draft;
export const isScanning = (id) => state.status?.running === id;
export const isQueued = (id) => state.status?.queue?.includes(id) ?? false;
export const scanIdle = () => state.status?.running == null && !state.status?.queue?.length;

export const memberIds = (g) => g.sources.map((s) => s.id);
export const isFav = (g) => memberIds(g).some((id) => state.favorites.has(id));
