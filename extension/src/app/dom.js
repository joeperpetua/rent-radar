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
