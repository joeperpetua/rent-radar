import { feature, t } from './i18n.js';
import { icon } from './icons.js';
import { $ } from './dom.js';
import { esc, euro, fmtDate, fmtDay, num, signedEuro } from './format.js';
import { districtLabel, stateName } from './places.js';
import { api, isFav, sourceLabel, state } from './state.js';
import { toggleFav } from './favorites.js';
import { bindGallery, galleryHtml } from './gallery.js';
import { setupRating } from './ratingPanel.js';
import { setupTranslation } from './translationPanel.js';
import { sectionsHtml } from './sections.js';
import { loadFavorites } from './favoritesView.js';

function findGroup(id) {
  const own = state.data?.groups.find((x) => x.id === id);
  if (own) return own;
  for (const groups of state.favData?.values() ?? []) {
    const g = groups.find((x) => x.id === id);
    if (g) return g;
  }
  return null;
}

function priceHistoryHtml(g) {
  const withHistory = g.sources.filter((s) => s.priceHistory?.length > 1);
  if (!withHistory.length) return '';
  return `
    <div class="panel">
      <h2>${esc(t('priceHistory'))}</h2>
      ${withHistory.map((s) => `
        <div class="history">
          <strong class="history-source ${s.source}">${esc(sourceLabel(s))}</strong>
          <ol>
            ${s.priceHistory.map((h, i) => {
              const delta = i ? h.price - s.priceHistory[i - 1].price : 0;
              return `<li>
                <span class="h-date">${esc(fmtDay(h.at))}</span>
                <span class="h-price">${euro(h.price, 2)}</span>
                <span class="h-delta ${delta < 0 ? 'down' : delta > 0 ? 'up' : ''}">${i ? esc(signedEuro(Math.round(delta * 100) / 100)) : ''}</span>
              </li>`;
            }).join('')}
          </ol>
        </div>`).join('')}
    </div>`;
}

function factsHtml(g) {
  const priceDiffers = g.priceMin != null && g.priceMax - g.priceMin >= 1;
  const advertiser = g.isPrivate ? t('private') : g.agency ?? (g.isPrivate === false ? t('agency') : '–');
  return [
    ['fact.rent', euro(g.price, 2)],
    g.priceChange && ['fact.priceChange', `${signedEuro(g.priceChange.delta)} (${g.priceChange.pct > 0 ? '+' : g.priceChange.pct < 0 ? '−' : ''}${num(Math.abs(g.priceChange.pct), 1)} %) · ${fmtDay(g.priceChange.at)}`],
    priceDiffers && ['fact.priceRange', `${euro(g.priceMin)} – ${euro(g.priceMax)}`],
    ['fact.size', g.area ? `${num(g.area, 2)} m²` : '–'],
    ['fact.rooms', num(g.rooms, 1)],
    ['fact.sqm', g.pricePerSqm ? euro(g.pricePerSqm, 2) : '–'],
    ['fact.type', t(`type.${g.type}`)],
    ['fact.category', g.categories.map((c) => t(`cat.${c}`)).join(', ')],
    g.state === 'wien' && g.district
      ? ['fact.district', districtLabel(g.district)]
      : ['fact.place', [g.postcode, g.city].filter(Boolean).join(' ') || '–'],
    g.state !== 'wien' && g.district && ['fact.district', districtLabel(g.district)],
    g.state && ['fact.region', stateName(g.state)],
    g.floor && ['fact.floor', g.floor],
    ['fact.advertiser', advertiser],
    g.deposit && ['fact.deposit', euro(g.deposit, 2)],
    ['fact.published', fmtDate(g.publishedAt)],
    ['fact.firstSeen', fmtDate(g.firstSeen)],
  ].filter(Boolean).map(([k, v]) => `<div><dt>${esc(t(k))}</dt><dd>${esc(v)}</dd></div>`).join('');
}

