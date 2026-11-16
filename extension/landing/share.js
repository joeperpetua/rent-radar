const SHARE_ROUTE = /^#l=([A-Za-z0-9_-]{1,65536})$/;

export const sharedPayload = (hash = location.hash) => SHARE_ROUTE.exec(hash)?.[1] ?? null;

const fromBase64Url = (text) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

export async function decodeShare(payload) {
  const stream = new Blob([fromBase64Url(payload)]).stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text());
}

const httpsUrl = (v) => typeof v === 'string' && /^https:\/\//i.test(v);
const number = (v) => (Number.isFinite(v) && v > 0 ? v : null);
const text = (v) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() || null : null);

export function teaser(snapshot) {
  const listings = (Array.isArray(snapshot?.listings) ? snapshot.listings : []).map((l) => l?.data).filter((d) => d && typeof d.title === 'string');
  const [first] = listings;
  if (!first) return null;
  const pick = (key, clean) => listings.map((l) => clean(l[key])).find((v) => v != null) ?? null;
  return {
    title: first.title.trim(),
    price: number(first.price) ?? pick('price', number),
    area: pick('area', number),
    rooms: pick('rooms', number),
    place: [pick('postcode', text), pick('city', text)].filter(Boolean).join(' ') || pick('address', text),
    photo: listings.flatMap((l) => (Array.isArray(l.images) ? l.images : [])).find(httpsUrl) ?? null,
  };
}
