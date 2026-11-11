import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractKeyValuePairs,
  isListingForSale,
  isListingInactive,
  parseArea,
  parseDirectListing,
  parseRooms,
} from '../src/core/sources/directParser.js';

const JUSTIMMO_HTML = `<!DOCTYPE html>
<html>
<head>
  <title>Helle 2-Zimmerwohnung mit Balkon - IMMOcontract</title>
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": ["LocalBusiness", "RealEstateAgent"],
    "name": "IMMOcontract Immobilien Vermittlung GmbH",
    "telephone": "+43 1 8900800",
    "email": "office@immocontract.at"
  }
  </script>
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "RealEstateListing",
    "name": "Helle 2-Zimmerwohnung mit Balkon",
    "image": [
      "https://storage.justimmo.at/thumb/abc/fc_h640/img1.jpg",
      "https://storage.justimmo.at/thumb/def/fc_h640/img2.jpg"
    ],
    "description": "Schöne ruhige Wohnung mit modernem Bad.",
    "offers": {
      "@type": "OfferForLease",
      "price": "916.33"
    }
  }
  </script>
</head>
<body>
  <ul>
    <li>
      <span class="list-item-desc">Nutzfläche</span>
      <span class="list-item-value">ca. 57,44 m<sup>2</sup></span>
    </li>
    <li>
      <span class="list-item-desc">Zimmer</span>
      <span class="list-item-value">2</span>
    </li>
    <li>
      <span class="list-item-desc">Monatliche Gesamtbelastung:</span>
      <span class="list-item-value">916,33 €</span>
    </li>
    <li>
      <span class="list-item-desc">Kaution:</span>
      <span class="list-item-value">2.750,00 €</span>
    </li>
  </ul>
</body>
</html>`;

const FIFY_HTML = `<!DOCTYPE html>
<html>
<head>
  <title>Altbau-Traum im 1. Bezirk | EDLAUER Immobilien</title>
</head>
<body>
  <div class="broker-card">
    <p>Ihr Ansprechpartner: Gregor LAMP</p>
    <p>Tel: +43/660/507 90 96</p>
    <p>E-Mail: g.lamp@edlauer.com</p>
  </div>
  <dl>
    <dt class="text-sm">Wohnfläche:</dt>
    <dd class="text-sm">116,52 m²</dd>
    <dt class="text-sm">Zimmer:</dt>
    <dd class="text-sm">3</dd>
    <dt class="text-sm">Gesamtmiete:</dt>
    <dd class="text-sm">2.853,25 €</dd>
    <dt class="text-sm">Kaution:</dt>
    <dd class="text-sm">8.600,00 €</dd>
  </dl>
  <img src="https://fify-dynamo-assets.sos-at-vie-1.exo.io/sample_2xl.webp" />
</body>
</html>`;

const COOPERATIVE_HTML = `<!DOCTYPE html>
<html>
<head>
  <title>Geförderte Mietwohnung - WAG Wohnungsanlagen</title>
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    "name": "WAG Wohnungsanlagen Ges.m.b.H.",
    "telephone": "+43 50338 0",
    "email": "office@wag.at"
  }
  </script>
</head>
<body>
  <table>
    <tr><th>Wohnfläche</th><td>68,50 m²</td></tr>
    <tr><th>Zimmer</th><td>3</td></tr>
    <tr><th>Monatliches Nutzungsentgelt</th><td>645,80 €</td></tr>
    <tr><th>Finanzierungsbeitrag</th><td>14.200,00 €</td></tr>
  </table>
</body>
</html>`;

const WUNDERFLATS_HTML = `<!DOCTYPE html>
<html>
<head>
  <title>Design Apartment near Opera - Wunderflats</title>
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Apartment",
    "name": "Design Apartment near Opera",
    "numberOfRooms": 2,
    "floorSize": 55,
    "image": "https://listingimages.wunderflats.com/img_original.jpg"
  }
  </script>
</head>
<body>
  <div>Monthly rent €1,450 / month</div>
  <div>Security deposit €1,450</div>
</body>
</html>`;

const INACTIVE_HTML = `<!DOCTYPE html>
<html>
<head>
  <title>Objekt nicht gefunden - IMMO-Real</title>
</head>
<body>
  <div class="alert warning">Dieses Objekt ist leider nicht mehr verfügbar oder wurde bereits vermietet.</div>
</body>
</html>`;

test('parseArea parses varied Austrian floor area formats', () => {
  assert.equal(parseArea('ca. 57,44 m<sup>2</sup>'), 57.44);
  assert.equal(parseArea('116,52 m²'), 116.52);
  assert.equal(parseArea('75 m2'), 75);
  assert.equal(parseArea('ca. 42 qm'), 42);
  assert.equal(parseArea(null), null);
  assert.equal(parseArea(''), null);
});