export function renderDetail(id) {
  const g = findGroup(id);
  const el = $('#detail-view');
  if (!g) {
    const pending = !state.data || !state.favData;
    el.innerHTML = `<div class="detail"><div class="empty">${esc(pending ? t('loading') : t('notAvailable'))}</div></div>`;
    if (!state.favData) loadFavorites();
    return;
  }
  const priceDiffers = g.priceMin != null && g.priceMax - g.priceMin >= 1;
  const features = [...new Set(g.extras.map(feature).filter(Boolean))];

  const mapQuery = g.lat != null ? `${g.lat},${g.lng}` : `${g.address ?? g.city ?? ''}, Österreich`;
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`;
  const osm = g.lat != null
    ? `https://www.openstreetmap.org/export/embed.html?bbox=${g.lng - 0.008},${g.lat - 0.005},${g.lng + 0.008},${g.lat + 0.005}&layer=mapnik&marker=${g.lat},${g.lng}`
    : null;

  el.innerHTML = `
    <div class="detail">
      ${galleryHtml(g)}
      <div class="detail-grid">
        <div>
          <div class="detail-head">
            <h1>${esc(g.title)}</h1>
            <button class="btn fav-detail" type="button" data-action="fav-detail"></button>
          </div>
          ${g.reserved ? `<p class="reserved-note">${icon('lock')}<strong>${esc(t('badgeReserved'))}</strong><span>${esc(t('reservedHint'))}</span></p>` : ''}
          <div class="address">${esc(g.address ?? '')}</div>
          <dl class="keyfacts" id="keyfacts">${factsHtml(g)}</dl>
          ${features.length ? `<div class="panel"><h2>${esc(t('features'))}</h2><p class="description">${esc(features.join(' · '))}</p></div>` : ''}
          <div class="panel" id="description-panel">
            <div class="panel-head">
              <h2>${esc(t('description'))}</h2>
              <button type="button" class="link" id="translate-btn" hidden></button>
            </div>
            <p class="description" id="description-text">${esc(g.description || t('noDescription'))}</p>
            <p class="note" id="translate-note"></p>
          </div>
          <div id="detail-sections">${sectionsHtml(g.sections)}</div>
        </div>
        <aside>
          <div class="panel">
            <h2>${esc(t('originals', { n: g.sources.length }))}</h2>
            <div class="origin-list">
              ${g.sources.map((s) => {
                const url = s.sourceUrl || s.url;
                const label = sourceLabel(s);
                const actionLabel = t('openListing');

                return `
                  <a class="origin ${s.source}" href="${esc(url)}" target="_blank" rel="noopener noreferrer">
                    <strong>${esc(label)}${s.reserved ? `<span class="o-reserved">${esc(t('badgeReserved'))}</span>` : ''}</strong>
                    <span class="o-price">${euro(s.price, 2)}</span>
                    <span class="o-title">${esc(s.title)}</span>
                    <span class="o-open">${esc(actionLabel)}${icon('external-link')}</span>
                  </a>
                `;
              }).join('')}
            </div>
            ${priceDiffers ? `<div class="price-note">${esc(t('priceDiffers'))}</div>` : ''}
          </div>
          ${priceHistoryHtml(g)}
          <div class="panel">
            <h2>${esc(t('location'))}</h2>
            <div class="rating" id="rating" hidden>
              <div class="panel-head">
                <h3>${esc(t('rating.title'))}</h3>
                <button type="button" class="link" id="rating-btn" hidden>${esc(t('rating.run'))}</button>
              </div>
              <div id="rating-body"></div>
              <p class="note" id="rating-note"></p>
            </div>
            ${osm ? `<iframe class="map" src="${esc(osm)}" loading="lazy" title="${esc(t('map'))}"></iframe>` : ''}
            <a class="btn btn-block" href="${esc(mapsUrl)}" target="_blank" rel="noopener noreferrer">${icon('map')}<span>${esc(t('openMaps'))}</span>${icon('external-link', 'ext')}</a>
            ${osm ? `<p class="note">${esc(t('approxPosition'))}</p>` : ''}
          </div>
        </aside>
      </div>
    </div>`;

  const favBtn = $('[data-action="fav-detail"]', el);
  const syncFav = () => {
    const fav = isFav(g);
    favBtn.setAttribute('aria-pressed', String(fav));
    favBtn.innerHTML = `${icon('star', 'star')}<span class="fav-label">${esc(t(fav ? 'favRemove' : 'favAdd'))}</span>`;
    favBtn.title = t(fav ? 'favRemove' : 'favAdd');
  };
  syncFav();
  favBtn.addEventListener('click', () => toggleFav(g, syncFav));
  bindGallery(el, g);
  setupTranslation(g);
  setupRating(g);
  ensureDetails(g);
}

async function ensureDetails(g) {
  const truncated = !g.description || g.description.endsWith('...');
  const sourceWithDetail = g.sources.find((s) => s.source === 'willhaben' && (truncated || !s.detailed));
  if (!sourceWithDetail) return;
  try {
    const res = await api('fetchDetail', { id: sourceWithDetail.id });
    sourceWithDetail.detailed = true;
    const shown = state.detailShown === g.id;
    if (!g.sections?.length && res?.sections?.length) {
      g.sections = res.sections;
      const box = $('#detail-sections');
      if (box && shown) {
        box.innerHTML = sectionsHtml(g.sections);
        setupTranslation(g);
      }
    }
    if (g.deposit == null && res?.deposit) {
      g.deposit = res.deposit;
      const facts = $('#keyfacts');
      if (facts && shown) facts.innerHTML = factsHtml(g);
    }
    if (res?.description && res.description !== g.description) {
      g.description = res.description;
      const text = $('#description-text');
      if (text && state.detailShown === g.id) {
        text.textContent = res.description;
        setupTranslation(g);
        setupRating(g);
      }
    }
  } catch (err) {
    console.warn('[detail] fetch failed:', err);
  }
}
