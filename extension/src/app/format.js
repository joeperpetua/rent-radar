import { getLang, locale, t } from './i18n.js';

const BYTE_UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte'];
const formatters = new Map();

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function formatter(digits, currency) {
  const key = `${locale()}|${digits}|${currency}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale(), currency
      ? { style: 'currency', currency: 'EUR', maximumFractionDigits: digits, minimumFractionDigits: digits }
      : { maximumFractionDigits: digits });
    formatters.set(key, f);
  }
  return f;
}

export const euro = (n, digits = 0) => (n == null ? '–' : formatter(digits, true).format(n));
export const num = (n, digits = 0) => (n == null ? '–' : formatter(digits, false).format(n));
export const signedEuro = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${euro(Math.abs(n), Number.isInteger(n) ? 0 : 2)}`;

export function fmtBytes(bytes) {
  if (bytes == null) return '–';
  let n = bytes;
  let i = 0;
  while (n >= 1000 && i < BYTE_UNITS.length - 1) {
    n /= 1000;
    i++;
  }
  return new Intl.NumberFormat(locale(), { style: 'unit', unit: BYTE_UNITS[i], unitDisplay: 'short', maximumFractionDigits: i < 2 ? 0 : 1 }).format(n);
}

export const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' }) : '–');
export const fmtDay = (iso) => (iso ? new Date(iso).toLocaleDateString(locale(), { day: 'numeric', month: 'short' }) : '–');

export function relTime(iso) {
  if (!iso) return '–';
  const diff = (Date.now() - Date.parse(iso)) / 1000;
  const rtf = new Intl.RelativeTimeFormat(getLang(), { numeric: 'auto' });
  if (diff < 60) return t('justNow');
  if (diff < 3600) return rtf.format(-Math.round(diff / 60), 'minute');
  if (diff < 86400) return rtf.format(-Math.round(diff / 3600), 'hour');
  return rtf.format(-Math.round(diff / 86400), 'day');
}

export function clock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
