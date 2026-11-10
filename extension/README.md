# RentRadar Austria — Chrome extension (V3)

Scans Austrian rental portals, dedups listings and keeps saved searches. Everything runs in the browser, no server:

- Scans run inside the extension's own page. Extension pages with `host_permissions` can fetch the portals cross-origin, which a normal web page can't (none of the portals send CORS headers).
- All data lives in IndexedDB on the extension's origin. `unlimitedStorage` protects it from eviction.

## Install

1. Open `chrome://extensions`, turn on **Developer mode**.
2. **Load unpacked** → pick `extension/src`.
3. Click the toolbar icon. It opens the app tab, or focuses the tab if it's already open.

Requires Chrome 116+ (`chrome.runtime.getContexts`). Translation and the AI location rating need Chrome 138+ (`Translator`, `LanguageModel`).

```bash
npm install
npm test
```

Tests run the core against `fake-indexeddb`. The extension itself has no runtime dependencies and no build step.

Fonts are Inter and Plus Jakarta Sans (OFL, see `src/app/fonts/`), bundled because the CSP blocks font CDNs. `npm run fonts` copies them from `@fontsource-variable`.

Icons are [Lucide](https://lucide.dev) (ISC, see `src/app/lucide-LICENSE.txt`). `npm run icons` regenerates `src/app/icons.js` and `src/app/favicon.svg` from `lucide-static`. Add a name to `scripts/icons.js` to use a new icon. The toolbar PNGs in `src/icons/` are renders of `favicon.svg`.

## UI behaviour

- Filters are literal: what is ticked is what you get. Nothing ticked in a group means nothing from it; everything ticked means all of it. Every group has All / None buttons, switches included.
- A new search starts with every source ticked and nothing else. *Create & scan* stays disabled until regions, type, category, source (and districts, when Vienna is ticked) each have a pick; empty groups show *none selected*.
- Saved searches live in the dropdown at the top right, which shows the active search's name. Hovering a search shows two actions: rescan it, or delete it after confirming in a modal. Deleting removes only the search (its preferences); the listings, price history and scans it found stay in IndexedDB.
- The top bar shows the active search's total hits; hovering (or focusing) it shows the count per portal and any portal errors.
- The star in the top bar opens `#/favorites`. A sidebar lists every saved search with its number of favourites; it starts on the active search. The page shows the favourites of the selected search only, with stats for that search (count, average rent, price per m², size, rent range) and buttons to rescan, delete or open its results. A search without favourites shows a note instead. Listings opened from there return to the favourites.
- Scans start only when you ask: on create, on *Refresh* (active search), or from a search's rescan action. Nothing scans on a schedule.
- A search with no results yet (new, or never scanned) shows a radar with live progress per portal while it scans. Rescans of a search that already has results keep the toasts.
- The gear at the top right opens settings: style, appearance (System / Light / Dark, `theme` setting, mirrored to `localStorage` like the style) and language. Picking a style closes the menu; the appearance and language switches slide to the new choice and keep it open. Styles are *Styled* (default; rounded, airy, Plus Jakarta Sans), *Modern* (the original photo cards, Inter) and *Compact* (dense list rows with the price right next to the photo, Inter). The style is a `style` setting in IndexedDB, mirrored to `localStorage` so `boot.js` applies it before first paint. Styled and Compact are blocks of `[data-style]` rules at the end of `style.css`; Modern is the base stylesheet. All follow the system light/dark mode.
- `design/variants.html` is a standalone preview of the five candidate styles; it is not part of the extension.
- On phones (up to 600px) the top bar holds only the search selector, the hit count and settings; pulling the list down from the top rescans the active search, and swiping a listing's photo down goes back to the results. A bottom bar switches between Filters, Listings and Favourites. Filters open as a full-screen drawer that slides in from the left, scrolls on its own, keeps *Save* pinned at the bottom, and closes with the button top right or Escape.
- Motion: cards stagger in and newly found listings animate in after a rescan. Sorting and filtering reflow with FLIP. Opening a listing morphs the card photo into the gallery (View Transitions). The lightbox zooms from the clicked image and back. Favourites pop, toasts slide, detail panels rise. All of it is off under `prefers-reduced-motion`.

## Data

IndexedDB database `rentradar`, object stores:

- `searches`: name, filter prefs, scope of the last scan
- `listings`: normalized listing (`data`), filter columns, `firstSeen` / `lastSeen`, and the price history as `prices: [{ at, price }]`. Listings are shared by all searches.
- `searchListings`: which search found which listing (`[searchId, listingId]`), with per-search `firstSeen` / `lastSeen` / `removedAt`
- `scans`: one record per scan, with per-portal results in `sources` (ok, error, count, ms, partial)
- `favorites`, `settings`, `meta` (data version for the view cache)

Deleting a search keeps everything it found. A listing missing from a complete scan is marked removed for that search only. Failed or partial scans never remove anything. Removed rows are purged after 90 days, and listings no search references are deleted.

Searches saved by an earlier version, where an empty group meant "any", are migrated to everything ticked (DB version 2).

Inspect or clear the data in DevTools on the app tab → Application → IndexedDB.

## Layout

```
src/manifest.json   MV3 manifest, host permissions for willhaben, ImmoScout24 and https://*/*
src/background.js   toolbar click → open/focus the app tab; closes duplicate app tabs
src/core/           db.js (IndexedDB), api.js, scan.js, prefs, dedup, categories, geo, http, sources/*
src/app/            UI + bridge.js
```

- `bridge.js` opens the DB and exposes the `window.rentradar.call` / `onScanStatus` API to `app.js`.
- Only one app tab runs at a time (Web Locks). A second one hands focus to the first and closes, so two scan queues never run at once.
- Scans stop if the app tab is closed. Nothing scans in the background.
- `http.js` doesn't set `User-Agent`, so the browser sends its own.

## Portal terms of use

Checked 2026-11-05. ImmoScout24, willhaben and Rentola all forbid automated access without written permission:

| Portal | Clause | Also forbids |
|---|---|---|
| ImmoScout24 ([AGB für Verbraucher](https://www.immobilienscout24.at/unternehmen/AGB/agb-fuer-verbraucher.html) §5(2), Stand 17.02.2024) | automated queries by scripts, bots or crawlers, data mining or extraction, unless allowed in writing | building your own database from the data, commercial use, linking the database with other (meta-)databases. It also claims database and database-work rights (§5(1)). |
| willhaben ([Nutzungsbedingungen](https://www.willhaben.at/iad/nutzungsbedingungen) §2, §3) | copying, publishing or making content available without the rights holders' consent, explicitly including copying by robots/crawlers | use of the data for commercial purposes or on other websites (§3) |
| Rentola ([Terms](https://rentola.at/en/terms-and-conditions) §3) | bots, scrapers, crawlers or other automated means without prior written permission | infringing third-party IP; rights in listing content stay with the rights holders (§6). UK law. |

Private use is still a breach of contract, but low-risk at its current volume.
