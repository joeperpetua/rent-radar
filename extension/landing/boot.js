try {
  const theme = localStorage.getItem('rentradar-theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
} catch {}
