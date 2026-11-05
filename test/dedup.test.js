import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupe, streetOf } from '../src/dedup.js';

const COMMON = ['schöne', 'helle', 'moderne', 'ruhige', 'sanierte', 'balkon', 'loggia', 'altbau', 'neubau', 'erstbezug', 'unbefristet', 'garten', 'terrasse', 'zentrale', 'lage'];

function listing(fields) {
  return {
    source: 'willhaben',
    rooms: 2,
    postcode: '1100',
    address: null,
    lat: null,
    lng: null,
    agency: null,
    images: [],
    extras: [],
    ...fields,
    id: `${fields.source ?? 'willhaben'}:${fields.id}`,
  };
}

function filler(count = 240) {
  return Array.from({ length: count }, (_, i) => listing({
    id: `filler${i}`,
    source: ['willhaben', 'immoscout', 'rentola'][i % 3],
    title: `${COMMON[i % COMMON.length]} ${COMMON[(i * 7) % COMMON.length]} wohnung objekt${i}`,
    price: 500 + i * 3.37,
    area: 40 + (i % 90) + 0.13 * (i % 7),
    postcode: `1${String((i % 23) + 1).padStart(2, '0')}0`,
  }));
}

function groupsOf(fixtures) {
  const ids = new Set(fixtures.map((f) => f.id));
  return dedupe([...fixtures, ...filler()])
    .map((g) => g.sources.map((s) => s.id).filter((id) => ids.has(id)).sort())
    .filter((g) => g.length)
    .sort((a, b) => a[0].localeCompare(b[0]));
}

test('merges the same flat across portals', () => {
  const fixtures = [
    listing({ id: 'a', title: 'Altbau mit Charakter: 2-Zimmer + separate Küche | WG-geeignet', price: 877.02, area: 67 }),
    listing({ id: 'a', source: 'immoscout', title: 'Altbau mit Charakter: 2-Zimmer + separate Küche | WG-geeignet', price: 877.02, area: 66.94 }),
  ];
  assert.deepEqual(groupsOf(fixtures), [['immoscout:a', 'willhaben:a']]);
});

test('merges Rentola net-rent copies with inflated area into the gross listing', () => {
  const title = 'Sonniger Bezug an der Hütteldorferstrasse unbefristet';
  const fixtures = [
    listing({ id: 's', title, price: 968.34, area: 61, postcode: '1140' }),
    listing({ id: 's1', source: 'rentola', title, price: 968, area: 61, postcode: '1140', address: 'Matzingerstraße 8, 1140 Wien' }),
    listing({ id: 's2', source: 'rentola', title, price: 620, area: 61, postcode: '1140', address: '1140 Wien' }),
    listing({ id: 's3', source: 'rentola', title, price: 620, area: 85.54, postcode: '1140', address: 'Matzingerstraße 8, 1140 Wien' }),
  ];
  assert.deepEqual(groupsOf(fixtures), [['rentola:s1', 'rentola:s2', 'rentola:s3', 'willhaben:s']]);
});

test('merges a listing reposted on the same portal', () => {
  const title = 'Renovierte 68m² Wohnung barrierefrei begehbar im Erdgeschoss';
  const fixtures = [
    listing({ id: 'd1', title, price: 990, area: 68, postcode: '1030', address: 'Dietrichgasse, 1030 Wien' }),
    listing({ id: 'd2', title, price: 990, area: 68, postcode: '1030', address: 'Dietrichgasse, 1030 Wien' }),
  ];
  assert.deepEqual(groupsOf(fixtures), [['willhaben:d1', 'willhaben:d2']]);
});

test('keeps units of one project apart when the title is reused at different prices', () => {
  const title = '| PALAIS ROSE | BAUFELD 1 | MIETE | BEZUGSBEREIT';
  const address = 'Otto-Preminger-Straße, 1030 Wien';
  const fixtures = [
    listing({ id: 'p1', title, price: 1299, area: 57, postcode: '1030', address }),
    listing({ id: 'p2', title, price: 1329, area: 57, postcode: '1030', address }),
    listing({ id: 'p1', source: 'immoscout', title, price: 1299, area: 56.81, postcode: '1030', address }),
    listing({ id: 'p2', source: 'immoscout', title, price: 1329, area: 56.66, postcode: '1030', address }),
  ];
  assert.deepEqual(groupsOf(fixtures), [['immoscout:p1', 'willhaben:p1'], ['immoscout:p2', 'willhaben:p2']]);
});

test('does not merge generic titles on price coincidence', () => {
  const fixtures = [
    listing({ id: 'g1', title: 'Gemeindewohnung Direktvergabe', price: 670, area: 61, postcode: '1110' }),
    listing({ id: 'g2', source: 'immoscout', title: 'Gemeindewohnung Direktvergabe', price: 717, area: 69, postcode: '1110' }),
  ];
  assert.equal(groupsOf(fixtures).length, 2);
});

test('never merges across postcodes', () => {
  const title = 'Altbau mit Charakter: 2-Zimmer + separate Küche';
  const fixtures = [
    listing({ id: 'x', title, price: 877.02, area: 67, postcode: '1100' }),
    listing({ id: 'x', source: 'immoscout', title, price: 877.02, area: 67, postcode: '1150' }),
  ];
  assert.equal(groupsOf(fixtures).length, 2);
});

test('different streets outweigh a price and area coincidence', () => {
  const fixtures = [
    listing({ id: 'n', title: 'Ruhige Neubauwohnung mit Grünblick', price: 999, area: 60, postcode: '1210', address: 'Selma-Steinmetz-Gasse, 1210 Wien' }),
    listing({ id: 'n', source: 'immoscout', title: 'Sonnige Balkonwohnung mit Grünblick', price: 999, area: 60, postcode: '1210', address: 'Leopoldine-Padaurek-Straße, 1210 Wien' }),
  ];
  assert.equal(groupsOf(fixtures).length, 2);
});

test('tolerates a one-room disagreement when everything else matches', () => {
  const title = '2-3 - Zimmer-Wohnung mit ca. 65 m2 ab sofort zur Miete nahe U3 Enkplatz!';
  const fixtures = [
    listing({ id: 'r', title, price: 972.91, area: 65, rooms: 2, postcode: '1110' }),
    listing({ id: 'r', source: 'rentola', title, price: 973, area: 65, rooms: 3, postcode: '1110' }),
  ];
  assert.deepEqual(groupsOf(fixtures), [['rentola:r', 'willhaben:r']]);
});

test('keeps Rentola units apart when prices differ but are not net vs gross', () => {
  const title = 'Bright apartment near Vienna Main Station with balcony';
  const fixtures = [
    listing({ id: 'b1', source: 'rentola', title, price: 1300, area: 430, postcode: '1150' }),
    listing({ id: 'b2', source: 'rentola', title, price: 1350, area: 560, postcode: '1150' }),
  ];
  assert.equal(groupsOf(fixtures).length, 2);
});

test('extracts normalized street names', () => {
  assert.equal(streetOf('Sechshauser Straße, 1150 Wien'), 'sechshauserstrasse');
  assert.equal(streetOf('Simmeringer Hauptstr. 170, 1110 Wien'), 'simmeringerhauptstrasse');
  assert.equal(streetOf('Yellow! Taschenbücher, Garnisongasse 7, 1090 Wien'), 'garnisongasse');
  assert.equal(streetOf('1170 Wien'), null);
  assert.equal(streetOf('Wien, 10. Bezirk, Favoriten'), null);
});
