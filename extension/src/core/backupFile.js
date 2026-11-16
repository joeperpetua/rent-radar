import { gunzip, gzip } from './bytes.js';

const MAGIC = new Uint8Array([0x52, 0x52, 0x42, 0x01]);
const KEY = 'BgkwBXJmoxMLJ55ARup1pD6oRHbI0wnjjbc+QylftRo=';
const IV_LENGTH = 12;
const ALGORITHM = 'AES-GCM';

export const BACKUP_EXTENSION = 'rrbackup';

export class InvalidBackupFile extends Error {
  constructor() {
    super('invalid backup file');
  }
}

let key = null;
const backupKey = () => (key ??= crypto.subtle.importKey('raw', Uint8Array.from(atob(KEY), (c) => c.charCodeAt(0)), ALGORITHM, false, ['encrypt', 'decrypt']));

export async function encodeBackup(backup) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const packed = await gzip(new TextEncoder().encode(JSON.stringify(backup)));
  const sealed = await crypto.subtle.encrypt({ name: ALGORITHM, iv, additionalData: MAGIC }, await backupKey(), packed);
  return new Blob([MAGIC, iv, sealed], { type: 'application/octet-stream' });
}

export async function decodeBackup(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.length <= MAGIC.length + IV_LENGTH || !MAGIC.every((b, i) => bytes[i] === b)) throw new InvalidBackupFile();
  try {
    const iv = bytes.subarray(MAGIC.length, MAGIC.length + IV_LENGTH);
    const packed = await crypto.subtle.decrypt({ name: ALGORITHM, iv, additionalData: MAGIC }, await backupKey(), bytes.subarray(MAGIC.length + IV_LENGTH));
    return JSON.parse(new TextDecoder().decode(await gunzip(new Uint8Array(packed))));
  } catch {
    throw new InvalidBackupFile();
  }
}