test('parseRooms extracts numeric room counts', () => {
  assert.equal(parseRooms('3'), 3);
  assert.equal(parseRooms('2 Zimmer'), 2);
  assert.equal(parseRooms('1-Zimmer-Wohnung'), 1);
  assert.equal(parseRooms(4), 4);
  assert.equal(parseRooms(null), null);
});

test('isListingInactive identifies deactivated or missing listings', () => {
  assert.equal(isListingInactive(INACTIVE_HTML, 'https://example.com/objekt/123'), true);
  assert.equal(isListingInactive('', 'https://example.com/404', 404), true);
  assert.equal(isListingInactive('<html><body>Live</body></html>', 'https://edireal.com/search-object-not-found'), true);
  assert.equal(isListingInactive('<html><body>Live ad</body></html>', 'https://example.com/live', 200), false);
});

test('parseDirectListing parses JustImmo broker page accurately', () => {
  const result = parseDirectListing(JUSTIMMO_HTML, 'https://www.immocontract.at/objektdetail/123');
  assert.equal(result.inactive, false);
  assert.equal(result.area, 57.44);
  assert.equal(result.rooms, 2);
  assert.equal(result.price, 916.33);
  assert.equal(result.deposit, 2750);
  assert.equal(result.agency, 'IMMOcontract Immobilien Vermittlung GmbH');
  assert.ok(result.images.includes('https://storage.justimmo.at/thumb/abc/fc_h640/img1.jpg'));
});

test('parseDirectListing parses Fify/Dynamo broker page with dl and broker text', () => {
  const result = parseDirectListing(FIFY_HTML, 'https://edlauer.com/de/immobilie/123');
  assert.equal(result.inactive, false);
  assert.equal(result.area, 116.52);
  assert.equal(result.rooms, 3);
  assert.equal(result.price, 2853.25);
  assert.equal(result.deposit, 8600);
  assert.equal(result.agency, 'Gregor LAMP');
  assert.ok(result.images.some((i) => i.includes('fify-dynamo-assets')));
});

test('parseDirectListing parses Housing Cooperative with equity contribution', () => {
  const result = parseDirectListing(COOPERATIVE_HTML, 'https://www.wag.at/objekt/456');
  assert.equal(result.inactive, false);
  assert.equal(result.area, 68.5);
  assert.equal(result.rooms, 3);
  assert.equal(result.price, 645.8);
  assert.equal(result.deposit, 14200);
  assert.equal(result.agency, 'WAG Wohnungsanlagen Ges.m.b.H.');
});

test('parseDirectListing parses Wunderflats apartment schema and monthly rent', () => {
  const result = parseDirectListing(WUNDERFLATS_HTML, 'https://wunderflats.com/en/furnished-apartment/123');
  assert.equal(result.inactive, false);
  assert.equal(result.area, 55);
  assert.equal(result.rooms, 2);
  assert.equal(result.price, 1450);
  assert.equal(result.deposit, 1450);
  assert.ok(result.images.includes('https://listingimages.wunderflats.com/img_original.jpg'));
});

test('parseDirectListing marks inactive page correctly', () => {
  const result = parseDirectListing(INACTIVE_HTML, 'https://example.com/inactive');
  assert.equal(result.inactive, true);
});

test('parseDirectListing deduplicates image resolution variants and ignores avatars', () => {
  const html = `<!DOCTYPE html>
  <html>
  <body>
    <dl><dt>Gesamtmiete:</dt><dd>900 €</dd></dl>
    <a href="https://fify-dynamo-assets.sos-at-vie-1.exo.io/c859_hd.webp">
      <img src="https://fify-dynamo-assets.sos-at-vie-1.exo.io/c859_2xl.webp" />
    </a>
    <img src="https://fify-dynamo-assets.sos-at-vie-1.exo.io/c859_xs.webp" />
    <a href="https://fify-dynamo-assets.sos-at-vie-1.exo.io/ce8c_hd.webp">
      <img src="https://fify-dynamo-assets.sos-at-vie-1.exo.io/ce8c_2xl.webp" />
    </a>
    <div class="rounded-full overflow-hidden">
      <img src="https://fify-dynamo-assets.sos-at-vie-1.exo.io/agent_avatar_lg.webp" />
    </div>
  </body>
  </html>`;
  const result = parseDirectListing(html, 'https://example.com/item');
  assert.equal(result.images.length, 2);
  assert.equal(result.images[0], 'https://fify-dynamo-assets.sos-at-vie-1.exo.io/c859_hd.webp');
  assert.equal(result.images[1], 'https://fify-dynamo-assets.sos-at-vie-1.exo.io/ce8c_hd.webp');
});

