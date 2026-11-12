import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipDir } from './zip.js';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const MANIFEST = fileURLToPath(new URL('../src/manifest.json', import.meta.url));
const PKG = fileURLToPath(new URL('../package.json', import.meta.url));
const LOCK = fileURLToPath(new URL('../package-lock.json', import.meta.url));

const GECKO_ID = 'rentradar-austria@joeperpetua';
const GECKO_MIN = '128.0';
const LEVELS = ['major', 'minor', 'patch'];

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const writeJson = (path, data) => writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);

function nextVersion(version, level) {
  const parts = String(version).split('.');
  const [major, minor, patch] = parts.map(Number);
  if (parts.length !== 3 || [major, minor, patch].some((n) => !Number.isInteger(n) || n < 0)) {
    console.error(`Cannot bump version "${version}". Expected major.minor.patch.`);
    process.exit(1);
  }
  if (level === 'major') return `${major + 1}.0.0`;
  if (level === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function bumpVersion(level) {
  const pkg = readJson(PKG);
  const manifest = readJson(MANIFEST);
  const lock = readJson(LOCK);
  const version = nextVersion(pkg.version, level);
  pkg.version = version;
  manifest.version = version;
  lock.version = version;
  if (lock.packages?.['']) lock.packages[''].version = version;
  writeJson(PKG, pkg);
  writeJson(MANIFEST, manifest);
  writeJson(LOCK, lock);
  return version;
}

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

const args = process.argv.slice(2);
const wanted = [];
let bump = null;

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--bump') {
    bump = args[i + 1] ?? '';
    i += 1;
  } else if (arg.startsWith('--bump=')) {
    bump = arg.slice('--bump='.length);
  } else if (LEVELS.includes(arg)) {
    bump = arg;
  } else {
    wanted.push(arg);
  }
}

if (bump !== null && !LEVELS.includes(bump)) {
  console.error(`Unknown bump: ${bump || '(empty)'}. Use: ${LEVELS.join(', ')}`);
  process.exit(1);
}

const TARGET_NAMES = ['chromium', 'firefox'];
const unknown = wanted.filter((t) => !TARGET_NAMES.includes(t));
if (unknown.length) {
  console.error(`Unknown argument: ${unknown.join(', ')}. Use a target (${TARGET_NAMES.join(', ')}) or a bump level (${LEVELS.join(', ')}).`);
  process.exit(1);
}

if (bump) console.log(`version: ${bumpVersion(bump)}`);

const base = readJson(MANIFEST);
const TARGETS = {
  chromium: base,
  firefox: geckoManifest(base),
};

for (const name of wanted.length ? wanted : TARGET_NAMES) {
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
