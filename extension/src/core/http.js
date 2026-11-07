const HEADERS = {
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'de-AT,de;q=0.9,en;q=0.8',
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(text) {
  return text?.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code) => {
    if (code[0] !== '#') return ENTITIES[code.toLowerCase()] ?? m;
    const n = code[1].toLowerCase() === 'x' ? Number.parseInt(code.slice(2), 16) : Number(code.slice(1));
    return Number.isFinite(n) ? String.fromCodePoint(n) : m;
  }) ?? text;
}

export async function fetchText(url, { retries = 2, timeout = 20000, accept, headers: customHeaders, full = false } = {}) {
  const headers = {
    ...HEADERS,
    ...(accept ? { Accept: accept } : {}),
    ...(customHeaders || {}),
  };
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeout), redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      const text = await res.text();
      return full ? { text, url: res.url, status: res.status } : text;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(1000 * (attempt + 1));
    }
  }
  throw lastErr;
}

export async function postJson(url, body, { retries = 2, timeout = 20000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { ...HEADERS, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeout),
      });
      if (!res.ok && res.status !== 400) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(1000 * (attempt + 1));
    }
  }
  throw lastErr;
}

export function htmlToText(html) {
  if (!html) return null;
  const text = decodeEntities(html
    .replace(/\r\n?/g, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, ''))
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text || null;
}

export function extractJsonObject(text, marker) {
  const start = text.indexOf(marker);
  if (start < 0) return null;
  const open = text.indexOf('{', start + marker.length);
  if (open < 0) return null;
  let depth = 0;
  let inString = false;
  let out = '';
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (ch === '\\') { out += text[++i]; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; out += ch; continue; }
    if (text.startsWith('undefined', i) && !/[\w$]/.test(text[i + 9] ?? '')) { out += 'null'; i += 8; continue; }
    out += ch;
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return JSON.parse(out);
  }
  return null;
}
