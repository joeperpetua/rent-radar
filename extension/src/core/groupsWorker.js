import { openDb } from './db.js';
import { cachedGroups } from './groups.js';

let ready = null;

self.onmessage = async ({ data }) => {
  try {
    ready ??= openDb();
    await ready;
    self.postMessage({ id: data.id, result: await cachedGroups(data.searchId, data.prefs, data.version, data.persist) });
  } catch (err) {
    ready = null;
    self.postMessage({ id: data.id, error: err.message });
  }
};
