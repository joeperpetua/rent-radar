import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as wunderflats from '../src/core/sources/wunderflats.js';
import * as cooperatives from '../src/core/sources/cooperatives.js';
import * as justimmo from '../src/core/sources/justimmo.js';
import * as immo from '../src/core/sources/immo.js';
import * as immomarktplatz from '../src/core/sources/immomarktplatz.js';
import * as fify from '../src/core/sources/fify.js';

test('wunderflats parses embedded state from HTML with exact area and EUR price', () => {
  const fixture = `
    <!DOCTYPE html>
    <html>
      <head>
        <script type="application/json">
          {
            "pageData": {
              "listingResults": {
                "items": [
                  {
                    "_id": "64a1b2c3d4e5f6",
                    "title": { "de": "Sonnige Altbauwohnung nahe Westbahnhof", "en": "Sunny Flat" },
                    "price": 184900,
                    "area": 55.5,
                    "rooms": 2,
                    "availableFrom": "2026-12-01T00:00:00.000Z",
                    "address": {
                      "street": "Mariahilfer Straße 120",
                      "city": "Vienna",
                      "location": { "coordinates": [16.3412, 48.1965] }
                    },
                    "images": [
                      { "urls": { "large": "https://listingimages.wunderflats.com/photo1.jpg" } }
                    ]
                  }
                ]
              }
            }
          }
        </script>
      </head>
      <body></body>
    </html>
  `;

  const results = wunderflats.parseListings(fixture);
  assert.equal(results.length, 1);
  const l = results[0];
  assert.equal(l.id, 'wunderflats:64a1b2c3d4e5f6');
  assert.equal(l.source, 'wunderflats');
  assert.equal(l.title, 'Sonnige Altbauwohnung nahe Westbahnhof');
  assert.equal(l.price, 1849);
  assert.equal(l.area, 55.5);
  assert.equal(l.rooms, 2);
  assert.equal(l.city, 'Wien');
  assert.equal(l.state, 'wien');
  assert.equal(l.lat, 48.1965);
  assert.equal(l.lng, 16.3412);
  assert.deepEqual(l.images, ['https://listingimages.wunderflats.com/photo1.jpg']);
  assert.equal(l.sourceHost, 'wunderflats.com');
});

test('brokers run under one Immo source, cooperatives stay separate', () => {
  assert.deepEqual([immo.id, immo.label, immo.kind], ['immo', 'Immo', 'broker']);
  assert.deepEqual(immo.SITES.map((s) => s.id), ['immocontract', 'lebenswert', 'novelreal', 'wohnreich', 'immovent', 'realbrokers', 'edlauer', 'immomarktplatz']);
  assert.deepEqual(cooperatives.sources.map((s) => [s.id, s.label, s.kind]), [['bwsg', 'BWSG', 'cooperative'], ['oevw', 'ÖVW', 'cooperative'], ['nebau', 'NEBAU', 'cooperative']]);
});

test('Immo merges its sites, marks the run partial when one fails, and fails only when all do', async () => {
  const ok = (id, n) => ({ id, name: id, run: async (prefs, { onProgress }) => { onProgress(n); return Array.from({ length: n }, (_, i) => ({ id: `immo:${id}:${i}` })); } });
  const bad = (id) => ({ id, name: id, run: async () => { throw new Error('down'); } });
  const progress = [];
  const merged = await immo.search({}, { sites: [ok('a', 2), ok('b', 1)], onProgress: (n) => progress.push(n) });
  assert.deepEqual([merged.listings.length, merged.partial, progress.at(-1)], [3, false, 3]);
  const partial = await immo.search({}, { sites: [ok('a', 2), bad('b')] });
  assert.deepEqual([partial.listings.length, partial.partial], [2, true]);
  await assert.rejects(immo.search({}, { sites: [bad('a'), bad('b')] }), /all Immo sites failed/);
});

