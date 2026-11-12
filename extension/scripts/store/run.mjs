import { parseArgs } from 'node:util';
import { startBrowser } from './browser.mjs';
import { scan } from './scan.mjs';
import { capture } from './capture.mjs';
import { compose } from './compose.mjs';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    lang: { type: 'string', default: 'en,de' },
    only: { type: 'string' },
  },
});

const STEPS = { scan, capture, compose };
const steps = positionals.length ? positionals : ['capture', 'compose'];
const unknown = steps.filter((s) => !STEPS[s]);
if (unknown.length) {
  console.error(`unknown step: ${unknown.join(', ')} (use ${Object.keys(STEPS).join(', ')})`);
  process.exit(1);
}

const langs = values.lang.split(',');
const only = values.only?.split(',');
const env = await startBrowser();
try {
  for (const step of steps) {
    console.log(`# ${step}`);
    await STEPS[step](env, langs, only);
  }
} finally {
  await env.close();
}
