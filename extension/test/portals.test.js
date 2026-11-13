import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as derstandard from '../src/core/sources/derstandard.js';
import * as dibeo from '../src/core/sources/dibeo.js';
import * as findmyhome from '../src/core/sources/findmyhome.js';
import * as sn from '../src/core/sources/sn.js';
import { filterQuery } from '../src/core/sources/justimmo.js';
import { addV4Sources } from '../src/core/prefs.js';

const flight = (text) => `<script>self.__next_f.push([1,${JSON.stringify(text)}])</script>`;

test('derstandard reads entries and matching project units from the flight data', () => {
  const page = {
    __typename: 'PaginatedPropertyEntriesResponse',
    totalEntries: 2,
    entries: [{
      __typename: 'PropertyEntryResponse',
      id: '15277768',
      title: 'Zwei Zimmer beim Hundertwasserhaus',
      advertiser: { company: { name: 'Dr. Vospernik Immobilien GmbH' } },
      media: { images: [{ path: 'https://ic.ds.at/a/1.jpg' }, { path: 'https://ic.ds.at/a/2.jpg' }] },
      metaData: { publishedAt: '2026-10-30T21:10:00.000Z' },
      property: {
        areas: { details: [{ kind: 'LIVING_SPACE', value: 72 }, { kind: 'ROOM_COUNT', value: 2 }] },
        basics: { propertyType: 'APARTMENT' },
        costs: { details: [{ kind: 'DEPOSIT', text: '4800' }], main: { value: 1550, kind: 'BASE_RENT_PLUS_UTILITIES', type: 'GROSS' } },
        location: { city: 'Wien 3.,Landstraße', street: '', zipCode: '1030' },
      },
    }],
  };
  const group = {
    __typename: 'PropertyGroupWithPropertiesResponse',
    id: '15237530',
    location: { city: 'Wien', zipCode: '1220' },
    media: { images: [{ path: 'https://ic.ds.at/g/1.jpg' }] },
    properties: [
      { matching: true, property: { id: '15313553', title: 'Studio 38. Etage', property: { costs: { details: [{ kind: 'FREE_TEXT_PRICE', text: 'Finanzierungsbeitrag: € 28 373,13' }], main: { type: 'GROSS', value: 1150 } }, areas: { details: [{ kind: 'LIVING_SPACE', value: 34.17 }, { kind: 'ROOM_COUNT', value: 1 }] } } } },
      { matching: false, property: { id: '1', title: 'x', property: {} } },
    ],
  };
  const html = flight(`x{"properties":${JSON.stringify(page)}}y{"propertyGroups":[${JSON.stringify(group)}]}`);
  const { total, listings } = derstandard.parsePage(html);
  assert.equal(total, 2);
  assert.equal(listings.length, 2);
  const [a, b] = listings;
  assert.equal(a.url, 'https://immobilien.derstandard.at/detail/15277768');
  assert.deepEqual([a.price, a.area, a.rooms, a.deposit, a.postcode, a.district, a.city], [1550, 72, 2, 4800, '1030', 3, 'Wien']);
  assert.equal(a.agency, 'Dr. Vospernik Immobilien GmbH');
  assert.equal(a.images.length, 2);
  assert.deepEqual([b.id, b.price, b.area, b.deposit, b.postcode, b.images[0]], ['derstandard:15313553', 1150, 34.17, 28373.13, '1220', 'https://ic.ds.at/g/1.jpg']);
});

test('derstandard puts prefs in the search url', () => {
  assert.equal(
    derstandard.searchUrl({ minPrice: 500, maxPrice: 1000, minArea: 60, minRooms: 2 }, 'wien', 'mieten-wohnung', 3),
    'https://immobilien.derstandard.at/suche/wien/mieten-wohnung?priceFrom=500&priceTo=1000&areaFrom=60&roomCountFrom=2&page=3',
  );
});