test('immomarktplatz reads result rows, the detail gallery and broker, and builds the filter form', () => {
  const row = (id, fn) => `<tr itemscope itemtype="http://schema.org/Offer"><td><a itemprop="url" href="/de/immobilien/${id}-wohnung"><img itemprop="image" src="https://files.immomarktplatz.at/public/pic/t4/A${id}.jpg" /></a></td><td><h3 itemprop="name"> Helle Wohnung ${id} </h3><p><span itemprop="postalCode">1100</span> <span itemprop="addressLocality">Wien</span> - <span itemprop="category">Wohnung</span>, <span><link itemprop="businessFunction" href="http://purl.org/goodrelations/v1#${fn}"/></span></p></td><td><span itemprop="price">1.199,01</span></td></tr>`;
  const { total, rows } = immomarktplatz.parseResults(`2995 Ergebnisse ${row(1, 'LeaseOut')}${row(2, 'Sell')}`);
  assert.equal(total, 2995);
  assert.deepEqual(rows.map((r) => [r.sourceId, r.postcode, r.city, r.category, r.rent, r.price, r.title]), [['1', '1100', 'Wien', 'Wohnung', true, 1199.01, 'Helle Wohnung 1'], ['2', '1100', 'Wien', 'Wohnung', false, 1199.01, 'Helle Wohnung 2']]);
  const detail = immomarktplatz.parseDetail(`<li data-thumb="https://files.immomarktplatz.at/public/pic/t1/X.jpg" data-src="https://files.immomarktplatz.at/public/pic/t4/X.jpg"></li><img src="https://files.immomarktplatz.at/public/pic/t4/X.jpg"><img src="https://files.immomarktplatz.at/public/pic/t4/Y.jpg">
<div itemprop="seller" itemscope><img itemprop="image" src="https://files.immomarktplatz.at/public/pic/t12/L.jpg" alt="Rustler Immobilientreuhand GmbH" /></div><h3>Beschreibung der Immobilie</h3><p>Helle und moderne Wohnung.</p><h3>Lage</h3>`);
  assert.deepEqual(detail, { images: ['https://files.immomarktplatz.at/public/pic/t4/X.jpg', 'https://files.immomarktplatz.at/public/pic/t4/Y.jpg'], agency: 'Rustler Immobilientreuhand GmbH', description: 'Helle und moderne Wohnung.' });
  const body = new URLSearchParams(immomarktplatz.filterBody({ types: ['apartment', 'house'], maxPrice: 1000, minArea: 60 }, 'wien'));
  assert.deepEqual([body.get('objekt_filters_wohnen[land_bundesland_id]'), body.getAll('objekt_filters_wohnen[objektart_id][]'), body.getAll('objekt_filters_wohnen[vermarktung][]'), body.get('objekt_filters_wohnen[preis_bis]'), body.get('objekt_filters_wohnen[wohnflaeche_von]')], ['9', ['2', '3'], ['2'], '1000', '60']);
});

test('the source registry matches the ids saved searches can pick', async () => {
  const { SOURCES } = await import('../src/core/sources/index.js');
  const { SOURCE_IDS } = await import('../src/core/prefs.js');
  assert.deepEqual(Object.keys(SOURCES), SOURCE_IDS);
  for (const s of Object.values(SOURCES)) assert.ok(['portal', 'broker', 'cooperative'].includes(s.kind), s.id);
});

test('wunderflats ignores listings with null or zero price', () => {
  const fixture = `
    <!DOCTYPE html>
    <html>
      <head>
        <script type="application/json">
          {
            "pageData": {
              "listingResults": {
                "items": [
                  { "_id": "valid", "title": { "de": "Valid Flat" }, "price": 95000 },
                  { "_id": "noprice", "title": { "de": "No Price" }, "price": null },
                  { "_id": "zeroprice", "title": { "de": "Zero Price" }, "price": 0 }
                ]
              }
            }
          }
        </script>
      </head>
      <body></body>
    </html>
  `;
  const results = wunderflats.parseListings(fixture);
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'wunderflats:valid');
});

