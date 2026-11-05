import { copyFileSync, mkdirSync } from 'node:fs';

const FONTS = [
  ['inter', 'inter-latin-wght-normal.woff2'],
  ['plus-jakarta-sans', 'plus-jakarta-sans-latin-wght-normal.woff2'],
];
const OUT = new URL('../src/app/fonts/', import.meta.url);

mkdirSync(OUT, { recursive: true });
for (const [pkg, file] of FONTS) {
  const src = new URL(`../node_modules/@fontsource-variable/${pkg}/`, import.meta.url);
  copyFileSync(new URL(`files/${file}`, src), new URL(file, OUT));
  copyFileSync(new URL('LICENSE', src), new URL(`${pkg}-LICENSE.txt`, OUT));
}
console.log(`copied ${FONTS.length} fonts`);
