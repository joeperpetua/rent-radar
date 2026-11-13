import { EASE_OUT } from './dom.js';

const MAX_SCALE = 4;
const AXIS_SLOP = 10;
const NAV_TRIGGER = 45;
const NAV_FOLLOW = 0.4;
const DISMISS_TRIGGER = 110;
const DISMISS_FADE = 220;
const DISMISS_SHRINK = 0.25;
const DISMISS_THROW = 0.25;
const SETTLE_MS = 220;

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const spread = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
const middle = (a, b) => ({ x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 });

function contentSize(img) {
  const { clientWidth: w, clientHeight: h, naturalWidth: nw, naturalHeight: nh } = img;
  if (!nw || !nh) return { width: w, height: h };
  const k = Math.min(w / nw, h / nh);
  return { width: nw * k, height: nh * k };
}

export function createLightboxTouch(box, { step, dismiss }) {
  const view = { scale: 1, x: 0, y: 0 };
  let pinch = null;
  let drag = null;
  let settleTimer = null;

  const image = () => box.querySelector('img');

  const paint = (fade = 1) => {
    const img = image();
    if (!img) return;
    const idle = view.scale === 1 && !view.x && !view.y;
    img.style.transform = idle ? '' : `translate(${view.x.toFixed(2)}px, ${view.y.toFixed(2)}px) scale(${view.scale.toFixed(4)})`;
    box.style.setProperty('--lb-fade', fade.toFixed(3));
    box.classList.toggle('zoomed', view.scale > 1);
  };

  const clampPan = () => {
    const img = image();
    if (!img) return;
    const { width, height } = contentSize(img);
    const maxX = Math.max(0, (width * view.scale - window.innerWidth) / 2);
    const maxY = Math.max(0, (height * view.scale - window.innerHeight) / 2);
    view.x = clamp(view.x, -maxX, maxX);
    view.y = clamp(view.y, -maxY, maxY);
  };

  const stopSettle = () => {
    clearTimeout(settleTimer);
    settleTimer = null;
    const img = image();
    if (img) img.style.transition = '';
  };

  const settle = () => {
    const img = image();
    if (!img) return;
    stopSettle();
    img.style.transition = `transform ${SETTLE_MS}ms ${EASE_OUT}`;
    paint();
    settleTimer = setTimeout(stopSettle, SETTLE_MS + 20);
  };

  const reset = () => {
    pinch = null;
    drag = null;
    stopSettle();
    view.scale = 1;
    view.x = 0;
    view.y = 0;
    const img = image();
    if (img) img.style.transform = '';
    box.style.removeProperty('--lb-fade');
    box.classList.remove('zoomed', 'dragging');
  };

  box.addEventListener('touchstart', (e) => {
    if (e.target.closest('button')) return;
    stopSettle();
    if (e.touches.length >= 2) {
      const [a, b] = e.touches;
      pinch = { gap: spread(a, b) || 1, at: middle(a, b), scale: view.scale, x: view.x, y: view.y };
      drag = null;
      return;
    }
    if (pinch) return;
    const touch = e.touches[0];
    drag = { x: touch.clientX, y: touch.clientY, dx: 0, dy: 0, pan: view.scale > 1, axis: null, fromX: view.x, fromY: view.y };
  }, { passive: true });

  box.addEventListener('touchmove', (e) => {
    if (pinch && e.touches.length >= 2) {
      if (e.cancelable) e.preventDefault();
      const [a, b] = e.touches;
      const scale = clamp(pinch.scale * (spread(a, b) / pinch.gap), 1, MAX_SCALE);
      const ratio = scale / pinch.scale;
      const at = middle(a, b);
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      view.scale = scale;
      view.x = at.x - cx - (pinch.at.x - cx - pinch.x) * ratio;
      view.y = at.y - cy - (pinch.at.y - cy - pinch.y) * ratio;
      clampPan();
      paint();
      return;
    }
    if (!drag || e.touches.length !== 1) return;
    const touch = e.touches[0];
    drag.dx = touch.clientX - drag.x;
    drag.dy = touch.clientY - drag.y;
    if (drag.pan) {
      if (e.cancelable) e.preventDefault();
      view.x = drag.fromX + drag.dx;
      view.y = drag.fromY + drag.dy;
      clampPan();
      paint();
      return;
    }
    if (!drag.axis) {
      if (Math.abs(drag.dx) < AXIS_SLOP && Math.abs(drag.dy) < AXIS_SLOP) return;
      if (!e.cancelable) {
        drag = null;
        return;
      }
      drag.axis = Math.abs(drag.dx) > Math.abs(drag.dy) ? 'x' : 'y';
      if (drag.axis === 'y') box.classList.add('dragging');
    }
    e.preventDefault();
    if (drag.axis === 'x') {
      view.x = drag.dx * NAV_FOLLOW;
      paint();
      return;
    }
    const travel = Math.abs(drag.dy);
    view.y = drag.dy;
    view.scale = 1 - Math.min(travel, DISMISS_FADE) / DISMISS_FADE * DISMISS_SHRINK;
    paint(1 - Math.min(0.75, (travel / DISMISS_FADE) * 0.75));
  }, { passive: false });

  const end = (e) => {
    if (pinch) {
      if (e.touches.length >= 2) return;
      pinch = null;
      drag = null;
      if (view.scale <= 1.02) {
        view.scale = 1;
        view.x = 0;
        view.y = 0;
      } else {
        clampPan();
      }
      settle();
      return;
    }
    if (!drag) return;
    const { axis, dx, dy, pan } = drag;
    drag = null;
    box.classList.remove('dragging');
    if (pan) {
      clampPan();
      settle();
      return;
    }
    if (!axis) return;
    if (axis === 'x' && Math.abs(dx) >= NAV_TRIGGER) {
      reset();
      step(dx < 0 ? 1 : -1);
      return;
    }
    if (axis === 'y' && Math.abs(dy) >= DISMISS_TRIGGER) {
      dismiss({ x: view.x, y: view.y + Math.sign(dy) * window.innerHeight * DISMISS_THROW, scale: view.scale });
      return;
    }
    view.scale = 1;
    view.x = 0;
    view.y = 0;
    settle();
  };

  box.addEventListener('touchend', end);
  box.addEventListener('touchcancel', end);

  return { reset, isZoomed: () => view.scale > 1 };
}
