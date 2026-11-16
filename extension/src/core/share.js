import { fromBase64Url, gunzip, gzip, toBase64Url } from './bytes.js';

export const SHARE_BASE = 'https://joeperpetua.github.io/rent-radar/';
export const SHARE_FORMAT = 1;
export const MAX_SHARE_LENGTH = 65536;
export const SHARE_PAYLOAD = /^[A-Za-z0-9_-]+$/;

export class InvalidShare extends Error {
  constructor() {
    super('invalid share link');
  }
}

export const shareUrl = (payload) => `${SHARE_BASE}#l=${payload}`;

export const encodeShare = async (snapshot) => toBase64Url(await gzip(new TextEncoder().encode(JSON.stringify(snapshot))));

export async function decodeShare(payload) {
  if (typeof payload !== 'string' || payload.length > MAX_SHARE_LENGTH || !SHARE_PAYLOAD.test(payload)) throw new InvalidShare();
  try {
    return JSON.parse(new TextDecoder().decode(await gunzip(fromBase64Url(payload))));
  } catch {
    throw new InvalidShare();
  }
}
