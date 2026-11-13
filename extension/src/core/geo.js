export const DISTRICTS = [
  'Innere Stadt', 'Leopoldstadt', 'Landstraße', 'Wieden', 'Margareten', 'Mariahilf',
  'Neubau', 'Josefstadt', 'Alsergrund', 'Favoriten', 'Simmering', 'Meidling',
  'Hietzing', 'Penzing', 'Rudolfsheim-Fünfhaus', 'Ottakring', 'Hernals', 'Währing',
  'Döbling', 'Brigittenau', 'Floridsdorf', 'Donaustadt', 'Liesing',
].map((name, i) => ({ number: i + 1, name, postcode: `1${String(i + 1).padStart(2, '0')}0` }));

export const STATES = [
  { id: 'wien', name: 'Wien', willhaben: 900, immoscout: '009', immoscoutPath: 'wien/wien' },
  { id: 'niederoesterreich', name: 'Niederösterreich', willhaben: 3, immoscout: '003', immoscoutPath: 'niederoesterreich' },
  { id: 'burgenland', name: 'Burgenland', willhaben: 1, immoscout: '001', immoscoutPath: 'burgenland' },
  { id: 'oberoesterreich', name: 'Oberösterreich', willhaben: 4, immoscout: '004', immoscoutPath: 'oberoesterreich' },
  { id: 'salzburg', name: 'Salzburg', willhaben: 5, immoscout: '005', immoscoutPath: 'salzburg' },
  { id: 'steiermark', name: 'Steiermark', willhaben: 6, immoscout: '006', immoscoutPath: 'steiermark' },
  { id: 'kaernten', name: 'Kärnten', willhaben: 2, immoscout: '002', immoscoutPath: 'kaernten' },
  { id: 'tirol', name: 'Tirol', willhaben: 7, immoscout: '007', immoscoutPath: 'tirol' },
  { id: 'vorarlberg', name: 'Vorarlberg', willhaben: 8, immoscout: '008', immoscoutPath: 'vorarlberg' },
];

const STATE_BY_ID = new Map(STATES.map((s) => [s.id, s]));
const STATE_BY_NAME = new Map(STATES.map((s) => [s.name.toLowerCase(), s.id]));
const STATE_BY_IMMOSCOUT = new Map(STATES.map((s) => [s.immoscout, s.id]));

export const stateById = (id) => STATE_BY_ID.get(id) ?? null;
export const stateIdFromName = (name) => STATE_BY_NAME.get((name ?? '').trim().toLowerCase()) ?? null;
export const stateIdFromImmoscoutCode = (code) => STATE_BY_IMMOSCOUT.get(code) ?? null;

export function searchRegions(states) {
  return states?.length ? states.map(stateById).filter(Boolean) : [null];
}

export function stateFromPostcode(postcode) {
  const n = Number(postcode);
  if (!Number.isInteger(n) || n < 1000 || n > 9999) return null;
  if (n < 1300) return 'wien';
  if (n < 4000) return 'niederoesterreich';
  if (n < 5000) return 'oberoesterreich';
  if (n < 5800) return 'salzburg';
  if (n < 6700) return 'tirol';
  if (n < 7000) return 'vorarlberg';
  if (n < 8000) return 'burgenland';
  if (n < 9000) return 'steiermark';
  if (n < 9900) return 'kaernten';
  return 'tirol';
}

export function districtFromPostcode(postcode) {
  const m = /^1(\d{2})0$/.exec(postcode ?? '');
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 23 ? n : null;
}

export function findPostcode(text) {
  if (!text) return null;
  return /\b([1-9]\d{3})[,\s-]+(?!(?:Euro|EUR|m2|m²|qm|monat|monatlich|brutto|netto|kaution)\b)\p{L}/ui.exec(text)?.[1]
    || /\(([1-9]\d{3})\)/.exec(text)?.[1]
    || null;
}

export function cityFromAddress(text) {
  if (!text) return null;
  const city = /\b[1-9]\d{3}[,\s-]+([^,()]+)/u.exec(text)?.[1]?.trim()
    || /([^,()]+)\s+\([1-9]\d{3}\)/u.exec(text)?.[1]?.trim();
  return city ? city.replace(/^Vienna$/i, 'Wien') : null;
}

export function haversineMeters(a, b) {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function toNumber(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const cleaned = String(value).replace(/[^\d,.-]/g, '');
  const normalized = /,\d{1,2}$/.test(cleaned) ? cleaned.replace(/\./g, '').replace(',', '.') : cleaned.replace(/,/g, '');
  const n = Number.parseFloat(normalized);
  return Number.isFinite(n) ? n : null;
}

export function financingContribution(text) {
  const m = /Finanzierungsbeitrag[^0-9]*?(\d{1,3}(?:[.\s  ]\d{3})+(?:,\d{1,2})?|\d+(?:,\d{1,2})?)/i.exec(text ?? '');
  const n = m ? toNumber(m[1]) : null;
  return n > 0 ? n : null;
}
