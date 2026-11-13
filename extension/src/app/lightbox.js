import { $, EASE_OUT, inViewport, preloadImage, reduceMotion, swapImage } from './dom.js';
import { state } from './state.js';
import { createLightboxTouch } from './lightboxTouch.js';

function fittedRect(img) {
  const r = img.getBoundingClientRect();
  const fit = getComputedStyle(img).objectFit;
  const { naturalWidth: w, naturalHeight: h } = img;
  if (fit !== 'contain' || !w || !h) return { rect: r, cover: fit === 'cover' };
  const k = Math.min(r.width / w, r.height / h);
  const width = w * k;
  const height = h * k;
  return { rect: { left: r.left + (r.width - width) / 2, top: r.top + (r.height - height) / 2, width, height }, cover: false };
}

function zoomFrames(target, source) {
  const d = target.getBoundingClientRect();
  const { rect: s, cover } = fittedRect(source);
  if (!d.width || !s.width) return null;
  const k = cover ? Math.max(s.width / d.width, s.height / d.height) : s.width / d.width;
  const dx = s.left + s.width / 2 - (d.left + d.width / 2);
  const dy = s.top + s.height / 2 - (d.top + d.height / 2);
  const ix = Math.max(0, (d.width * k - s.width) / 2 / k);
  const iy = Math.max(0, (d.height * k - s.height) / 2 / k);
  return [
    { transform: `translate(${dx}px, ${dy}px) scale(${k})`, clipPath: `inset(${iy}px ${ix}px)` },
    { transform: 'none', clipPath: 'inset(0px 0px)' },
  ];
}

const lightboxChrome = (box) => box.querySelectorAll('.lb-close, .lb-nav, .lb-count');

let touch = null;
const resetZoom = () => touch?.reset();

export async function openLightbox(images, index = 0, source = null) {
  if (!images?.length) return;
  const box = $('#lightbox');
  const img = $('img', box);
  box.getAnimations({ subtree: true }).forEach((a) => a.cancel());
  resetZoom();
  const pushed = !state.lightbox?.pushed && history.state?.lightbox !== true;
  if (pushed) history.pushState({ lightbox: true }, '');
  state.lightbox = { images, index, source, startIndex: index, pushed: pushed || Boolean(state.lightbox?.pushed) };
  box.hidden = false;
  document.body.classList.add('lightbox-open');
  showLightboxImage(index);
  if (reduceMotion()) return;
  const opened = state.lightbox;
  box.animate([{ backgroundColor: 'rgba(0, 0, 0, 0)' }, {}], { duration: 320, easing: 'ease-out' });
  for (const el of lightboxChrome(box)) el.animate([{ opacity: 0 }, {}], { duration: 220, delay: 160, fill: 'backwards' });
  img.style.visibility = 'hidden';
  await img.decode().catch(() => {});
  img.style.visibility = '';
  if (state.lightbox !== opened || opened.closing || opened.index !== index) return;
  const frames = source?.isConnected && zoomFrames(img, source);
  if (frames) img.animate(frames, { duration: 420, easing: EASE_OUT });
  else img.animate([{ opacity: 0, transform: 'scale(.92)' }, {}], { duration: 260, easing: EASE_OUT });
}

function showLightboxImage(index, dir = 0) {
  const { images } = state.lightbox;
  resetZoom();
  const i = (index + images.length) % images.length;
  state.lightbox.index = i;
  const box = $('#lightbox');
  const img = $('img', box);
  img.style.visibility = '';
  if (dir) {
    swapImage(img, images[i], [{ opacity: 0, transform: `translateX(${dir * 60}px) scale(.98)` }, {}], { duration: 300, easing: EASE_OUT });
  } else {
    delete img.dataset.pending;
    img.src = images[i];
  }
  $('.lb-count', box).textContent = `${i + 1} / ${images.length}`;
  box.classList.toggle('single', images.length < 2);
  for (const n of [i + 1, i - 1]) preloadImage(images[(n + images.length) % images.length]);
}

export const stepLightbox = (step) => showLightboxImage(state.lightbox.index + step, step);

export function closeLightbox({ fromHistory = false, fling = null } = {}) {
  const lb = state.lightbox;
  if (!lb || lb.closing) return;
  if (lb.pushed) {
    lb.pushed = false;
    if (!fromHistory && history.state?.lightbox) history.back();
  }
  const box = $('#lightbox');
  const img = $('img', box);
  const finish = () => {
    if (state.lightbox && state.lightbox !== lb) return;
    box.getAnimations({ subtree: true }).forEach((a) => a.cancel());
    state.lightbox = null;
    box.hidden = true;
    document.body.classList.remove('lightbox-open');
    resetZoom();
  };
  if (reduceMotion()) {
    finish();
    return;
  }
  lb.closing = true;
  const shared = !fling && !touch?.isZoomed() && lb.index === lb.startIndex && lb.source?.isConnected && inViewport(lb.source);
  const source = shared ? lb.source : null;
  img.getAnimations().forEach((a) => a.cancel());
  const frames = source && zoomFrames(img, source);
  const duration = frames ? 340 : fling ? 220 : 200;
  const flung = fling && { opacity: 0, transform: `translate(${fling.x.toFixed(2)}px, ${fling.y.toFixed(2)}px) scale(${(fling.scale * 0.92).toFixed(4)})` };
  const anim = frames
    ? img.animate([...frames].reverse(), { duration, easing: 'cubic-bezier(.4, 0, .2, 1)', fill: 'forwards' })
    : img.animate([{}, flung ?? { opacity: 0, transform: 'scale(.94)' }], { duration, easing: flung ? 'ease-out' : 'ease-in', fill: 'forwards' });
  box.animate([{}, { backgroundColor: 'rgba(0, 0, 0, 0)' }], { duration, easing: 'ease-in', fill: 'forwards' });
  for (const el of lightboxChrome(box)) el.animate([{}, { opacity: 0 }], { duration: 150, fill: 'forwards' });
  anim.finished.then(finish, finish);
}

export function bindLightbox() {
  const box = $('#lightbox');
  box.addEventListener('click', (e) => {
    if (state.lightbox?.closing) return;
    const action = e.target.closest('[data-lb]')?.dataset.lb;
    if (action === 'close') closeLightbox();
    else if (action === 'prev') stepLightbox(-1);
    else if (action === 'next') stepLightbox(1);
    else if (e.target === box) closeLightbox();
  });
  touch = createLightboxTouch(box, {
    step: (dir) => stepLightbox(dir),
    dismiss: (fling) => closeLightbox({ fling }),
  });
  let startX = null;
  box.addEventListener('pointerdown', (e) => { startX = e.pointerType === 'mouse' ? e.clientX : null; });
  box.addEventListener('pointerup', (e) => {
    if (startX == null || e.pointerType !== 'mouse' || !state.lightbox || state.lightbox.closing) return;
    const dx = e.clientX - startX;
    startX = null;
    if (Math.abs(dx) > 50) stepLightbox(dx < 0 ? 1 : -1);
  });
}
