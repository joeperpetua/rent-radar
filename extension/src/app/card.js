import { getLang, t } from './i18n.js';
import { icon } from './icons.js';
import { $, EASE_OUT, bindSwipeX, preloadImage, swapImage } from './dom.js';
import { esc, euro, fmtDay, num } from './format.js';
import { placeLabel } from './places.js';
import { isFav, sourceLabel } from './state.js';
import { toggleFav } from './favorites.js';
import { openLightbox } from './lightbox.js';

const cardHtmlCache = new WeakMap();
const cardMarkup = new WeakMap();

export const isDrop = (g) => g.priceChange != null && g.priceChange.delta < 0;

function sourceChips(g) {
  const byPortal = new Map();
  for (const s of g.sources) {
    const key = `${s.source}|${s.sourceName ?? ''}`;
    byPortal.set(key, [...(byPortal.get(key) ?? []), s]);
  }
  return [...byPortal.values()].map((items) => {
    const primary = items[0];
    const source = primary.source;
    const url = primary.sourceUrl || primary.url;
    const label = sourceLabel(primary);
    const title = t('openOn', { source: label });

    return `
      <a class="src ${source}" href="${esc(url)}" target="_blank" rel="noopener noreferrer" title="${esc(title)}">
        ${esc(label)}${items.length > 1 ? `<span class="src-count">×${items.length}</span>` : ''}${icon('arrow-up-right', 'ext')}
      </a>`;
  }).join('');
}

export function cardHtml(g) {
  const fav = isFav(g);
  const key = `${fav}|${getLang()}`;
  const hit = cardHtmlCache.get(g);
  if (hit?.key === key) return hit.html;
  const html = buildCardHtml(g, fav);
  cardHtmlCache.set(g, { key, html });
  return html;
}

function buildCardHtml(g, fav) {
  const img = g.images[0];
  const dropped = isDrop(g);
  const area = g.area ? `${num(g.area, 1)} m²` : '';
  const sqm = g.pricePerSqm ? `${euro(g.pricePerSqm, 2)}/m²` : '';
  const facts = [
    g.type === 'house' && ['', t('type.house')],
    area && ['fact-area', area],
    g.rooms && ['', `${num(g.rooms, 1)} ${t('roomsShort')}`],
    placeLabel(g) && ['', placeLabel(g)],
    sqm && ['fact-sqm', sqm],
  ].filter(Boolean);
  return `
    <article class="card" data-id="${esc(g.id)}">
      <a class="card-link" href="#/l/${encodeURIComponent(g.id)}" aria-label="${esc(g.title)}"></a>
      <div class="thumb">
        ${img ? `<img src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<div class="noimg">${esc(t('noImage'))}</div>`}
        <div class="badges">
          ${g.reserved ? `<span class="badge reserved" title="${esc(t('reservedHint'))}">${icon('lock')}${esc(t('badgeReserved'))}</span>` : ''}
          ${g.isNew ? `<span class="badge new">${icon('sparkles')}${esc(t('badgeNew'))}</span>` : ''}
          ${dropped ? `<span class="badge drop">${icon('trending-down')}${esc(t('badgeDrop', { pct: num(Math.abs(g.priceChange.pct), 1) }))}</span>` : ''}
          ${g.categories.filter((c) => c !== 'regular').map((c) => `<span class="badge cat cat-${c}">${esc(t(`catShort.${c}`))}</span>`).join('')}
          ${g.sources.length > 1 ? `<span class="badge multi">${esc(t('listedTimes', { n: g.sources.length }))}</span>` : ''}
        </div>
        ${g.images.length > 1 ? `
          <button class="thumb-nav prev" type="button" data-action="img-prev" aria-label="${esc(t('prevPhoto'))}">${icon('chevron-left')}</button>
          <button class="thumb-nav next" type="button" data-action="img-next" aria-label="${esc(t('nextPhoto'))}">${icon('chevron-right')}</button>` : ''}
        ${g.images.length ? `<span class="badge photos">${icon('images')}<span data-photo-counter>1 / ${g.images.length}</span></span>` : ''}
      </div>
      <div class="card-actions">
        ${g.images.length ? `<button class="icon-btn" type="button" data-action="fullscreen" title="${esc(t('fullscreen'))}" aria-label="${esc(t('fullscreen'))}">${icon('maximize-2')}</button>` : ''}
        <button class="icon-btn fav" type="button" data-action="fav" aria-pressed="${fav}" title="${esc(t('favorite'))}" aria-label="${esc(t('favorite'))}">${icon('star')}</button>
      </div>
      <div class="card-body">
        <div class="price-row">
          <span class="price">${euro(g.price)}</span>
          ${dropped ? `<s class="was" title="${esc(t('priceWas', { date: fmtDay(g.priceChange.at) }))}">${euro(g.priceChange.previous)}</s>` : ''}
          ${sqm ? `<span class="sqm">${sqm}</span>` : ''}
          ${area ? `<span class="price-area">${area}</span>` : ''}
        </div>
        <div class="facts">${facts.map(([cls, text]) => `<span${cls ? ` class="${cls}"` : ''}>${esc(text)}</span>`).join('')}</div>
        <p class="title">${esc(g.title)}</p>
        <div class="address">${esc(g.address ?? '')}</div>
        <div class="sources">${sourceChips(g)}</div>
      </div>
    </article>`;
}

export function cardNode(g) {
  const html = cardHtml(g);
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  const el = tpl.content.firstElementChild;
  cardMarkup.set(el, html);
  return el;
}

export const cardIsCurrent = (el, g) => cardMarkup.get(el) === cardHtml(g);

export function syncCardFav(card, g) {
  if (!card) return;
  const fav = isFav(g);
  for (const btn of card.querySelectorAll('[data-action="fav"]')) btn.setAttribute('aria-pressed', String(fav));
  cardMarkup.set(card, cardHtml(g));
}

export function onCardAction(e, lookup, rerender) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  e.preventDefault();
  const card = btn.closest('.card');
  const g = lookup(card);
  if (!g) return;
  if (btn.dataset.action === 'fav') {
    toggleFav(g, () => rerender(card, g));
    return;
  }
  const img = $('.thumb img', card);
  if (btn.dataset.action === 'fullscreen') {
    openLightbox(g.images, Number(img?.dataset.index ?? 0), img);
    return;
  }
  stepCardImage(card, g, btn.dataset.action === 'img-next' ? 1 : -1);
}

function stepCardImage(card, g, step) {
  const img = $('.thumb img', card);
  if (!img || g.images.length < 2) return;
  const index = (Number(img.dataset.index ?? 0) + step + g.images.length) % g.images.length;
  img.dataset.index = index;
  swapImage(img, g.images[index], [{ opacity: 0.3, transform: `translateX(${step * 16}px)` }, {}], { duration: 240, easing: EASE_OUT });
  preloadImage(g.images[(index + step + g.images.length) % g.images.length]);
  $('[data-photo-counter]', card).textContent = `${index + 1} / ${g.images.length}`;
}

export function bindCardSwipe(root, lookup) {
  const thumbAt = (target, x, y) => {
    const card = target.closest?.('.card');
    const g = card && lookup(card);
    if (!g || g.images.length < 2) return null;
    const thumb = $('.thumb', card);
    const r = thumb?.getBoundingClientRect();
    return r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom ? thumb : null;
  };
  bindSwipeX(root, thumbAt, (thumb, step) => {
    const card = thumb.closest('.card');
    const g = lookup(card);
    if (g) stepCardImage(card, g, step);
  });
}
