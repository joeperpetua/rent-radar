import { esc } from './format.js';

export const splitItem = (item) => {
  const at = item.indexOf(': ');
  return at > 0 ? [item.slice(0, at), item.slice(at + 2)] : [null, item];
};

export function sectionsHtml(sections) {
  return (sections ?? []).map((section) => `
    <div class="panel">
      <h2>${esc(section.title)}</h2>
      <dl class="section-list">
        ${section.items.map((item) => {
          const [key, value] = splitItem(item);
          return key
            ? `<div><dt>${esc(key)}</dt><dd>${esc(value)}</dd></div>`
            : `<div class="wide"><dd>${esc(value)}</dd></div>`;
        }).join('')}
      </dl>
    </div>`).join('');
}
