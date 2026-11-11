const BROKERS = {
  'immocontract.at': ['immocontract', 'IMMOcontract'],
  'lebenswert-wohnen.at': ['lebenswert', 'Lebenswert Wohnen'],
  'novel-real.at': ['novelreal', 'Novel Real'],
  'wohnreich.at': ['wohnreich', 'Wohnreich'],
  'immovent.at': ['immovent', 'Immovent'],
  'realbrokers.at': ['realbrokers', 'Realbrokers'],
  'edlauer.com': ['edlauer', 'Edlauer'],
};
const BROKER_NAMES = Object.fromEntries(Object.values(BROKERS));
const SITE_SOURCES = { bwsg: 'bwsg', 'övw': 'oevw', oevw: 'oevw', nebau: 'nebau' };

export const LEGACY_SOURCE_IDS = ['justimmo', 'fify', 'cooperatives', ...Object.keys(BROKER_NAMES)];

const toImmo = (broker, sourceId) => ({ id: `immo:${broker}:${sourceId}`, source: 'immo', sourceId: `${broker}:${sourceId}`, sourceName: BROKER_NAMES[broker] });

export function migrateListingId(id) {
  const split = /^([a-z]+):(.+)$/.exec(id ?? '');
  if (!split) return null;
  const [, prefix, rest] = split;
  if (BROKER_NAMES[prefix]) return toImmo(prefix, rest);
  if (!['justimmo', 'fify', 'cooperatives'].includes(prefix)) return null;
  const sep = rest.indexOf('_');
  if (sep < 0) return null;
  const key = rest.slice(0, sep);
  const sourceId = rest.slice(sep + 1);
  if (!sourceId) return null;
  if (prefix === 'cooperatives') {
    const source = SITE_SOURCES[key];
    return source ? { id: `${source}:${sourceId}`, source, sourceId } : null;
  }
  const broker = BROKERS[key]?.[0];
  return broker ? toImmo(broker, sourceId) : null;
}
