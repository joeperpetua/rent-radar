import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as wunderflats from '../src/sources/wunderflats.js';
import * as cooperatives from '../src/sources/cooperatives.js';
import * as justimmo from '../src/sources/justimmo.js';
import * as fify from '../src/sources/fify.js';

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

test('cooperatives module defines correct metadata', () => {
  assert.equal(cooperatives.id, 'cooperatives');
  assert.equal(cooperatives.label, 'Genossenschaften');
});

test('justimmo module defines correct metadata', () => {
  assert.equal(justimmo.id, 'justimmo');
  assert.equal(justimmo.label, 'JustImmo Makler');
});

test('fify module defines correct metadata', () => {
  assert.equal(fify.id, 'fify');
  assert.equal(fify.label, 'Fify Makler');
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
