const STRINGS = {
  de: {
    description: 'Eine breite Auswahl an Mietquellen in Österreich in einer Suche. Läuft lokal im Browser.',
    language: 'Sprache',
    darkMode: 'Dunkelmodus',
    browser: 'Browser',
    headline: 'Jede Mietwohnung Österreichs. Eine Suche.',
    lead: 'RentRadar durchsucht eine breite Auswahl an Quellen gleichzeitig, fasst Duplikate zusammen und merkt sich Preisänderungen.',
    installed: 'RentRadar ist installiert.',
    open: 'RentRadar öffnen',
    stale: 'Die Erweiterung wurde aktualisiert oder entfernt.',
    reload: 'Seite neu laden',
    unsupported: 'Dieser Browser kann RentRadar nicht ausführen. Wähle unten einen unterstützten.',
    copy: 'Kopieren',
    get: '{name} holen',
    'store.chrome': 'Im Chrome Web Store öffnen',
    'store.firefox': 'Bei Firefox Add-ons öffnen',
    'step.open': 'Die Store-Seite mit dem Button oben öffnen.',
    'step.auto': 'RentRadar öffnet sich nach der Installation von selbst.',
    'chrome.add': '„Hinzufügen“ {i:chevron-right} „Erweiterung hinzufügen“ klicken.',
    'chrome.tap': '„Hinzufügen“ {i:chevron-right} „Erweiterung hinzufügen“ tippen.',
    'firefox.add': '„Zu Firefox hinzufügen“ {i:chevron-right} „Hinzufügen“ klicken.',
    'firefox.tap': '„Zu Firefox hinzufügen“ {i:chevron-right} „Hinzufügen“ tippen.',
    'edge.note': 'In Edge zuerst „Erweiterungen aus anderen Stores zulassen“ bestätigen.',
    'kiwi.note': 'Kiwi wird nicht mehr weiterentwickelt. Quetta oder Vivaldi sind die bessere Wahl.',
    'vivaldi.desktop': 'Im Vivaldi-Menü „Desktop-Version“ aktivieren.',
    'vivaldi.note': 'Erweiterungen gibt es ab Vivaldi 8.2.',
    'fxa.note': 'Benötigt Firefox 128 oder neuer.',
    'orion.install': 'Orion aus dem App Store installieren und diese Seite darin öffnen.',
    'orion.enable': '{i:ellipsis} {i:chevron-right} Einstellungen {i:chevron-right} Erweiterungen: Firefox-Erweiterungen aktivieren.',
    f1: 'Alle Quellen',
    f1d: 'Portale, Genossenschaften und Maklerseiten in einer Liste, Duplikate zusammengeführt.',
    f2: 'Preisverlauf',
    f2d: 'Jede Preisänderung wird gespeichert. Neue und gesenkte Inserate fallen sofort auf.',
    f3: 'Nur lokal',
    f3d: 'Kein Konto, kein Server. Suchen und Favoriten bleiben in deinem Browser.',
    footer: 'Kontakt zu Anbietern läuft immer über das verlinkte Originalinserat.',
    privacy: 'Datenschutz',
    privacyTitle: 'Datenschutz · RentRadar Austria',
    privacyDescription: 'Datenschutzerklärung von RentRadar Austria.',
    back: 'Zurück zur Startseite',
  },
  en: {
    description: 'A wide pool of Austrian rental sources in one search. Runs locally in your browser.',
    language: 'Language',
    darkMode: 'Dark mode',
    browser: 'Browser',
    headline: 'Every rental in Austria. One search.',
    lead: 'RentRadar searches a wide pool of sources at once, merges duplicates and tracks price changes.',
    installed: 'RentRadar is installed.',
    open: 'Open RentRadar',
    stale: 'The extension was updated or removed.',
    reload: 'Reload page',
    unsupported: 'This browser can’t run RentRadar. Pick a supported one below.',
    copy: 'Copy',
    get: 'Get {name}',
    'store.chrome': 'Open in Chrome Web Store',
    'store.firefox': 'Open in Firefox Add-ons',
    'step.open': 'Open the store page with the button above.',
    'step.auto': 'RentRadar opens by itself once it’s installed.',
    'chrome.add': 'Click “Add to Chrome” {i:chevron-right} “Add extension”.',
    'chrome.tap': 'Tap “Add to Chrome” {i:chevron-right} “Add extension”.',
    'firefox.add': 'Click “Add to Firefox” {i:chevron-right} “Add”.',
    'firefox.tap': 'Tap “Add to Firefox” {i:chevron-right} “Add”.',
    'edge.note': 'In Edge, confirm “Allow extensions from other stores” first.',
    'kiwi.note': 'Kiwi is no longer developed. Quetta or Vivaldi are the better pick.',
    'vivaldi.desktop': 'Turn on “Desktop site” in the Vivaldi menu.',
    'vivaldi.note': 'Extensions need Vivaldi 8.2 or newer.',
    'fxa.note': 'Needs Firefox 128 or newer.',
    'orion.install': 'Install Orion from the App Store and open this page in it.',
    'orion.enable': '{i:ellipsis} {i:chevron-right} Settings {i:chevron-right} Extensions: turn on Firefox extension support.',
    f1: 'Every source',
    f1d: 'Portals, cooperatives and broker sites in one list, duplicates merged.',
    f2: 'Price history',
    f2d: 'Every price change is kept. New and reduced listings stand out.',
    f3: 'Local only',
    f3d: 'No account, no server. Searches and favourites stay in your browser.',
    footer: 'Contact with landlords and agents always goes through the linked original listing.',
    privacy: 'Privacy',
    privacyTitle: 'Privacy · RentRadar Austria',
    privacyDescription: 'Privacy policy of RentRadar Austria.',
    back: 'Back to the start page',
  },
};

const STORAGE_KEY = 'rentradar-lang';

export const LANGS = Object.keys(STRINGS);

function stored() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function preferred() {
  const saved = stored();
  if (LANGS.includes(saved)) return saved;
  const match = navigator.languages?.map((l) => l.slice(0, 2).toLowerCase()).find((l) => LANGS.includes(l));
  return match ?? 'en';
}

let lang = preferred();

export const getLang = () => lang;

export const t = (key, vars = {}) => STRINGS[lang][key].replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');

export function applyLang(next = lang) {
  lang = LANGS.includes(next) ? next : lang;
  document.documentElement.lang = lang;
  for (const el of document.querySelectorAll('[data-i18n-content]')) el.content = t(el.dataset.i18nContent);
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
  for (const el of document.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
  for (const el of document.querySelectorAll('[data-lang]')) el.setAttribute('aria-pressed', String(el.dataset.lang === lang));
}

export function setLang(next) {
  applyLang(next);
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {}
}
