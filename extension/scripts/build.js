import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipDir } from './zip.js';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const DIST = fileURLToPath(new URL('../dist/', import.meta.url));

const GECKO_ID = 'rentradar-austria@joeperpetua';
const GECKO_MIN = '128.0';

const base = JSON.parse(readFileSync(new URL('../src/manifest.json', import.meta.url), 'utf8'));

function geckoManifest({ minimum_chrome_version, background, ...rest }) {
  return {
    ...rest,
    background: { scripts: [background.service_worker] },
    browser_specific_settings: {
      gecko: {
        id: GECKO_ID,
        strict_min_version: GECKO_MIN,
        data_collection_permissions: { required: ['none'] },
      },
      gecko_android: { strict_min_version: GECKO_MIN },
    },
  };
}

const TARGETS = {
  chromium: base,
  firefox: geckoManifest(base),
};

const wanted = process.argv.slice(2);
const unknown = wanted.filter((t) => !(t in TARGETS));
if (unknown.length) {
  console.error(`Unknown target: ${unknown.join(', ')}. Use: ${Object.keys(TARGETS).join(', ')}`);
  process.exit(1);
}

for (const name of wanted.length ? wanted : Object.keys(TARGETS)) {
  const manifest = TARGETS[name];
  const out = `${DIST}${name}`;
  const pkg = `${DIST}rentradar-${name}-${manifest.version}.zip`;
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  cpSync(SRC, out, { recursive: true });
  writeFileSync(`${out}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  const { buffer, count } = zipDir(out);
  writeFileSync(pkg, buffer);
  console.log(`${name}: ${relative(process.cwd(), pkg)} (${count} files)`);
}
