import { t } from './i18n.js';
import { icon } from './icons.js';
import { $, EASE_OUT, preloadImage, swapImage } from './dom.js';
import { esc } from './format.js';
import { openLightbox } from './lightbox.js';
import { goBack } from './router.js';

const SWIPE_SLOP = 6;
const SWIPE_BACK_TRIGGER = 110;
const SWIPE_BACK_FOLLOW = 0.7;
const SWIPE_BACK_MAX = 400;
const SWIPE_BACK_SHRINK = 0.18;
const SWIPE_BACK_FADE = 160;

export function galleryHtml(g) {
  if (!g.images.length) return '';
  return `
    <div class="gallery">
      <div class="gallery-main">
        <img src="${esc(g.images[0])}" alt="" referrerpolicy="no-referrer" data-index="0">
        ${g.images.length > 1 ? `
          <button class="gallery-nav prev" type="button" aria-label="${esc(t('prevImage'))}">${icon('chevron-left')}</button>
          <button class="gallery-nav next" type="button" aria-label="${esc(t('nextImage'))}">${icon('chevron-right')}</button>
          <span class="badge photos gallery-count">1 / ${g.images.length}</span>` : ''}
      </div>
      ${g.images.length > 1 ? `<div class="thumbs">${g.images.map((src, i) => `
        <button type="button" data-index="${i}" aria-current="${i === 0}" aria-label="${esc(t('image', { n: i + 1 }))}">
          <img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer">
        </button>`).join('')}</div>` : ''}
    </div>`;
}

function bindSwipeBack(frame) {
  const page = frame.closest('.detail');
  let start = null;
  let active = false;
  let shift = 0;
  frame.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    start = e.touches.length === 1 && window.scrollY <= 0 ? { x: t.clientX, y: t.clientY } : null;
    active = false;
    shift = 0;
  }, { passive: true });
  frame.addEventListener('touchmove', (e) => {
    if (!start) return;
    const t = e.touches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (!active) {
      if (Math.abs(dx) < SWIPE_SLOP && Math.abs(dy) < SWIPE_SLOP) return;
      if (dy <= 0 || Math.abs(dx) > dy || !e.cancelable) {
        start = null;
        return;
      }
      active = true;
      frame.classList.add('dragging');
      page.classList.add('swiping');
    }
    e.preventDefault();
    shift = Math.max(0, dy);
    const scale = 1 - Math.min(shift, SWIPE_BACK_MAX) / SWIPE_BACK_MAX * SWIPE_BACK_SHRINK;
    frame.style.transform = `translateY(${Math.round(shift * SWIPE_BACK_FOLLOW)}px) scale(${scale.toFixed(3)})`;
    page.style.setProperty('--swipe', Math.min(1, shift / SWIPE_BACK_FADE).toFixed(3));
  }, { passive: false });
  const end = () => {
    if (!start) return;
    start = null;
    if (!active) return;
    active = false;
    if (shift >= SWIPE_BACK_TRIGGER) {
      goBack();
      return;
    }
    frame.classList.remove('dragging');
    page.classList.remove('swiping');
    frame.style.transform = '';
    page.style.removeProperty('--swipe');
  };
  frame.addEventListener('touchend', end);
  frame.addEventListener('touchcancel', end);
}

export function bindGallery(el, g) {
  const main = $('.gallery-main img', el);
  if (!main) return;
  bindSwipeBack($('.gallery-main', el));
  main.addEventListener('click', () => openLightbox(g.images, Number(main.dataset.index ?? 0), main));
  if (g.images.length < 2) return;
  const show = (i) => {
    const idx = (i + g.images.length) % g.images.length;
    const dir = Math.sign(i - Number(main.dataset.index));
    swapImage(main, g.images[idx], dir && [{ opacity: 0.2, transform: `translateX(${dir * 24}px)` }, {}], { duration: 260, easing: EASE_OUT });
    preloadImage(g.images[(idx + (dir || 1) + g.images.length) % g.images.length]);
    main.dataset.index = idx;
    $('.gallery-count', el).textContent = `${idx + 1} / ${g.images.length}`;
    el.querySelectorAll('.thumbs button').forEach((b, j) => b.setAttribute('aria-current', String(j === idx)));
    el.querySelectorAll('.thumbs button')[idx]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  $('.prev', el).addEventListener('click', () => show(Number(main.dataset.index) - 1));
  $('.next', el).addEventListener('click', () => show(Number(main.dataset.index) + 1));
  el.querySelectorAll('.thumbs button').forEach((b) => b.addEventListener('click', () => show(Number(b.dataset.index))));
}
