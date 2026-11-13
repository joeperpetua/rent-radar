import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';

const NAMES = [
  'arrow-left', 'arrow-right', 'arrow-up-down', 'arrow-up-right', 'bookmark', 'bookmark-plus', 'brush-cleaning', 'chevron-down', 'chevron-left', 'chevron-right',
  'circle-alert', 'circle-check', 'circle-dashed', 'clock', 'database', 'external-link', 'house', 'images', 'layers', 'list', 'loader-circle',
  'lock', 'map', 'map-pin', 'maximize-2', 'plus', 'radar', 'refresh-cw', 'save', 'search', 'search-x', 'sliders-horizontal',
  'monitor', 'moon', 'settings', 'sparkles', 'star', 'sun', 'trash-2', 'trending-down', 'x',
];
const LUCIDE = new URL('../node_modules/lucide-static/', import.meta.url);
const APP = new URL('../src/app/', import.meta.url);
const ATTRS = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

const body = (name) => readFileSync(new URL(`icons/${name}.svg`, LUCIDE), 'utf8')
  .replace(/<!--.*?-->/gs, '')
  .replace(/^\s*<svg[^>]*>|<\/svg>\s*$/gs, '')
  .replace(/\s*\n\s*/g, '')
  .replace(/\s*\/>/g, '/>');

const icons = Object.fromEntries(NAMES.map((name) => [name, body(name)]));

writeFileSync(new URL('icons.js', APP), `const ICONS = {
${Object.entries(icons).map(([name, svg]) => `  '${name}': '${svg}',`).join('\n')}
};

export const icon = (name, cls = '') => \`<svg class="icon\${cls ? \` \${cls}\` : ''}" ${ATTRS} aria-hidden="true" focusable="false">\${ICONS[name]}</svg>\`;

export function hydrateIcons(root = document) {
  for (const el of root.querySelectorAll('i[data-icon]')) el.outerHTML = icon(el.dataset.icon, el.className);
}
`);

writeFileSync(new URL('favicon.svg', APP), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#e5484d"/><g transform="translate(6 6) scale(.8333)" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${icons.house}</g></svg>
`);

copyFileSync(new URL('LICENSE', LUCIDE), new URL('lucide-LICENSE.txt', APP));
console.log(`wrote ${NAMES.length} icons`);
