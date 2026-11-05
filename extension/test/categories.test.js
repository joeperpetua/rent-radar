import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, groupCategories, passesCategories } from '../src/core/categories.js';

const cats = (fields) => [...classify({ title: '', ...fields })].sort();

test('detects council flats from title, description and badge', () => {
  assert.deepEqual(cats({ title: 'Direktvergabe Gemeindwohnung am Draschepark' }), ['council']);
  assert.deepEqual(cats({ title: '3 Zimmer Gemeinde Wohnung zur Direktvergabe' }), ['council']);
  assert.deepEqual(cats({ title: '2 Zimmer Wohnung Wiener Wohnen' }), ['council']);
  assert.deepEqual(cats({ title: 'Helle Wohnung', description: 'Nur mit gültigem Wohnticket.' }), ['council']);
  assert.deepEqual(cats({ title: 'Sanierte 2-Zimmer-Altbauwohnung', extras: ['SOCIAL_HOUSING'] }), ['council']);
});

test('detects cooperatives, including non-profit housing associations as advertiser', () => {
  assert.deepEqual(cats({ title: 'Sozialbau Genossenschaftswohnung' }), ['cooperative']);
  assert.deepEqual(cats({ title: 'Lebnergasse 1/5/10', agency: 'Österreichisches Volkswohnungswerk Gem. Gesellschaft m.b.H.' }), ['cooperative']);
  assert.deepEqual(cats({ title: 'Nachmieter gesucht', extras: ['COOPERATIVE_HOUSING', 'SOCIAL_HOUSING'] }), ['cooperative']);
});

test('detects WG rooms but not whole flats that are merely WG-suitable', () => {
  assert.deepEqual(cats({ title: 'WG-Zimmer in moderner 2-Zimmer-Smart-Wohnung' }), ['shared']);
  assert.deepEqual(cats({ title: 'Zimmer in 3er *Mädchen* WG' }), ['shared']);
  assert.deepEqual(cats({ title: 'WOHNGEMEINSCHAFT - Mitbewohnerin gesucht!' }), ['shared']);
  assert.deepEqual(cats({ title: 'WG Wohnung', extras: ['Zimmer/WG'] }), ['shared']);
  assert.deepEqual(cats({ title: 'Altbau mit Charakter: 2-Zimmer | WG-geeignet | U1' }), []);
  assert.deepEqual(cats({ title: 'NEU RENOVIERT 3 ZIMMER WG TAUGLICH ZENTRUMSNAH' }), []);
});

test('detects flat swaps', () => {
  assert.deepEqual(cats({ title: 'TAUSCHWOHNUNG 2-Zimmer in Donaunähe' }), ['swap']);
  assert.deepEqual(cats({ title: 'Wohnung tauschen?' }), ['swap']);
  assert.deepEqual(cats({ title: 'Neue Küche, Fenster im Austausch erneuert' }), []);
});

test('a group without any category is regular', () => {
  assert.deepEqual(groupCategories([{ title: 'Helle 2-Zimmer-Wohnung' }]), ['regular']);
  assert.deepEqual(groupCategories([{ title: 'Helle Wohnung' }, { title: 'Gemeindewohnung Direktvergabe' }]), ['council']);
});

test('a group is shown only when all of its categories are selected', () => {
  assert.equal(passesCategories(['council'], ['regular', 'council']), true);
  assert.equal(passesCategories(['council', 'swap'], ['regular', 'council']), false);
  assert.equal(passesCategories(['regular'], ['council']), false);
});
