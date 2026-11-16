const DEV_PORT = '5181';
const APP_PATH = 'app/index.html';
const ANSWER_MS = 1500;
const NAVIGATE_MS = 2000;
const SHARE = /^[A-Za-z0-9_-]{1,65536}$/;

if (location.hostname !== 'localhost' || location.port === DEV_PORT) {
  document.documentElement.dataset.rentradar = chrome.runtime.getManifest().version;

  const alive = () => Boolean(chrome.runtime?.id);

  const ask = async (message) => {
    try {
      return await Promise.race([
        chrome.runtime.sendMessage(message),
        new Promise((resolve) => { setTimeout(resolve, ANSWER_MS, false); }),
      ]);
    } catch {
      return false;
    }
  };

  const stale = () => window.postMessage({ type: 'rentradar:stale' }, location.origin);

  window.addEventListener('message', async (event) => {
    if (event.source !== window || event.data?.type !== 'rentradar:open') return;
    const share = typeof event.data.share === 'string' && SHARE.test(event.data.share) ? event.data.share : null;
    if (alive() && await ask({ type: 'open-app', share }) !== false) return;
    if (!alive()) return stale();
    location.assign(chrome.runtime.getURL(APP_PATH) + (share ? `#/s/${share}` : ''));
    setTimeout(stale, NAVIGATE_MS);
  });
}
