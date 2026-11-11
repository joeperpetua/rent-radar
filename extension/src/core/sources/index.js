import * as willhaben from './willhaben.js';
import * as immoscout from './immoscout.js';
import * as derstandard from './derstandard.js';
import * as dibeo from './dibeo.js';
import * as findmyhome from './findmyhome.js';
import * as sn from './sn.js';
import * as wunderflats from './wunderflats.js';
import * as immo from './immo.js';
import { sources as cooperatives } from './cooperatives.js';

export const SOURCE_KINDS = ['portal', 'broker', 'cooperative'];

const portals = [willhaben, immoscout, derstandard, dibeo, findmyhome, sn, wunderflats];

export const SOURCES = Object.fromEntries(
  [...portals, immo, ...cooperatives].map((s) => [s.id, s]),
);

export const COOPERATIVE_SOURCES = new Set(cooperatives.map((s) => s.id));