test('dibeo builds api query and maps list items', () => {
  const url = new URL(dibeo.searchUrl({ states: ['wien', 'niederoesterreich'], maxPrice: 1000, minArea: 60 }, 'WOHNUNG', 2));
  assert.deepEqual(url.searchParams.getAll('locationSuggestions'), ['9:SUB_COUNTRY', '3:SUB_COUNTRY']);
  assert.deepEqual([url.searchParams.get('page'), url.searchParams.get('price.to'), url.searchParams.get('areaSize.from'), url.searchParams.get('legalForm')], ['2', '1000', '60', 'MIETE']);
  const l = dibeo.toListing({
    id: 2319520, minPrice: 2250, minArea: 97.43, minRoomsCount: 4, title: 'Familienwohnung', category: 'WOHNUNG', legalForm: 'MIETE',
    description: 'Sonnig<br>Ruhig', vendor: 'MAKLER', stateFrom: '2026-11-11T15:58:43Z', agentCompanyName: 'PR-Immobilien',
    location: { zip: '1140', municipality: 'Wien, Penzing' }, images: [{ title: 'terrasse', domain: 'https://asset.dibeo.at', path: '449/abc' }],
  });
  assert.deepEqual([l.url, l.price, l.area, l.rooms, l.postcode, l.district, l.city], ['https://www.dibeo.at/expose/2319520', 2250, 97.43, 4, '1140', 14, 'Wien']);
  assert.deepEqual(l.images, ['https://asset.dibeo.at/449/abc/big-jpeg/terrasse.jpeg']);
  assert.equal(l.description, 'Sonnig\nRuhig');
});

test('findmyhome parses result cards and detail data layer', () => {
  const cards = findmyhome.parseCards(`<div class="row margin-top-20"> <a href='/5769316?tl=1'><img src='https://www.immovosmanager.at/upload6/id29617/1.jpg' /></a>
<h3 class="obj_list"><a href='/5769316?tl=1' class='btnHeadlineErgebnisliste'>+++FERNSICHT! TEILM&amp;#214;BLIERTE ...</a></h3>
<p class="immobilie_description more margin-top-10"> Einzugsreife Neubauwohnung ... <a href='/5769316?tl=1'>Zum Detail</a></p>
<strong>Ort: 1100</strong> Wien 11., Simmering </div><div><strong>Mieten: </strong><br>821,- &euro; </div><div><strong>Fl&auml;che: </strong><br> 64 m&sup2; </div><div><strong>Zimmer: </strong><br> 2 </div>`);
  assert.deepEqual(cards.map((c) => [c.sourceId, c.postcode, c.price, c.area, c.rooms, c.title]), [['5769316', '1100', 821, 64, 2, '+++FERNSICHT! TEILMÖBLIERTE ...']]);
  const d = findmyhome.parseDetail(`<script> dataLayer = [{ 'event' : 'obj_view', 'Immo_Flaeche': '64', 'Immo_Zimmer': '2', 'Immo_Preis': '820.14', 'Immo_Lage': '1100', 'Immo_Objektart': 'Wohnung', 'Immo_Erwerbsart': 'Miete' }]; </script>
<h1> +++FERNSICHT! TEILM&#214;BLIERTE NEUBAUWOHNUNG mit gro&#223;em Balkon++++ - Objektnr. 5769316 </h1>
<img src="https://www.immovosmanager.at/upload6/id29617/1.jpg" class="sliderGal" /><img src="https://www.immovosmanager.at/upload6/id29617/2.jpg" class="sliderGal" />
<img src="https://media.findmyhome.at/md1/3/5778430/s2/other.jpg">`);
  assert.deepEqual([d.title, d.price, d.area, d.rooms, d.postcode, d.rent, d.images.length], ['+++FERNSICHT! TEILMÖBLIERTE NEUBAUWOHNUNG mit großem Balkon++++', 820.14, 64, 2, '1100', true, 2]);
});

test('sn reads bookmark data and ignores fallback suggestions on zero results', () => {
  const card = `<button class="btn js-bookmark-btn " data-id="H7LTX6" data-title="Wohnen mit Freiraum in 1230 Wien" data-url="/immobilien/wohnen-H7LTX6" data-price="€ 1.499,30 : ''" data-rooms="2" data-space="62" data-address="Hauptstraße 1, 1230 Wien" data-image="https://cmcdn.de/img-service/abc;safescale=130x100,crop=130x100">`;
  const { total, listings } = sn.parsePage(`<li class="breadcrumb-item active">4 Ergebnisse</li>${card}`);
  assert.equal(total, 4);
  assert.deepEqual([listings[0].url, listings[0].price, listings[0].area, listings[0].rooms, listings[0].postcode, listings[0].address], ['https://immo.sn.at/immobilien/wohnen-H7LTX6', 1499.3, 62, 2, '1230', 'Hauptstraße 1, 1230 Wien']);
  assert.equal(listings[0].images[0], 'https://cmcdn.de/img-service/abc;safescale=1200x900');
  assert.deepEqual(sn.parsePage(`<li class="breadcrumb-item active">Ihre Suche ergab keine Treffer.</li>${card}`), { total: 0, listings: [] });
});

