import { t } from './i18n.js';
import { icon } from './icons.js';
import { missingGroups } from '../core/prefs.js';
import { $ } from './dom.js';
import { esc, euro } from './format.js';
import { stateName } from './places.js';
import { activeSearch, api, currentPrefs, state } from './state.js';
import { loadListings } from './list.js';
import { setDrawer } from './router.js';
import { renderSearchList, replaceSearch } from './searches.js';
import { renderStatus } from './status.js';

const RANGE_FIELDS = ['minPrice', 'maxPrice', 'minArea', 'maxArea', 'minRooms', 'maxRooms'];
const SOURCE_KINDS = ['portal', 'broker', 'cooperative'];
const BULK_TOGGLES = ['states', 'categories', 'districts', 'sources'];
const AUTOSAVED = ['categories', 'sources'];

const tickedValues = (id) => [...document.querySelectorAll(`#${id} input:checked`)].map((i) => i.value);

function suggestName(prefs) {
  const everywhere = !prefs.states.length || prefs.states.length === state.config.states.length;
  const states = everywhere ? [t('country')] : prefs.states.map(stateName);
  const parts = [states.length > 2 ? `${states.slice(0, 2).join(', ')} +${states.length - 2}` : states.join(', ')];
  if (prefs.types.length === 1) parts.push(t(`type.${prefs.types[0]}`));
  if (prefs.maxPrice) parts.push(t('upTo', { v: euro(prefs.maxPrice) }));
  if (prefs.minRooms) parts.push(`${t('fromRooms', { n: prefs.minRooms })}`);
  return parts.join(' · ');
}

