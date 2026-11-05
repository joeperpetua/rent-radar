const TIMEOUT_MS = 8000;
const MIN_CONFIDENCE = 0.6;
const MARKERS = {
  de: ['und', 'der', 'die', 'das', 'mit', 'ist', 'nicht', 'eine', 'ein', 'für', 'wohnung', 'zimmer', 'sich', 'auch', 'bei', 'sie', 'wird', 'zur'],
  en: ['the', 'and', 'with', 'is', 'not', 'for', 'apartment', 'flat', 'room', 'this', 'you', 'are', 'of', 'to', 'in', 'located'],
};

const translators = new Map();
const results = new Map();
let detectorPromise = null;

const withTimeout = (promise) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS)),
]);

export const translationSupported = () => 'Translator' in self;

export function guessLanguage(text) {
  const words = (text ?? '').toLowerCase().match(/\p{L}+/gu) ?? [];
  const score = Object.fromEntries(Object.entries(MARKERS).map(([lang, markers]) => {
    const set = new Set(markers);
    return [lang, words.filter((w) => set.has(w)).length];
  }));
  const [best, second] = Object.entries(score).sort((a, b) => b[1] - a[1]);
  return best[1] >= 3 && best[1] >= second[1] * 2 ? best[0] : null;
}

export async function detectLanguage(text) {
  if (!('LanguageDetector' in self)) return guessLanguage(text);
  try {
    detectorPromise ??= withTimeout(LanguageDetector.create());
    const detector = await detectorPromise;
    const [top] = await withTimeout(detector.detect(text.slice(0, 2000)));
    if (top && top.detectedLanguage !== 'und' && top.confidence >= MIN_CONFIDENCE) return top.detectedLanguage.split('-')[0];
  } catch {
    detectorPromise = null;
  }
  return guessLanguage(text);
}

export async function translationAvailability(source, target) {
  try {
    return await withTimeout(Translator.availability({ sourceLanguage: source, targetLanguage: target }));
  } catch {
    return 'unavailable';
  }
}

function translatorFor(source, target, onProgress) {
  const key = `${source}>${target}`;
  if (!translators.has(key)) {
    const created = Translator.create({
      sourceLanguage: source,
      targetLanguage: target,
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => onProgress?.(e.loaded));
      },
    });
    translators.set(key, created.catch((err) => {
      translators.delete(key);
      throw err;
    }));
  }
  return translators.get(key);
}

export async function translateText(text, source, target, onProgress) {
  const key = `${source}>${target}|${text}`;
  if (results.has(key)) return results.get(key);
  const translator = await translatorFor(source, target, onProgress);
  const parts = text.split(/(\n+)/);
  const translated = [];
  for (const part of parts) translated.push(part.trim() && !part.startsWith('\n') ? await translator.translate(part) : part);
  const result = translated.join('');
  results.set(key, result);
  return result;
}