test('parseDirectListing parses Lower Austria Tribuswinkel listing and resolves address and geo correctly', () => {
  const html = `<!DOCTYPE html>
  <html>
  <head>
    <title>Schöne 2-Zimmer-Wohnung in Tribuswinkel (2512) | Realbrokers</title>
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "Apartment",
      "address": {
        "@type": "PostalAddress",
        "postalCode": "2512",
        "addressLocality": "Tribuswinkel",
        "addressRegion": "Niederösterreich"
      },
      "geo": {
        "@type": "GeoCoordinates",
        "latitude": 48.0123,
        "longitude": 16.2789
      },
      "floorSize": {
        "@type": "QuantitativeValue",
        "value": 83
      },
      "numberOfRooms": 2
    }
    </script>
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "RealEstateListing",
      "name": "Schöne 2-Zimmer-Wohnung in Tribuswinkel",
      "offers": {
        "@type": "OfferForLease",
        "price": "802.32"
      }
    }
    </script>
  </head>
  <body>
    <h1>Schöne 2-Zimmer-Wohnung in Tribuswinkel (2512)</h1>
    <div>Gesamtmiete: 802,32 €</div>
  </body>
  </html>`;

  const result = parseDirectListing(html, 'https://realbrokers.at/de/immobilie/schoene-2-zimmer-wohnung-in-tribuswinkel-cca36a25');
  assert.equal(result.inactive, false);
  assert.equal(result.area, 83);
  assert.equal(result.rooms, 2);
  assert.equal(result.price, 802.32);
  assert.equal(result.address, '2512 Tribuswinkel');
  assert.equal(result.lat, 48.0123);
  assert.equal(result.lng, 16.2789);
});

test('isListingForSale correctly identifies for-sale / buy properties vs rentals', () => {
  // BWSG Leo am Teich: for-sale property with Kaufpreis and Kauf Vermarktungsart
  const bwsgBuyHtml = `
    <!DOCTYPE html><html><head><title>Leo am Teich - Wohnen am Wasser | BWSG</title></head><body>
      <table>
        <tr><th>Objektart</th><td>Wohnung</td></tr>
        <tr><th>Nutzungsart</th><td>Wohnen</td></tr>
        <tr><th>Vermarktungsart</th><td>Kauf</td></tr>
        <tr><th>Kaufpreis</th><td>299.000,00 €</td></tr>
        <tr><th>Monatliche Gesamtbelastung</th><td>217,75 €</td></tr>
      </table>
    </body></html>
  `;
  assert.equal(isListingForSale(bwsgBuyHtml, 'https://www.bwsg.at/objekt/leo-am-teich-wohnen-am-wasser/'), true);

  // Rental cooperative apartment
  const bwsgRentHtml = `
    <!DOCTYPE html><html><head><title>Brambilla - Grün wohnen an der U3 | BWSG</title></head><body>
      <table>
        <tr><th>Objektart</th><td>Wohnung</td></tr>
        <tr><th>Vermarktungsart</th><td>Miete</td></tr>
        <tr><th>Gesamtmiete</th><td>1.075,22 €</td></tr>
      </table>
    </body></html>
  `;
  assert.equal(isListingForSale(bwsgRentHtml, 'https://www.bwsg.at/objekt/brambilla-gruen-wohnen-an-der-u3/'), false);

  // Cooperative apartment with purchase option (Miete mit Kaufoption)
  const kaufoptionHtml = `
    <!DOCTYPE html><html><head><title>Mietwohnung mit Kaufoption | BWSG</title></head><body>
      <table>
        <tr><th>Vermarktungsart</th><td>Miete mit Kaufoption</td></tr>
        <tr><th>Monatliches Nutzungsentgelt</th><td>750,00 €</td></tr>
        <tr><th>Finanzierungsbeitrag</th><td>15.000,00 €</td></tr>
      </table>
    </body></html>
  `;
  assert.equal(isListingForSale(kaufoptionHtml, 'https://www.bwsg.at/objekt/kaufoption/'), false);

  // JSON-LD OfferForSale
  const ldSaleHtml = `
    <!DOCTYPE html><html><head>
      <script type="application/ld+json">{"@context": "https://schema.org", "@type": "OfferForSale", "price": 450000}</script>
    </head><body></body></html>
  `;
  assert.equal(isListingForSale(ldSaleHtml, 'https://example.com/property/1'), true);
});

test('parseDirectListing rejects BWSG Leo am Teich buy property as inactive/forSale', () => {
  const html = `
    <!DOCTYPE html><html><head><title>Leo am Teich - Wohnen am Wasser | BWSG</title></head><body>
      <h1>Leo am Teich</h1>
      <table>
        <tr><th>Objektart</th><td>Wohnung</td></tr>
        <tr><th>Vermarktungsart</th><td>Kauf</td></tr>
        <tr><th>Kaufpreis</th><td>299.000,00 €</td></tr>
        <tr><th>Monatliche Gesamtbelastung</th><td>217,75 €</td></tr>
        <tr><th>Wohnfläche</th><td>ca. 60,31 m²</td></tr>
        <tr><th>Zimmer</th><td>2</td></tr>
      </table>
    </body></html>
  `;
  const result = parseDirectListing(html, 'https://www.bwsg.at/objekt/leo-am-teich-wohnen-am-wasser/');
  assert.equal(result.inactive, true);
  assert.equal(result.forSale, true);
});