test('justimmo pushes state, rent ceiling, area and rooms into the broker search', () => {
  const q = new URLSearchParams(filterQuery({ states: ['wien'], minPrice: 500, maxPrice: 1200, minArea: 60, minRooms: 2 }));
  assert.equal(q.get('f[living][federal_state]'), '134');
  assert.equal(q.get('f[living][price][max]'), '1200');
  assert.equal(q.get('f[living][price][min]'), null);
  assert.equal(q.get('f[living][sorting_area][min]'), '60');
  assert.equal(q.get('f[living][rooms][min]'), '2');
  assert.equal(new URLSearchParams(filterQuery({ states: ['wien', 'tirol'] })).get('f[living][federal_state]'), null);
});

test('searches with every previous source ticked get the new portals', () => {
  const all = ['willhaben', 'immoscout', 'cooperatives', 'justimmo', 'wunderflats', 'fify'];
  assert.deepEqual(addV4Sources({ sources: all }).sources, [...all, 'derstandard', 'dibeo', 'findmyhome', 'sn']);
  assert.deepEqual(addV4Sources({ sources: ['willhaben'] }).sources, ['willhaben']);
});

test('findmyhome makes protocol-relative gallery urls absolute', () => {
  const d = findmyhome.parseDetail('<img src="//media.findmyhome.at/md1/3/1/s1/a.png" class="sliderGal" />');
  assert.deepEqual(d.images, ['https://media.findmyhome.at/md1/3/1/s1/a.png']);
});

test('listedAt takes the earlier of first seen and published, ignoring first-scan discovery without a date', async () => {
  const { listedAt } = await import('../src/core/scan.js');
  const initial = { justimmo: '2026-11-01T00:00:00Z', willhaben: '2026-11-01T00:00:00Z' };
  assert.equal(listedAt([{ source: 'willhaben', publishedAt: '2026-10-20T00:00:00Z', firstSeen: '2026-11-01T00:00:00Z' }], initial), '2026-10-20T00:00:00Z');
  assert.equal(listedAt([{ source: 'willhaben', publishedAt: '2026-11-10T00:00:00Z', firstSeen: '2026-11-01T00:00:00Z' }], initial), '2026-11-01T00:00:00Z');
  assert.equal(listedAt([{ source: 'justimmo', firstSeen: '2026-11-05T00:00:00Z' }], initial), '2026-11-05T00:00:00Z');
  assert.equal(listedAt([{ source: 'justimmo', firstSeen: '2026-11-01T00:00:00Z' }], initial), null);
});

test('a re-post under a new id inherits the first-seen date of the removed original', async () => {
  const { listedAt, relatedHistory } = await import('../src/core/scan.js');
  const base = { source: 'willhaben', type: 'apartment', title: 'Sonnige Altbauwohnung Columbusgasse mit Fernblick und Einbauküche', address: 'Columbusgasse 12, 1100 Wien', postcode: '1100', state: 'wien', district: 10, price: 900, area: 60, rooms: 2, images: [] };
  const old = { ...base, id: 'willhaben:1', firstSeen: '2026-10-01T00:00:00Z', publishedAt: '2026-09-28T00:00:00Z', removed: true };
  const repost = { ...base, id: 'willhaben:2', firstSeen: '2026-11-10T00:00:00Z', publishedAt: '2026-11-10T00:00:00Z' };
  const words = ['altbau', 'neubau', 'garten', 'terrasse', 'loggia', 'ruhig', 'hell', 'modern', 'zentral', 'saniert'];
  const others = Array.from({ length: 120 }, (_, i) => ({ ...base, id: `willhaben:9${i}`, title: `${words[i % 10]} ${words[(i * 3) % 10]} wohnung objekt${i}`, address: null, postcode: `1${String((i % 23) + 1).padStart(2, '0')}0`, price: 500 + i * 7.3, area: 40 + (i % 80), firstSeen: '2026-11-01T00:00:00Z' }));
  const related = relatedHistory([repost, ...others], [old]);
  assert.deepEqual(related.get('willhaben:2')?.map((l) => l.id).sort(), ['willhaben:1', 'willhaben:2']);
  assert.equal(listedAt([repost, ...related.get('willhaben:2')], { willhaben: '2026-09-01T00:00:00Z' }), '2026-09-28T00:00:00Z');
});
