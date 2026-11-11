const STORAGE_KEY = 'rentradar-theme';
const root = document.documentElement;
const system = matchMedia('(prefers-color-scheme: dark)');

const isDark = () => (root.dataset.theme ? root.dataset.theme === 'dark' : system.matches);

export function initTheme(button) {
  const sync = () => button.setAttribute('aria-pressed', String(isDark()));
  sync();
  system.addEventListener('change', sync);
  button.addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark';
    root.dataset.theme = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {}
    sync();
  });
}
