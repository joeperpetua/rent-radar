const SWEEP_MS = 6000;
const COLORS = 5;
const START_BLIPS = 6;
const BLIPS_PER_SWEEP = 3;
const MAX_BLIPS = 28;

export function startRadar(scope) {
  scope.style.setProperty('--sweep', `${SWEEP_MS}ms`);
  const layer = scope.querySelector('.scope-blips');
  const sweep = scope.querySelector('.scope-sweep');

  const addBlip = () => {
    const angle = Math.random() * 360;
    const radius = 12 + Math.random() * 34;
    const rad = (angle * Math.PI) / 180;
    const phase = Number(sweep.getAnimations()[0]?.currentTime ?? 0) % SWEEP_MS;
    const delay = ((((angle / 360) * SWEEP_MS - phase) % SWEEP_MS) + SWEEP_MS) % SWEEP_MS - SWEEP_MS;
    const blip = document.createElement('span');
    blip.className = `blip c${1 + Math.floor(Math.random() * COLORS)}`;
    blip.style.left = `${50 + radius * Math.sin(rad)}%`;
    blip.style.top = `${50 - radius * Math.cos(rad)}%`;
    blip.style.animationDelay = `${Math.round(delay + SWEEP_MS)}ms, ${Math.round(delay)}ms`;
    layer.append(blip);
  };

  for (let i = 0; i < START_BLIPS; i++) addBlip();
  const timer = setInterval(() => {
    for (let i = 0; i < BLIPS_PER_SWEEP; i++) addBlip();
    if (layer.childElementCount >= MAX_BLIPS) clearInterval(timer);
  }, SWEEP_MS);
}
