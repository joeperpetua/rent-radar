const RESERVED_TITLE = /\b(reserviert|reserved)\b/i;
const RESERVED_SOURCES = new Set(['willhaben']);

export function isReserved(listing) {
  if (!listing || !RESERVED_SOURCES.has(listing.source)) return false;
  if (typeof listing.reserved === 'boolean') return listing.reserved;
  return RESERVED_TITLE.test(listing.title ?? '');
}
