export const STORES = {
  chrome: 'https://chromewebstore.google.com/detail/fbknlkhcgimpehjafnhgdceejiihibfi',
  firefox: 'https://addons.mozilla.org/firefox/addon/rentradar/',
};

export const GUIDES = {
  desktop: [
    { id: 'chromium', name: 'Chromium', store: 'chrome', steps: ['step.open', 'chrome.add'], note: 'edge.note' },
    { id: 'firefox', name: 'Firefox', store: 'firefox', steps: ['step.open', 'firefox.add'] },
  ],
  android: [
    { id: 'kiwi', name: 'Kiwi', store: 'chrome', steps: ['step.open', 'chrome.tap'], note: 'kiwi.note' },
    { id: 'quetta', name: 'Quetta', store: 'chrome', steps: ['step.open', 'chrome.tap'], get: 'https://www.quetta.net/' },
    { id: 'vivaldi', name: 'Vivaldi', store: 'chrome', steps: ['vivaldi.desktop', 'step.open', 'chrome.tap'], note: 'vivaldi.note', get: 'https://vivaldi.com/android/' },
    { id: 'firefox-android', name: 'Firefox', store: 'firefox', steps: ['step.open', 'firefox.tap'], note: 'fxa.note', get: 'https://www.mozilla.org/firefox/browsers/mobile/android/' },
  ],
  ios: [
    { id: 'orion', name: 'Orion', store: 'chrome', steps: ['orion.install', 'orion.enable', 'step.open', 'chrome.tap'], get: 'https://apps.apple.com/app/id1484498200' },
  ],
};

export function detect() {
  const ua = navigator.userAgent;
  const brands = navigator.userAgentData?.brands ?? [];
  const chromium = Number(brands.find((b) => b.brand === 'Chromium')?.version ?? ua.match(/Chrome\/(\d+)/)?.[1] ?? 0);
  const firefox = Number(ua.match(/Firefox\/(\d+)/)?.[1] ?? 0);
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);

  if (ios) return { platform: 'ios', guide: 'orion', supported: true };
  if (/Android/.test(ua)) {
    if (firefox) return { platform: 'android', guide: 'firefox-android', supported: firefox >= 128 };
    if (brands.some((b) => /Vivaldi/i.test(b.brand)) || /Vivaldi/.test(ua)) return { platform: 'android', guide: 'vivaldi', supported: true };
    return { platform: 'android', guide: 'kiwi', supported: true };
  }
  if (firefox) return { platform: 'desktop', guide: 'firefox', supported: firefox >= 128 };
  return { platform: 'desktop', guide: 'chromium', supported: chromium >= 116 };
}
