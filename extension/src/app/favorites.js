import { $, reduceMotion, visibleCard } from './dom.js';
import { api, isFav, memberIds, state } from './state.js';

function popStar(id) {
  if (reduceMotion()) return;
  const card = visibleCard(id);
  for (const btn of [card?.querySelector('.fav'), $('#detail-view .fav-detail')]) {
    if (!btn) continue;
    btn.classList.remove('pop');
    void btn.offsetWidth;
    btn.classList.add('pop');
  }
}

export async function toggleFav(g, rerender) {
  const ids = memberIds(g);
  const add = !isFav(g);
  for (const id of ids) add ? state.favorites.add(id) : state.favorites.delete(id);
  rerender();
  if (add) popStar(g.id);
  try {
    const res = await api('favorites', add ? { add: ids } : { remove: ids });
    state.favorites = new Set(res.favorites);
  } catch {
    for (const id of ids) add ? state.favorites.delete(id) : state.favorites.add(id);
  }
  rerender();
}
