import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isReserved } from '../src/core/reserved.js';
import { dedupe } from '../src/core/dedup.js';

const wh = (title) => ({ source: 'willhaben', title });

test('detects the reserved marker willhaben advertisers put in the heading', () => {
  const titles = [
    'RESERVIERT - Helle 2-Zimmer-Wohnung in Leonding',
    '(reserviert) Charmante Altbauwohnung mit Terrasse',
    '***RESERVIERT*** Moderne 3-Zimmer-Neubauwohnung',
    'Schöne Obergeschoßwohnung mit eigenem Garten(RESERVIERT)',
    'Reserviert! Top renovierte Mietwohnung in Ruhelage',
    'Reserviert: Traumhaftes Wohnen mit XXL-Dachterrasse',
    'Attnang 3 Zimmerwohnung 75m² Top 3 EG Reserviert',
    'RESERVED - bright studio near the city centre',
  ];
  for (const title of titles) assert.equal(isReserved(wh(title)), true, title);
});

test('does not mistake other uses of the word for a reserved listing', () => {
  const titles = [
    'Helle 2-Zimmer-Wohnung mit reserviertem Stellplatz',
    'Reservierung jederzeit möglich - 3 Zimmer mit Balkon',
    'Wohnung mit reservierter Garage im Innenhof',
    'Sonnige Dachgeschosswohnung mit Terrasse',
  ];
  for (const title of titles) assert.equal(isReserved(wh(title)), false, title);
});

test('only flags willhaben listings', () => {
  assert.equal(isReserved({ source: 'immoscout', title: 'RESERVIERT - 2 Zimmer' }), false);
  assert.equal(isReserved(null), false);
  assert.equal(isReserved({ source: 'willhaben' }), false);
});

test('a group is reserved when any willhaben member says so', () => {
  const base = {
    type: 'apartment', price: 900, area: 60, rooms: 2, postcode: '1100', state: 'wien',
    city: 'Wien', images: [], extras: [], lat: 48.2, lng: 16.37, address: 'Teststraße 1, 1100 Wien',
  };
  const [group] = dedupe([
    { ...base, id: 'willhaben:1', source: 'willhaben', title: 'RESERVIERT - Helle 2-Zimmer-Wohnung Teststraße' },
  ]);
  assert.equal(group.reserved, true);
  assert.equal(group.sources[0].reserved, true);

  const [plain] = dedupe([
    { ...base, id: 'willhaben:2', source: 'willhaben', title: 'Helle 2-Zimmer-Wohnung Teststraße' },
  ]);
  assert.equal(plain.reserved, false);
  assert.equal(plain.sources[0].reserved, false);
});

test('the status from the detail page outranks the heading', () => {
  assert.equal(isReserved({ source: 'willhaben', title: '(reserviert) Maisonette', reserved: false }), false);
  assert.equal(isReserved({ source: 'willhaben', title: 'APARTMENT MAISONETTE WITH 2 SLEEPING ROOMS', reserved: true }), true);
});
