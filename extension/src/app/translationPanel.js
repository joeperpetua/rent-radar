import { getLang, locale, t } from './i18n.js';
import { detectLanguage, translateText, translationAvailability, translationSupported } from './translate.js';
import { $ } from './dom.js';

export async function setupTranslation(g) {
  const panel = $('#description-panel');
  if (!panel || !g.description || !translationSupported()) return;
  const target = getLang();
  const token = `${g.id}|${target}`;
  panel.dataset.token = token;
  const alive = () => panel.isConnected && panel.dataset.token === token;

  const source = await detectLanguage(g.description);
  if (!alive() || !source || source === target) return;
  const availability = await translationAvailability(source, target);
  if (!alive() || availability === 'unavailable') return;

  const text = $('#description-text', panel);
  const button = $('#translate-btn', panel);
  const note = $('#translate-note', panel);
  const names = new Intl.DisplayNames([locale()], { type: 'language' });
  let translated = null;
  let showingTranslation = false;

  const show = (translation) => {
    showingTranslation = translation;
    text.textContent = translation ? translated : g.description;
    button.textContent = translation ? t('showOriginal') : t('translateTo', { lang: names.of(target) });
    note.textContent = translation ? t('translatedFrom', { lang: names.of(source) }) : '';
  };

  const run = async () => {
    button.disabled = true;
    note.textContent = t('translating');
    try {
      translated = await translateText(g.description, source, target, (loaded) => {
        if (alive()) note.textContent = t('downloadingModel', { pct: Math.round(loaded * 100) });
      });
      if (alive()) show(true);
    } catch {
      if (alive()) note.textContent = t('translateFailed');
    } finally {
      button.disabled = false;
    }
  };

  button.addEventListener('click', () => {
    if (showingTranslation) show(false);
    else if (translated) show(true);
    else run();
  });
  show(false);
  button.hidden = false;
  if (availability === 'available') run();
}
