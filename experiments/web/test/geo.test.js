import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cityFromAddress, districtFromPostcode, findPostcode, searchRegions, stateFromPostcode } from '../src/geo.js';

test('finds Austrian postcodes and cities in addresses', () => {
  assert.equal(findPostcode('Sechshauser Straße, 1150 Wien'), '1150');
  assert.equal(findPostcode('Gendarmeriestraße 2B, 9073 Klagenfurt,13.Bez.:Viktring'), '9073');
  assert.equal(findPostcode('Innsbruck, Innsbruck Stadt'), null);
  assert.equal(cityFromAddress('Neue Bienengasse 2, 8020 Graz'), 'Graz');
  assert.equal(cityFromAddress('1170 Vienna'), 'Wien');
});

test('maps postcodes to states and Vienna districts', () => {
  assert.equal(stateFromPostcode('1100'), 'wien');
  assert.equal(stateFromPostcode('2700'), 'niederoesterreich');
  assert.equal(stateFromPostcode('4020'), 'oberoesterreich');
  assert.equal(stateFromPostcode('5020'), 'salzburg');
  assert.equal(stateFromPostcode('6020'), 'tirol');
  assert.equal(stateFromPostcode('6850'), 'vorarlberg');
  assert.equal(stateFromPostcode('7000'), 'burgenland');
  assert.equal(stateFromPostcode('8010'), 'steiermark');
  assert.equal(stateFromPostcode('9020'), 'kaernten');
  assert.equal(districtFromPostcode('1100'), 10);
  assert.equal(districtFromPostcode('1300'), null);
});

test('an empty state list searches all of Austria in one go', () => {
  assert.deepEqual(searchRegions([]), [null]);
  assert.deepEqual(searchRegions(['wien', 'tirol']).map((r) => r.willhaben), [900, 7]);
});
