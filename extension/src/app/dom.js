export const EASE_OUT = 'cubic-bezier(.2, .8, .2, 1)';

export const $ = (sel, root = document) => root.querySelector(sel);

export const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export const withTransition = (fn) => (reduceMotion() || !document.startViewTransition ? fn() : document.startViewTransition(fn));

export function inViewport(el) {
  const r = el.getBoundingClientRect();
  return r.bottom > 0 && r.top < window.innerHeight && r.width > 0;
}

export const visibleCard = (id) => [...document.querySelectorAll('.card')].find((c) => c.dataset.id === id && c.checkVisibility()) ?? null;

export function placeMenu(menu, trigger, maxWidth) {
  const rect = trigger.getBoundingClientRect();
  const gutter = 12;
  const width = Math.min(maxWidth, window.innerWidth - gutter * 2);
  menu.style.top = `${Math.round(rect.bottom + 8)}px`;
  menu.style.left = `${Math.round(Math.max(gutter, Math.min(rect.right - width, window.innerWidth - gutter - width)))}px`;
}

export function preloadImage(url) {
  const pre = new Image();
  pre.referrerPolicy = 'no-referrer';
  pre.src = url;
  return pre;
}

export async function swapImage(img, url, frames, options) {
  img.dataset.pending = url;
  await preloadImage(url).decode().catch(() => {});
  if (img.dataset.pending !== url) return;
  delete img.dataset.pending;
  img.src = url;
  if (frames && !reduceMotion()) img.animate(frames, options);
}

const SWIPE_X_SLOP = 10;
const SWIPE_X_TRIGGER = 45;
const SWIPE_X_FOLLOW = 0.4;
const SWIPE_X_CLICK_SLOP = 16;
const SWIPE_X_CLICK_BLOCK_MS = 400;

export function bindSwipeX(root, pick, onSwipe) {
  let gesture = null;
  let blockClicksUntil = 0;

  const drag = (img, dx) => {
    if (!img) return;
    img.style.transition = dx == null ? '' : 'none';
    img.style.transform = dx == null ? '' : `translateX(${Math.round(dx * SWIPE_X_FOLLOW)}px)`;
  };

  root.addEventListener('touchstart', (e) => {
    const touch = e.touches.length === 1 ? e.touches[0] : null;
    const frame = touch ? pick(e.target, touch.clientX, touch.clientY) : null;
    gesture = frame ? { frame, img: frame.querySelector('img'), x: touch.clientX, y: touch.clientY, dx: 0, active: false } : null;
  }, { passive: true });

  root.addEventListener('touchmove', (e) => {
    if (!gesture) return;
    const dx = e.touches[0].clientX - gesture.x;
    const dy = e.touches[0].clientY - gesture.y;
    if (!gesture.active) {
      if (Math.abs(dx) < SWIPE_X_SLOP && Math.abs(dy) < SWIPE_X_SLOP) return;
      if (Math.abs(dx) <= Math.abs(dy) || !e.cancelable) {
        gesture = null;
        return;
      }
      gesture.active = true;
    }
    e.preventDefault();
    gesture.dx = dx;
    drag(gesture.img, dx);
  }, { passive: false });

  const end = () => {
    const done = gesture;
    gesture = null;
    if (!done?.active) return;
    drag(done.img, null);
    if (Math.abs(done.dx) >= SWIPE_X_CLICK_SLOP) blockClicksUntil = Date.now() + SWIPE_X_CLICK_BLOCK_MS;
    if (Math.abs(done.dx) >= SWIPE_X_TRIGGER) onSwipe(done.frame, done.dx < 0 ? 1 : -1);
  };
  root.addEventListener('touchend', end);
  root.addEventListener('touchcancel', end);

  root.addEventListener('click', (e) => {
    if (Date.now() >= blockClicksUntil) return;
    blockClicksUntil = 0;
    e.preventDefault();
    e.stopPropagation();
  }, true);
}
