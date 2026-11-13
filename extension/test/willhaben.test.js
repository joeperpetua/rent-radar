import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDetails, parseDetails } from '../src/core/sources/willhaben.js';

const ACTIVE_HTML = `<!DOCTYPE html><html><head>
<script id="__NEXT_DATA__" type="application/json">
{
  "props": {
    "pageProps": {
      "advertDetails": {
        "id": 1620974626,
        "description": "3-Zimmer-Wohnung (84m²)",
        "attributes": {
          "attribute": [
            {
              "name": "DESCRIPTION",
              "values": [
                "Erste Zeile der Beschreibung.<br/><br/>Details:<br/>Miete: 840€<br/>Kaution: 2000€"
              ]
            }
          ]
        }
      }
    }
  }
}
</script></head><body></body></html>`;

const INACTIVE_HTML = `<!DOCTYPE html><html><head>
<script id="__NEXT_DATA__" type="application/json">
{
  "props": {
    "pageProps": []
  }
}
</script></head><body></body></html>`;

const RESERVED_HTML = `<!DOCTYPE html><html><head>
<script id="__NEXT_DATA__" type="application/json">
{
  "props": {
    "pageProps": {
      "advertDetails": {
        "id": 2039358312,
        "description": "(reserviert) APARTMENT MAISONETTE WITH 2 SLEEPING ROOMS",
        "advertStatus": { "id": "reserved", "description": "reserviert", "statusId": 50 },
        "attributes": { "attribute": [{ "name": "DESCRIPTION", "values": ["Maisonette mit zwei Schlafzimmern."] }] }
      }
    }
  }
}
</script></head><body></body></html>`;

const NO_NEXT_DATA_HTML = '<!DOCTYPE html><html><body><h1>Not Found</h1></body></html>';

test('extracts full description from active willhaben detail page', () => {
  const details = parseDetails(ACTIVE_HTML);
  assert.ok(details);
  assert.equal(details.inactive, false);
  assert.equal(details.description, 'Erste Zeile der Beschreibung.\n\nDetails:\nMiete: 840€\nKaution: 2000€');
});

test('reads the reserved status willhaben only exposes on the detail page', () => {
  assert.equal(parseDetails(RESERVED_HTML).reserved, true);
  assert.equal(parseDetails(ACTIVE_HTML).reserved, false);
});

test('detects inactive ad when advertDetails is missing', () => {
  const details = parseDetails(INACTIVE_HTML);
  assert.deepEqual(details, { inactive: true });
});

test('returns null when __NEXT_DATA__ script is missing', () => {
  const details = parseDetails(NO_NEXT_DATA_HTML);
  assert.equal(details, null);
});

test('addDetails reuses cached description from stored listings without fetching', async () => {
  const detailsAt = new Date().toISOString();
  const stored = new Map([
    ['willhaben:1', { description: 'Complete stored description', detailsAt, reserved: true }],
  ]);
  const listings = [
    { id: 'willhaben:1', url: 'https://www.willhaben.at/iad/object?adId=1', description: 'Truncated...' },
  ];
  const fetch = globalThis.fetch;
  globalThis.fetch = () => assert.fail('addDetails must not refetch a fresh detail page');
  try {
    await addDetails(listings, stored);
  } finally {
    globalThis.fetch = fetch;
  }
  assert.equal(listings[0].description, 'Complete stored description');
  assert.equal(listings[0].detailsAt, detailsAt);
  assert.equal(listings[0].reserved, true);
});

test('addDetails rechecks stale listings so a newly reserved ad is picked up', async () => {
  const stored = new Map([
    ['willhaben:1', { description: 'Complete stored description', detailsAt: '2026-11-06T10:00:00Z', reserved: false }],
  ]);
  const listings = [
    { id: 'willhaben:1', url: 'https://www.willhaben.at/iad/object?adId=1', description: 'Complete stored description' },
  ];
  const fetch = globalThis.fetch;
  globalThis.fetch = async (url) => ({ ok: true, status: 200, url, text: async () => RESERVED_HTML });
  try {
    await addDetails(listings, stored);
  } finally {
    globalThis.fetch = fetch;
  }
  assert.equal(listings[0].reserved, true);
  assert.equal(listings[0].description, 'Maisonette mit zwei Schlafzimmern.');
  assert.notEqual(listings[0].detailsAt, '2026-11-06T10:00:00Z');
});