function readPrefsForm(form) {
  const checked = (name) => [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((i) => i.value);
  return {
    ...Object.fromEntries(RANGE_FIELDS.map((k) => [k, form[k].value])),
    states: checked('state'),
    types: checked('type'),
    categories: checked('category'),
    districts: checked('district').map(Number),
    sources: checked('source'),
  };
}

function updateFormState() {
  $('#districts-field').hidden = !$('#states input[value="wien"]')?.checked;
  for (const id of BULK_TOGGLES) {
    const boxes = [...document.querySelectorAll(`#${id} input`)];
    $(`#${id}-all`).disabled = boxes.every((i) => i.checked);
    $(`#${id}-none`).disabled = boxes.every((i) => !i.checked);
  }
  const missing = missingGroups(readPrefsForm($('#prefs')));
  for (const tag of document.querySelectorAll('[data-pick]')) tag.hidden = !missing.includes(tag.dataset.pick);
  const blocked = !activeSearch() && missing.length > 0;
  $('#save-search').disabled = blocked;
  $('#prefs-hint').textContent = blocked ? t('pickRequired') : '';
}

function tickAll(id, checked) {
  document.querySelectorAll(`#${id} input`).forEach((i) => { i.checked = checked; });
  updateFormState();
  if (AUTOSAVED.includes(id)) savePrefsPatch({ [id]: tickedValues(id) });
}

async function savePrefsPatch(patch) {
  const search = activeSearch();
  if (!search) {
    state.draft = { ...state.draft, ...patch };
    return;
  }
  const res = await api('saveSearch', { id: search.id, name: search.name, prefs: { ...search.prefs, ...patch } });
  replaceSearch(res.search);
  await loadListings();
}

export function flashHint(text) {
  $('#prefs-hint').textContent = text;
  setTimeout(() => { $('#prefs-hint').textContent = ''; }, 4000);
}

export function renderPrefs() {
  const { districts, sources, types, categories, states } = state.config;
  const prefs = currentPrefs();
  const search = activeSearch();
  const form = $('#prefs');
  $('#prefs-title').textContent = search ? t('editSearch') : t('newSearchTitle');
  $('#drawer-title').textContent = $('#prefs-title').textContent;
  $('#prefs-new').hidden = !search;
  $('#save-search').innerHTML = `${icon(search ? 'save' : 'radar')}<span>${esc(search ? t('saveSearch') : t('createSearch'))}</span>`;
  form.elements.namedItem('name').value = search?.name ?? '';
  form.elements.namedItem('name').placeholder = suggestName(prefs);
  for (const key of RANGE_FIELDS) form[key].value = prefs[key] || '';

  $('#states').innerHTML = states.map((s) => `
    <label class="check">
      <input type="checkbox" name="state" value="${s.id}" ${prefs.states.includes(s.id) ? 'checked' : ''}>
      <span>${esc(stateName(s.id))}</span>
    </label>`).join('');

  $('#types').innerHTML = types.map((type) => `
    <label>
      <input type="checkbox" name="type" value="${type}" ${prefs.types.includes(type) ? 'checked' : ''}>
      <span>${esc(t(`type.${type}`))}</span>
    </label>`).join('');

  $('#categories').innerHTML = categories.map((c) => `
    <label class="check">
      <input type="checkbox" name="category" value="${c}" ${prefs.categories.includes(c) ? 'checked' : ''}>
      <span class="cat-dot cat-${c}"></span><span>${esc(t(`cat.${c}`))}</span>
      <span class="count" data-cat-count="${c}"></span>
    </label>`).join('');
  renderCategoryCounts();

  $('#districts').innerHTML = districts.map((d) => `
    <label class="check" title="${esc(d.postcode)} ${esc(d.name)}">
      <input type="checkbox" name="district" value="${d.number}" ${prefs.districts.includes(d.number) ? 'checked' : ''}>
      <b>${d.number}</b><span>${esc(d.name)}</span>
    </label>`).join('');

  $('#sources').innerHTML = SOURCE_KINDS.map((kind) => {
    const group = sources.filter((s) => (s.kind ?? 'portal') === kind);
    if (!group.length) return '';
    return `<div class="source-group" role="group" aria-label="${esc(t(`sourceKind.${kind}`))}">
      <span class="source-group-title">${esc(t(`sourceKind.${kind}`))}</span>
      ${group.map((s) => `
      <label class="check">
        <span class="dot ${s.id}"></span><span>${esc(s.label)}</span>
        <span class="count" data-count="${s.id}"></span>
        <input type="checkbox" class="switch" role="switch" name="source" value="${s.id}" ${prefs.sources.includes(s.id) ? 'checked' : ''}>
      </label>`).join('')}
    </div>`;
  }).join('');

  updateFormState();
  renderSourceCounts();
}

export function renderCategoryCounts() {
  for (const el of document.querySelectorAll('[data-cat-count]')) {
    el.textContent = activeSearch() ? state.data?.categoryCounts?.[el.dataset.catCount] ?? '' : '';
  }
}

export function renderSourceCounts() {
  for (const el of document.querySelectorAll('[data-count]')) {
    const run = activeSearch() ? state.data?.runs?.[el.dataset.count] : null;
    el.textContent = run ? (run.ok ? run.count : t('error')) : '';
  }
}

export function bindPrefs() {
  $('#prefs').addEventListener('change', updateFormState);

  $('#prefs').addEventListener('input', (e) => {
    if (e.target.name !== 'name') $('#search-name').placeholder = suggestName({ ...currentPrefs(), ...readPrefsForm(e.currentTarget) });
  });

  $('#prefs').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const prefs = readPrefsForm(form);
    const name = form.elements.namedItem('name').value.trim() || suggestName({ ...currentPrefs(), ...prefs });
    const button = $('#save-search');
    button.disabled = true;
    try {
      const res = await api('saveSearch', { id: state.activeId, name, prefs });
      replaceSearch(res.search);
      state.activeId = res.search.id;
      if (res.scanning) state.status = await api('status');
      api('setSetting', { key: 'activeSearchId', value: res.search.id }).catch(() => {});
      renderSearchList();
      renderPrefs();
      renderStatus();
      flashHint(res.scanning ? t('savedRunning') : t('saved'));
      setDrawer(false);
      await loadListings();
    } catch (err) {
      flashHint(`${t('error')}: ${err.message}`);
    } finally {
      button.disabled = false;
      updateFormState();
    }
  });

  for (const id of AUTOSAVED) $(`#${id}`).addEventListener('change', () => savePrefsPatch({ [id]: tickedValues(id) }));

  for (const id of BULK_TOGGLES) {
    $(`#${id}-all`).addEventListener('click', () => tickAll(id, true));
    $(`#${id}-none`).addEventListener('click', () => tickAll(id, false));
  }
}
