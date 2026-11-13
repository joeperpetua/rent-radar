import { getLang, locale, t } from './i18n.js';
import { detectLanguage, translateText, translationAvailability, translationSupported } from './translate.js';
import { sectionsHtml, splitItem } from './sections.js';
import { $ } from './dom.js';

const translatable = (text) => /\p{L}/u.test(text) && !/\d/.test(text);

async function translateSections(sections, source, target, onProgress) {
  const one = (text) => (translatable(text) ? translateText(text, source, target, onProgress) : text);
  const translated = [];
  for (const section of sections) {
    const items = [];
    for (const item of section.items) {
      const [key, value] = splitItem(item);
      items.push(key ? `${await one(key)}: ${await one(value)}` : await one(value));
    }
    translated.push({ title: await one(section.title), items });
  }
  return translated;
}

export async function setupTranslation(g) {
  const panel = $('#description-panel');
  const sections = g.sections ?? [];
  if (!panel || !(g.description || sections.length) || !translationSupported()) return;
  const target = getLang();
  const token = `${g.id}|${target}|${sections.length}`;
  panel.dataset.token = token;
  const alive = () => panel.isConnected && panel.dataset.token === token;

  const sample = [g.description, ...sections.flatMap((s) => [s.title, ...s.items])].filter(Boolean).join('\n');
  const source = await detectLanguage(sample);
  if (!alive() || !source || source === target) return;
  const availability = await translationAvailability(source, target);
  if (!alive() || availability === 'unavailable') return;

  const text = $('#description-text', panel);
  const button = $('#translate-btn', panel);
  const note = $('#translate-note', panel);
  const box = $('#detail-sections');
  const names = new Intl.DisplayNames([locale()], { type: 'language' });
  let translated = null;
  let showingTranslation = false;

  const show = (translation) => {
    showingTranslation = translation;
    text.textContent = (translation && translated.description) || g.description || t('noDescription');
    if (box && sections.length) box.innerHTML = sectionsHtml(translation ? translated.sections : sections);
    button.textContent = translation ? t('showOriginal') : t('translateTo', { lang: names.of(target) });
    note.textContent = translation ? t('translatedFrom', { lang: names.of(source) }) : '';
  };

  const run = async () => {
    button.disabled = true;
    note.textContent = t('translating');
    const onProgress = (loaded) => {
      if (alive()) note.textContent = t('downloadingModel', { pct: Math.round(loaded * 100) });
    };
    try {
      translated = {
        description: g.description ? await translateText(g.description, source, target, onProgress) : null,
        sections: await translateSections(sections, source, target, onProgress),
      };
      if (alive()) show(true);
    } catch {
      if (alive()) note.textContent = t('translateFailed');
    } finally {
      button.disabled = false;
    }
  };

  button.onclick = () => {
    if (showingTranslation) show(false);
    else if (translated) show(true);
    else run();
  };
  show(false);
  button.hidden = false;
  if (availability === 'available') run();
}
