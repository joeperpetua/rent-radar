import { getLang, t } from './i18n.js';
import { TRANSIT_MODES, rateLocation, ratingAvailability, ratingSupported, walkMinutes } from './location.js';
import { translateText, translationSupported } from './translate.js';
import { $ } from './dom.js';
import { esc, num } from './format.js';

const RATING_SCORES = ['transit', 'everyday', 'green'];

function ratingHtml(r) {
  const bar = (key, score) => `
    <li>
      <span>${esc(t(`rating.${key}`))}</span>
      <span class="rating-bar"><i style="width:${score * 10}%"></i></span>
      <b>${score}</b>
    </li>`;
  const stops = r.nearby ? TRANSIT_MODES.map((mode) => {
    const stop = r.nearby[mode][0];
    return stop && `<li><span class="mode">${esc(t(`mode.${mode}`))}</span><span>${esc(stop.name ?? '–')}</span><span class="dist">${esc(t('walk', { m: num(stop.m), min: walkMinutes(stop.m) }))}</span></li>`;
  }).filter(Boolean) : [];
  return `
    <div class="rating-overall"><b>${r.overall}</b><span>/10</span></div>
    <ul class="rating-bars">${RATING_SCORES.map((k) => bar(k, r[k])).join('')}</ul>
    <p class="rating-summary">${esc(r.summary)}</p>
    ${stops.length ? `<ul class="rating-stops">${stops.join('')}</ul>` : ''}`;
}

export async function setupRating(g) {
  const box = $('#rating');
  if (!box || !ratingSupported()) return;
  const target = getLang();
  const token = `${g.id}|${target}`;
  box.dataset.token = token;
  const alive = () => box.isConnected && box.dataset.token === token;

  const { availability, outputLang } = await ratingAvailability(target);
  if (!alive() || availability === 'unavailable') return;

  const body = $('#rating-body', box);
  const button = $('#rating-btn', box);
  const note = $('#rating-note', box);
  box.hidden = false;

  const run = async () => {
    button.hidden = true;
    note.textContent = t('rating.running');
    try {
      const result = await rateLocation(g, outputLang, (loaded) => {
        if (alive()) note.textContent = t('downloadingModel', { pct: Math.round(loaded * 100) });
      });
      let summary = result.summary;
      if (outputLang !== target && translationSupported()) {
        summary = await translateText(summary, outputLang, target).catch(() => summary);
      }
      if (!alive()) return;
      body.innerHTML = ratingHtml({ ...result, summary });
      note.textContent = t(`rating.source.${result.mapData}`);
    } catch {
      if (!alive()) return;
      note.textContent = t('rating.failed');
      button.hidden = false;
    }
  };

  button.addEventListener('click', run);
  if (availability === 'available') run();
  else button.hidden = false;
}
