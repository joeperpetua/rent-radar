import { openDb } from '../core/db.js';
import { dispatch } from '../core/api.js';
import { onScanChange, scanStatus } from '../core/scan.js';

const STATUS_THROTTLE_MS = 250;

const ready = new Promise((resolve) => {
  navigator.locks.request('rentradar-app', { ifAvailable: true }, (lock) => {
    if (!lock) {
      chrome.runtime.sendMessage('duplicate-app');
      return;
    }
    resolve(openDb());
    return new Promise(() => {});
  });
});

window.rentradar = {
  call: async (method, payload) => {
    await ready;
    try {
      return structuredClone(await dispatch(method, structuredClone(payload)));
    } catch (err) {
      console.error(`[api] ${method}:`, err);
      throw new Error(err.message);
    }
  },
  onScanStatus: (fn) => {
    let timer = null;
    return onScanChange(() => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        fn(structuredClone(scanStatus()));
      }, STATUS_THROTTLE_MS);
    });
  },
};
