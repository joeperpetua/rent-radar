import { applyLang, setLang } from './i18n.js';
import { initTheme } from './theme.js';

applyLang();
initTheme(document.getElementById('theme-toggle'));

document.getElementById('lang-switch').addEventListener('click', (event) => {
  const next = event.target.closest('[data-lang]')?.dataset.lang;
  if (next) setLang(next);
});
