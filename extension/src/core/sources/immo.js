import { BROKERS as JUSTIMMO_BROKERS, searchBroker as searchJustimmo } from './justimmo.js';
import { BROKERS as FIFY_BROKERS, searchBroker as searchFify } from './fify.js';
import { search as searchImmomarktplatz } from './immomarktplatz.js';

export const id = 'immo';
export const label = 'Immo';
export const kind = 'broker';

export const SITES = [
  ...JUSTIMMO_BROKERS.map((b) => ({ id: b.id, name: b.name, run: (prefs, options) => searchJustimmo(b, prefs, options) })),
  ...FIFY_BROKERS.map((b) => ({ id: b.id, name: b.name, run: (prefs, options) => searchFify(b, prefs, options) })),
  { id: 'immomarktplatz', name: 'Immomarktplatz', run: searchImmomarktplatz },
];

export async function search(prefs, { onProgress = () => {}, stored, sites = SITES } = {}) {
  const counts = new Map();
  let partial = false;
  let failed = 0;
  const results = await Promise.all(sites.map(async (site) => {
    try {
      const result = await site.run(prefs, {
        stored,
        onProgress: (n) => {
          counts.set(site.id, n);
          onProgress([...counts.values()].reduce((a, b) => a + b, 0));
        },
      });
      const { listings, partial: sitePartial = false } = Array.isArray(result) ? { listings: result } : result;
      partial ||= sitePartial;
      return listings;
    } catch (err) {
      console.warn(`[immo] ${site.name} failed:`, err?.message);
      partial = true;
      failed++;
      return [];
    }
  }));
  const listings = results.flat();
  if (failed === sites.length) throw new Error('all Immo sites failed');
  return { listings, partial };
}
