export const CATEGORIES = ['regular', 'council', 'cooperative', 'shared', 'swap'];

const normalize = (text) => (text ?? '')
  .toLowerCase()
  .replace(/ß/g, 'ss')
  .normalize('NFKD')
  .replace(/[̀-ͯ]/g, '');

const COUNCIL = /gemeinde ?-?wohnung|gemeindwohnung|gemeindebau|wiener wohnen|direktvergabe|wohn-?ticket|vormerkschein/;
const COOPERATIVE_SOURCES = new Set(['bwsg', 'oevw', 'nebau']);
const COOPERATIVE = /genossenschaft|gemeinnutzig/;
const COOPERATIVE_AGENCY = /genossenschaft|gemeinnutzig|\bgem\. gesellschaft|volkswohnungswerk|sozialbau|gesiba|heimbau|neues leben|familienwohnbau|wogem/;
const SHARED = /wg[- ]?zimmer|zimmer in .{0,30}\bwg\b|\bin (einer|unserer|meiner) .{0,20}\bwg\b|mitbewohner|wohngemeinschaft|room in (a |an )?(shared|flat|apartment)|flatshare|shared (flat|apartment)/;
const SWAP = /(^|[^a-z])(wohnungs)?tausch|tauschwohnung/;

export function classify(listing) {
  const title = normalize(listing.title);
  const text = `${title} ${normalize(listing.description)}`;
  const extras = new Set(listing.extras ?? []);
  const agency = normalize(listing.agency);
  const categories = new Set();

  const cooperative = COOPERATIVE_SOURCES.has(listing.source) || COOPERATIVE.test(text) || extras.has('COOPERATIVE_HOUSING') || extras.has('Genossenschaftswohnung') || COOPERATIVE_AGENCY.test(agency);
  if (cooperative) categories.add('cooperative');
  if (COUNCIL.test(text) || (extras.has('SOCIAL_HOUSING') && !cooperative)) categories.add('council');
  if (extras.has('Zimmer/WG') || SHARED.test(title)) categories.add('shared');
  if (SWAP.test(title)) categories.add('swap');
  return categories;
}

export function groupCategories(members) {
  const categories = new Set(members.flatMap((m) => [...classify(m)]));
  return categories.size ? [...categories] : ['regular'];
}

export function passesCategories(categories, selected) {
  return categories.every((c) => selected.includes(c));
}
