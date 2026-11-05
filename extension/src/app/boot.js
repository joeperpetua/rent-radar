try {
  const root = document.documentElement;
  const style = localStorage.getItem('rentradar-style') ?? 'styled';
  if (style === 'styled' || style === 'compact') root.dataset.style = style;
  const theme = localStorage.getItem('rentradar-theme');
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
} catch {
  document.documentElement.dataset.style = 'styled';
}