test('parseDirectListing parses ÖVW apartment with "Miete brutto" correctly without confusing floor number', () => {
  const html = `
    <!DOCTYPE html><html><head><title>Emilie-Flöge-Weg 3/1/13 | ÖVW</title></head><body>
      <h1>Emilie-Flöge-Weg 3/1/13</h1>
      <p>Bloch-Bauer-Promenade 13, 1100 Wien</p>
      <table>
        <tr><td><strong>€ 495,68</strong> Miete brutto</td></tr>
        <tr><td>4. Obergeschoss</td></tr>
        <tr><td>€ 13.328,10 Eigenmittel</td></tr>
      </table>
      <table>
        <tr><th>Rechtsform</th><td>Miete</td></tr>
        <tr><th>Zimmer</th><td>1</td></tr>
        <tr><th>Nutzfläche</th><td>31,37 m²</td></tr>
      </table>
    </body></html>
  `;
  const result = parseDirectListing(html, 'https://www.oevw.at/suche/3929-emilie-floege-weg-3-1-13');
  assert.equal(result.inactive, false);
  assert.equal(result.forSale, false);
  assert.equal(result.price, 495.68);
  assert.equal(result.area, 31.37);
  assert.equal(result.rooms, 1);
  assert.equal(result.deposit, 13328.1);
});

const justimmoPage = ({ objektart, title, kaution = '3.000,00 €' }) => `<html><head><title>${title}</title>
<script type="application/ld+json">{"@type":"RealEstateListing","name":"${title}","image":["https://storage.justimmo.at/thumb/a1/fc_h640_mwebp_w640/photo1.jpg","https://storage.justimmo.at/thumb/a2/fc_h1080_mwebp_w1920/photo1.jpg"]}</script></head><body>
<div class="item-image image-1" style="background-image: url('https://storage.justimmo.at/thumb/h/fcc_mwebp_w767/header.png');"></div>
<img src="https://storage.justimmo.at/file/broker-logo.png">
<div class="carousel photo-gallery"><img class="slider-photo contain" alt="Bild 1" src="https://storage.justimmo.at/thumb/b1/fc_h1080_mwebp_w1920/photo1.jpg" /><img class="slider-photo contain" alt="Bild 2" src="https://storage.justimmo.at/thumb/b2/fc_h1080_mwebp_w1920/photo2.jpg" /></div>
<img src="https://storage.justimmo.at/thumb/c1/fcc_h50_mwebp/photo2.jpg">
<img src="https://files.justimmo.at/public/pic/user_small/agent.jpg">
<img src="https://storage.justimmo.at/thumb/s/fc_h20_mwebp_w20/facebook.png">
<ul><li><span class="list-item-desc">Objektart</span><span class="list-item-value">${objektart}</span></li>
<li><span class="list-item-desc">Gesamtmiete</span><span class="list-item-value">1.000,00 €</span></li>
<li><span class="list-item-desc">Kaution</span><span class="list-item-value">${kaution}</span></li></ul></body></html>`;

test('parseDirectListing keeps only JustImmo gallery photos, one per photo', () => {
  const result = parseDirectListing(justimmoPage({ objektart: 'Wohnung', title: '2-Zimmer Wohnung' }), 'https://www.novel-real.at/de/objekt/1');
  assert.equal(result.inactive, false);
  assert.deepEqual(result.images.map((i) => i.split('/').pop()), ['photo1.jpg', 'photo2.jpg']);
  assert.ok(result.images[0].includes('fc_h1080'));
});

test('parseDirectListing rejects non-residential JustImmo objects', () => {
  for (const [objektart, title] of [['Industrie / Gewerbe', 'Attraktive Lagerfläche im 1. KG in 1050 Wien'], ['Parken', 'Klugargasse 14 - Parkplatz im Freien']]) {
    const result = parseDirectListing(justimmoPage({ objektart, title }), 'https://www.novel-real.at/de/objekt/2');
    assert.equal(result.inactive, true);
    assert.equal(result.nonResidential, true);
  }
});

test('parseDirectListing converts deposit given in monthly rents', () => {
  const result = parseDirectListing(justimmoPage({ objektart: 'Wohnung', title: 'Wohnung', kaution: '3 Bruttomonatsmieten' }), 'https://www.novel-real.at/de/objekt/3');
  assert.equal(result.deposit, 3000);
});
