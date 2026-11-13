import { writeFileSync } from 'node:fs';

const BASE = 'https://www.statistik.at/verzeichnis/reglisten/';
const OUT = new URL('../src/core/bezirke.js', import.meta.url);
const STATE_IDS = ['burgenland', 'kaernten', 'niederoesterreich', 'oberoesterreich', 'salzburg', 'steiermark', 'tirol', 'vorarlberg'];

async function rows(file) {
  const res = await fetch(BASE + file);
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  return (await res.text()).split(/\r?\n/).filter((line) => /^\d/.test(line)).map((line) => line.split(';').map((v) => v.trim()));
}

const cleanName = (name) => name.replace(/\s*\((Stadt|Land)\)/, ' ($1)');

const bezirke = (await rows('polbezirke.csv'))
  .filter(([stateCode]) => stateCode !== '9')
  .map(([stateCode, , , name, code]) => ({ number: Number(code), name: cleanName(name), state: STATE_IDS[Number(stateCode) - 1] }));
const known = new Set(bezirke.map((b) => b.number));

const towns = new Map();
for (const [, name, code, , mainPostcode, otherPostcodes] of await rows('gemliste_knz.csv')) {
  const bezirk = Number(code.slice(0, 3));
  if (!known.has(bezirk)) continue;
  for (const postcode of [mainPostcode, ...(otherPostcodes ?? '').split(/\s+/)].filter((p) => /^\d{4}$/.test(p))) {
    if (!towns.has(postcode)) towns.set(postcode, new Map());
    const byBezirk = towns.get(postcode);
    if (!byBezirk.has(bezirk)) byBezirk.set(bezirk, { names: [], seats: 0 });
    const entry = byBezirk.get(bezirk);
    entry.names.push(name);
    if (postcode === mainPostcode) entry.seats++;
  }
}

const postcodes = {};
const ambiguous = {};
for (const [postcode, byBezirk] of [...towns].sort(([a], [b]) => a.localeCompare(b))) {
  const ranked = [...byBezirk].sort(([, a], [, b]) => b.seats - a.seats || b.names.length - a.names.length);
  postcodes[postcode] = ranked.length === 1 ? ranked[0][0] : ranked.map(([bezirk]) => bezirk);
  if (ranked.length > 1) ambiguous[postcode] = Object.fromEntries(ranked.map(([bezirk, { names }]) => [bezirk, names]));
}

writeFileSync(OUT, `export const BEZIRKE = ${JSON.stringify(bezirke)};

export const BEZIRK_BY_POSTCODE = ${JSON.stringify(postcodes)};

export const TOWNS_BY_POSTCODE = ${JSON.stringify(ambiguous)};
`);
console.log(`${bezirke.length} Bezirke, ${Object.keys(postcodes).length} postcodes, ${Object.keys(ambiguous).length} shared`);
