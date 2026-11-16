import { applyLang, getLang, setLang, t } from './i18n.js';
import { detect, GUIDES, STORES } from './guides.js';
import { icon } from './icons.js';
import { startRadar } from './radar.js';
import { initTheme } from './theme.js';
import { decodeShare, sharedPayload, teaser } from './share.js';

const $ = (id) => document.getElementById(id);
const env = detect();
const guides = GUIDES[env.platform];
let current = guides.find((g) => g.id === env.guide) ?? guides[0];
const share = sharedPayload();
let shared = null;

function chip(text) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'chip';
  button.title = t('copy');
  const code = document.createElement('code');
  code.textContent = text;
  button.append(code, icon('copy', 'copy'), icon('check', 'done'));
  return button;
}

function stepItem(text) {
  const li = document.createElement('li');
  for (const part of text.split(/(`[^`]+`|\{i:[a-z-]+\})/)) {
    if (part.startsWith('{i:')) li.append(icon(part.slice(3, -1), `step-icon ${part.slice(3, -1)}`));
    else if (part.startsWith('`')) li.append(chip(part.slice(1, -1)));
    else if (part) li.append(part);
  }
  return li;
}

function renderGuide() {
  const picker = $('picker');
  picker.hidden = guides.length < 2;
  picker.replaceChildren(...guides.map((g) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.role = 'tab';
    tab.dataset.guide = g.id;
    tab.textContent = g.name;
    tab.setAttribute('aria-selected', String(g === current));
    return tab;
  }));

  $('store').href = STORES[current.store];
  $('store-label').textContent = t(`store.${current.store}`);
  $('shared-store').href = STORES[current.store];
  $('shared-store').hidden = !env.supported;
  $('shared-store-label').textContent = t(`store.${current.store}`);

  const get = $('get-browser');
  get.hidden = !current.get;
  if (current.get) {
    get.href = current.get;
    $('get-browser-label').textContent = t('get', { name: current.name.split(' ')[0] });
  }

  $('steps').replaceChildren(...[...current.steps, share ? 'step.shared' : 'step.auto'].map((key) => stepItem(t(key))));

  const note = $('guide-note');
  note.hidden = !current.note;
  note.textContent = current.note ? t(current.note) : '';
}

function renderShared() {
  if (!shared) return;
  const locale = getLang() === 'de' ? 'de-AT' : 'en-GB';
  const fmt = (n, digits = 0) => n.toLocaleString(locale, { maximumFractionDigits: digits });
  $('shared-title').textContent = shared.title;
  $('shared-facts').textContent = [
    shared.price && `€ ${fmt(shared.price)}`,
    shared.area && `${fmt(shared.area, 1)} m²`,
    shared.rooms && t('rooms', { n: fmt(shared.rooms, 1) }),
  ].filter(Boolean).join(' · ');
  $('shared-place').textContent = shared.place ?? '';
  $('shared-place').hidden = !shared.place;
}

async function loadShared() {
  try {
    shared = teaser(await decodeShare(share));
  } catch {
    shared = null;
  }
  if (!shared) return;
  const photo = $('shared-photo');
  if (shared.photo) {
    $('shared-media').hidden = false;
    photo.addEventListener('load', () => photo.classList.add('loaded'), { once: true });
    photo.addEventListener('error', () => { $('shared-media').hidden = true; }, { once: true });
    photo.src = shared.photo;
  }
  renderShared();
  $('shared').showModal();
  $('shared').focus();
}

function showSteps() {
  $('shared').close();
  document.querySelector('.action').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

if (share) {
  $('share-cta').hidden = false;
  $('installed-text').dataset.i18n = 'sharedOpening';
  $('open-label').dataset.i18n = 'openListing';
  document.body.dataset.shared = '';
  loadShared();
}

applyLang();
renderGuide();
initTheme($('theme-toggle'));
startRadar($('scope'));
$('browser-warn').hidden = env.supported;

$('lang-switch').addEventListener('click', (event) => {
  const next = event.target.closest('[data-lang]')?.dataset.lang;
  if (!next) return;
  setLang(next);
  renderGuide();
  renderShared();
});

$('picker').addEventListener('click', (event) => {
  const id = event.target.closest('[data-guide]')?.dataset.guide;
  if (!id || id === current.id) return;
  current = guides.find((g) => g.id === id);
  renderGuide();
});

$('steps').addEventListener('click', async (event) => {
  const button = event.target.closest('.chip');
  if (!button) return;
  const code = button.querySelector('code');
  try {
    await navigator.clipboard.writeText(code.textContent);
    button.classList.add('copied');
    setTimeout(() => button.classList.remove('copied'), 1500);
  } catch {
    getSelection().selectAllChildren(code);
  }
});

const setState = (state) => { document.body.dataset.state = state; };
const open = () => window.postMessage({ type: 'rentradar:open', share }, location.origin);

window.addEventListener('message', (event) => {
  if (event.source === window && event.data?.type === 'rentradar:stale') setState('stale');
});

$('open').addEventListener('click', open);
$('reload').addEventListener('click', () => location.reload());
$('shared-open').addEventListener('click', open);
$('shared-reload').addEventListener('click', () => location.reload());
$('shared-steps').addEventListener('click', showSteps);
$('shared-close').addEventListener('click', () => $('shared').close());
$('shared').addEventListener('click', (event) => {
  const box = event.currentTarget.getBoundingClientRect();
  const outside = event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
  if (event.target === event.currentTarget && outside) event.currentTarget.close();
});

const installed = Boolean(document.documentElement.dataset.rentradar);
setState(installed ? 'installed' : 'missing');
const returning = performance.getEntriesByType('navigation')[0]?.type === 'back_forward';
if (share && installed && !returning) open();

window.addEventListener('hashchange', () => {
  if (sharedPayload() !== share) location.reload();
});
