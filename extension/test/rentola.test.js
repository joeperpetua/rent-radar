import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanSourceUrl, extractSourceHost, parseDetails, parsePropertyAttributes } from '../src/core/sources/rentola.js';

const ACTIVE_PAYLOAD = '1:HL["/static/css/app.css","style"]\n'
  + '2:I{"id":"abc","chunks":[],"name":""}\n'
  + '3:{"title":"Wohnung in Linz","propertyAttributes":{'
  + '"title":"Schöne 3-Zimmer-Wohnung",'
  + '"status":"active",'
  + '"source":"spider",'
  + '"sourceUrl":"https://www.wag.at/objekt/13023595?utm_source=rentola&utm_medium=cpc&keep=1",'
  + '"desc":"<p>Helle Wohnung mit Balkon &amp; Ruhelage.</p>",'
  + '"images":[{"data":{"attributes":{"externalUrl":"https://cdn.example.com/img1.jpg"}}},'
  + '{"data":{"attributes":{"externalUrl":"https://cdn.example.com/img2.jpg"}}}],'
  + '"estimatedArea":false,'
  + '"monthlyRent":750'
  + '}}\n';

const INACTIVE_SEARCH_HTML = '<!DOCTYPE html><html><body><h1>Wohnungen in Linz</h1></body></html>';
const INACTIVE_REDIRECT_URL = 'https://rentola.at/mietwohnung/linz?inactive_property_id=13023595';

const MISSING_ATTRIBUTES_PAYLOAD = '1:HL["/static/css/app.css","style"]\n'
  + '2:{"message":"listing not available"}\n';

const JSONLD_FALLBACK_HTML = '<!DOCTYPE html><html><head>'
  + '<script type="application/ld+json">'
  + '{"@type":"RealEstateListing","name":"Fallback Flat","image":["https://cdn.example.com/fb.jpg"],"description":"Cozy flat"}'
  + '</script></head><body></body></html>';

test('extracts propertyAttributes and details from active flight payload', () => {
  const attrs = parsePropertyAttributes(ACTIVE_PAYLOAD);
  assert.ok(attrs);
  assert.equal(attrs.title, 'Schöne 3-Zimmer-Wohnung');
  assert.equal(attrs.status, 'active');
  assert.equal(attrs.sourceUrl, 'https://www.wag.at/objekt/13023595?utm_source=rentola&utm_medium=cpc&keep=1');

  const details = parseDetails(ACTIVE_PAYLOAD, 'https://rentola.at/listings/schoene-3-zimmer-wohnung-p860105');
  assert.equal(details.inactive, false);
  assert.equal(details.sourceUrl, 'https://www.wag.at/objekt/13023595?keep=1');
  assert.equal(details.sourceHost, 'wag.at');
  assert.equal(details.rentolaStatus, 'active');
  assert.equal(details.estimatedArea, false);
  assert.deepEqual(details.images, [
    'https://cdn.example.com/img1.jpg',
    'https://cdn.example.com/img2.jpg',
  ]);
  assert.equal(details.description, 'Helle Wohnung mit Balkon & Ruhelage.');
});

test('detects inactive redirect by inactive_property_id in URL', () => {
  const details = parseDetails(INACTIVE_SEARCH_HTML, INACTIVE_REDIRECT_URL);
  assert.deepEqual(details, { inactive: true });
});

test('handles payload where propertyAttributes is missing', () => {
  const attrs = parsePropertyAttributes(MISSING_ATTRIBUTES_PAYLOAD);
  assert.equal(attrs, null);

  const details = parseDetails(MISSING_ATTRIBUTES_PAYLOAD, 'https://rentola.at/listings/missing-p123');
  assert.deepEqual(details, { inactive: true });
});

test('falls back to JSON-LD RealEstateListing when propertyAttributes is missing', () => {
  const details = parseDetails(JSONLD_FALLBACK_HTML, 'https://rentola.at/listings/old-p123');
  assert.equal(details.inactive, false);
  assert.deepEqual(details.images, ['https://cdn.example.com/fb.jpg']);
  assert.equal(details.description, 'Cozy flat');
  assert.equal(details.sourceUrl, null);
  assert.equal(details.sourceHost, null);
});

test('strips utm_* parameters from sourceUrl while preserving other params', () => {
  assert.equal(cleanSourceUrl(null), null);
  assert.equal(cleanSourceUrl(''), null);
  assert.equal(cleanSourceUrl('https://example.com/ad'), 'https://example.com/ad');
  assert.equal(cleanSourceUrl('https://example.com/ad?utm_source=rentola'), 'https://example.com/ad');
  assert.equal(
    cleanSourceUrl('https://wunderflats.com/g/123?utm_source=rentola&utm_medium=partner&keep=true&f[all]=1'),
    'https://wunderflats.com/g/123?keep=true&f%5Ball%5D=1',
  );
  assert.equal(
    cleanSourceUrl('https://spotahome.com/vienna/for-rent:apartments/123?UTM_SOURCE=rentola&id=456'),
    'https://spotahome.com/vienna/for-rent:apartments/123?id=456',
  );
});

test('extracts normalized sourceHost from url', () => {
  assert.equal(extractSourceHost(null), null);
  assert.equal(extractSourceHost('https://www.wag.at/projekte/123'), 'wag.at');
  assert.equal(extractSourceHost('https://wag.at/projekte/123'), 'wag.at');
  assert.equal(extractSourceHost('https://sub.agency.at/detail/456'), 'sub.agency.at');
});
