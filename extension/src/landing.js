const DEV_PORT = '5181';

if (location.hostname !== 'localhost' || location.port === DEV_PORT) {
  document.documentElement.dataset.rentradar = chrome.runtime.getManifest().version;

  window.addEventListener('message', async (event) => {
    if (event.source !== window || event.data?.type !== 'rentradar:open') return;
    try {
      if (await chrome.runtime.sendMessage('open-app')) return;
    } catch {}
    window.postMessage({ type: 'rentradar:stale' }, location.origin);
  });
}