test('justimmo parseCards reads id, postcode and rent from result cards', () => {
  const html = `<div class="panel panel-default"><a href="/objektdetail/111?f=1&amp;from=9">A</a><span class="zip-city">1050 Wien</span><li class="info-price"><span class="list-item-desc">Miete</span><span class="list-item-value"> 1.250,50 € </span></li></div>
<div class="panel panel-default"><span class="zip-city">8010 Graz</span><li class="info info-price"><span class="list-item-value"> auf Anfrage </span></li><a class="overlay-link" href="/objekt/222?from=9">B</a></div>`;
  assert.deepEqual(justimmo.parseCards(html, 'https://www.x.at'), [
    { sourceId: '111', url: 'https://www.x.at/objektdetail/111', postcode: '1050', price: 1250.5 },
    { sourceId: '222', url: 'https://www.x.at/objekt/222', postcode: '8010', price: null },
  ]);
});

test('cooperatives parseSiteCards reads postcode, rent and type from BWSG and ÖVW cards', () => {
  const [bwsg, oevw] = cooperatives.SITES;
  const bwsgHtml = `<div class="col-md-12" data-objektnummer="1"><a href="https://www.bwsg.at/objekt/a/"><span class="res_immobiliensuche__immobilien__item__content__meta__location"> <i class="icon"></i>1110 <span>Wien</span></span><span class="res_immobiliensuche__immobilien__item__content__meta__preis"> 1.075,22 € </span></a></div>`;
  assert.deepEqual(cooperatives.parseSiteCards(bwsg, bwsgHtml), [{ url: 'https://www.bwsg.at/objekt/a/', postcode: '1110', price: 1075.22, residential: true }]);
  const oevwHtml = `<li class="thumblist__item"><div class="thumb__info small">Wohnung – Miete – 1020 Wien</div><li class="thumb__subheading__item">€ 526,74</li><a href="/suche/130-x">Zum Objekt</a></li>
<li class="thumblist__item"><div class="thumb__info small">Geschäftslokal – Miete – 1020 Wien</div><li class="thumb__subheading__item">€ 8.026,61</li><a href="/suche/5725-y">Zum Objekt</a></li>`;
  assert.deepEqual(cooperatives.parseSiteCards(oevw, oevwHtml), [
    { url: 'https://www.oevw.at/suche/130-x', postcode: '1020', price: 526.74, residential: true },
    { url: 'https://www.oevw.at/suche/5725-y', postcode: '1020', price: 8026.61, residential: false },
  ]);
});

test('nebau expands a project page into one listing per available unit', () => {
  const html = `<div class="project-detail"><h4>Sofort beziehbar</h4><h1>Reihenhäuser in Parndorf, Hauptstraße</h1><div class="project-details"><div class="project-data"><div class="project-location"><strong>Standort</strong> Hauptstraße 85<br>7111 Parndorf </div></div><div class="project-description"><p>Neues Bauprojekt.</p></div><div class="project-map" data-longitude="16.85" data-latitude="47.99" data-key="x"></div></div>
<div class="project-units background-grey"><table><tbody><tr><th class="apartment-number"><span class="state" data-state="9">Sofort beziehbar</span><span> Parndorf, Hauptstraße 35a/3 </span></th><td class="living-space">114,85 m²</td><td class="rooms">4</td><td class="parking">Carport</td><td class="price"><span> 76.625,44 € </span></td><td class="rent"><span>1.316,25 € </span><br><a class="unit-link" href="/wohnen-immobilien/immobiliensuche/immobilie/rh-parndorf/parndorf-hauptstrasse-35a-3/">Details</a></td></tr></tbody></table></div>
<div class="project-gallery"><div><div><a href="/fileadmin-immo/a.jpg" title="a" class="lightbox"></a></div></div></div>`;
  const [unit, ...rest] = cooperatives.parseNebauProject(html, 'https://www.nebau.at/wohnen-immobilien/immobiliensuche/immobilie/rh-parndorf/');
  assert.equal(rest.length, 0);
  assert.deepEqual(
    [unit.id, unit.source, unit.type, unit.price, unit.area, unit.rooms, unit.deposit, unit.postcode, unit.state, unit.address, unit.lat],
    ['nebau:parndorf-hauptstrasse-35a-3', 'nebau', 'house', 1316.25, 114.85, 4, 76625.44, '7111', 'burgenland', 'Hauptstraße 35a/3, 7111 Parndorf', 47.99],
  );
  assert.deepEqual(unit.images, ['https://www.nebau.at/fileadmin-immo/a.jpg']);
  assert.ok(unit.extras.includes('Genossenschaftswohnung'));
});
