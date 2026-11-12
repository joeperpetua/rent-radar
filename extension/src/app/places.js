import { t } from './i18n.js';
import { state } from './state.js';

export function districtLabel(n) {
  const d = state.config?.districts.find((x) => x.number === n);
  return d ? `${n}. ${d.name}` : null;
}

export const stateName = (id) => (id ? t(`state.${id}`) : null);

export function placeLabel(g) {
  if (g.state === 'wien' && g.district) return districtLabel(g.district);
  return g.city ?? stateName(g.state);
}
