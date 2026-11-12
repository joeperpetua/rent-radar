import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hostPermitted } from '../src/core/http.js';
import * as cooperatives from '../src/core/sources/cooperatives.js';
import * as justimmo from '../src/core/sources/justimmo.js';
import * as fify from '../src/core/sources/fify.js';
import * as derstandard from '../src/core/sources/derstandard.js';
import * as dibeo from '../src/core/sources/dibeo.js';
import * as findmyhome from '../src/core/sources/findmyhome.js';
import * as sn from '../src/core/sources/sn.js';

const manifest = JSON.parse(readFileSync(new URL('../src/manifest.json', import.meta.url), 'utf8'));
const PATTERNS = manifest.host_permissions;

test('manifest has no wildcard host permission', () => {
  assert.ok(!PATTERNS.some((p) => /^[^:]+:\/\/\*\//.test(p)));
});

test('hostPermitted matches exact and subdomain patterns', () => {
  const patterns = ['https://*.willhaben.at/*', 'https://immo.sn.at/*'];
  assert.equal(hostPermitted('https://www.willhaben.at/iad', patterns), true);
  assert.equal(hostPermitted('https://willhaben.at/iad', patterns), true);
  assert.equal(hostPermitted('https://evilwillhaben.at/', patterns), false);
  assert.equal(hostPermitted('http://www.willhaben.at/', patterns), false);
  assert.equal(hostPermitted('https://immo.sn.at/suche', patterns), true);
  assert.equal(hostPermitted('https://www.sn.at/', patterns), false);
  assert.equal(hostPermitted('/relative', patterns), false);
  assert.equal(hostPermitted('https://anything.example/', null), true);
});

test('every source request host is covered by the manifest', () => {
  const urls = [
    'https://www.willhaben.at/iad/object?adId=1',
    'https://www.immobilienscout24.at/portal/graphql',
    'https://www.immobilienscout24.at/expose/graphql',
    'https://rentola.at/en/rent',
    'https://wunderflats.com/en/furnished-apartments/vienna',
    'https://www.immomarktplatz.at/de/immobilien',
    'https://overpass-api.de/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
    derstandard.searchUrl({}, 'wien', 'rent', 1),
    dibeo.searchUrl({}, 'WOHNUNG', 1),
    findmyhome.searchUrl({}, 'wohnung', 'wien', 0),
    sn.searchUrl({}, 'salzburg', 1),
    ...cooperatives.SITES.map((s) => s.pageUrl(1)),
    ...justimmo.BROKERS.map((b) => b.withPrefs({}).pageUrl(1)),
    ...fify.BROKERS.map((b) => b.searchUrl),
  ];
  const missing = urls.filter((url) => !hostPermitted(url, PATTERNS));
  assert.deepEqual(missing, []);
});
