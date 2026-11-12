import { $ } from './dom.js';
import { activeSearch, api, isQueued, isScanning, state } from './state.js';
import { currentRoute } from './router.js';

const PULL_TRIGGER = 72;
const PULL_MAX = 110;
const PULL_RESISTANCE = 0.5;
const PULL_SETTLE_MS = 700;
const PULL_FADE_IN = 24;
const PULL_LEAVE_MS = 500;

export function bindPullToRefresh() {
  const indicator = $('#pull');
  const phone = matchMedia('(max-width: 600px)');
  let start = null;
  let distance = 0;
  let leaveTimer = 0;
  const busy = () => {
    const search = activeSearch();
    return !search || isScanning(search.id) || isQueued(search.id);
  };
  const canPull = () => phone.matches && currentRoute() === 'list' && !document.body.classList.contains('drawer-open')
    && !state.lightbox && window.scrollY <= 0 && !indicator.classList.contains('refreshing');
  const draw = () => {
    const shift = Math.min(distance, PULL_MAX);
    indicator.style.top = `${Math.round($('.topbar').getBoundingClientRect().bottom)}px`;
    indicator.style.setProperty('--pull', `${shift}px`);
    indicator.style.setProperty('--turn', `${Math.round((shift / PULL_TRIGGER) * 270)}deg`);
    indicator.style.setProperty('--show', Math.min(1, shift / PULL_FADE_IN).toFixed(2));
    indicator.classList.toggle('ready', distance >= PULL_TRIGGER && !busy());
  };
  const reset = () => {
    const spinning = indicator.classList.contains('refreshing');
    distance = 0;
    clearTimeout(leaveTimer);
    indicator.classList.toggle('leaving', spinning);
    indicator.classList.remove('pulling', 'refreshing', 'ready');
    draw();
    if (spinning) leaveTimer = setTimeout(() => indicator.classList.remove('leaving'), PULL_LEAVE_MS);
  };
  document.addEventListener('touchstart', (e) => {
    start = e.touches.length === 1 && canPull() ? e.touches[0].clientY : null;
    distance = 0;
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (start == null) return;
    const dy = e.touches[0].clientY - start;
    if (!indicator.classList.contains('pulling') && (dy <= 0 || window.scrollY > 0 || !e.cancelable)) {
      start = null;
      return;
    }
    if (e.cancelable) e.preventDefault();
    distance = Math.max(0, dy) * PULL_RESISTANCE;
    clearTimeout(leaveTimer);
    indicator.classList.remove('leaving');
    indicator.classList.add('pulling');
    draw();
  }, { passive: false });
  const end = async () => {
    if (start == null) return;
    start = null;
    indicator.classList.remove('pulling');
    if (distance < PULL_TRIGGER || busy()) {
      reset();
      return;
    }
    indicator.classList.add('refreshing');
    distance = PULL_TRIGGER * 0.8;
    draw();
    await api('scan', { id: state.activeId }).catch(() => {});
    setTimeout(reset, PULL_SETTLE_MS);
  };
  document.addEventListener('touchend', end);
  document.addEventListener('touchcancel', end);
}
