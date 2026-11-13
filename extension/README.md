# RentRadar Austria — browser extension (MV3, Chromium + Firefox)

Scans Austrian rental portals, dedups listings and keeps saved searches. Everything runs in the browser, no server:

- Scans run inside the extension's own page. Extension pages with `host_permissions` can fetch the portals cross-origin, which a normal web page can't (none of the portals send CORS headers).
- All data lives in IndexedDB on the extension's origin. `unlimitedStorage` protects it from eviction.

## Install

1. Open `chrome://extensions`, turn on **Developer mode**.
2. **Load unpacked** → pick `extension/src`.
3. Click the toolbar icon. It opens the app tab, or focuses the tab if it's already open.

Firefox: `npm run build:firefox`, then `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → pick `dist/firefox/manifest.json`.

Requires Chrome 116+ or Firefox 128+ (`runtime.getContexts`, host permissions granted at install). Translation and the AI location rating need Chrome 138+ (`Translator`, `LanguageModel`); elsewhere they're hidden.

```bash
npm install
npm test
```

Tests run the core against `fake-indexeddb`. The extension has no runtime dependencies; `src/` loads as-is in Chromium.

## Build

```bash
npm run build
npm run build:chromium
npm run build:firefox
npm run build patch
npm run build:firefox minor
```

`scripts/build.js` copies `src/` to `dist/<target>/`, writes the target's manifest and packs it as `dist/rentradar-<target>-<version>.zip` for store upload. A `major`, `minor` or `patch` argument raises the version in `package.json`, `package-lock.json` and `src/manifest.json` before the build, so the zips carry the new number. Without it the version stays as it is. `--bump patch` is the same thing spelled as a flag, but npm needs `npm run build -- --bump patch` to pass a flag through. The extension ships only through the stores; the landing page links to the listings and offers no downloads.

- **chromium**: `src/manifest.json` unchanged (service worker background). Upload to the Chrome Web Store; Edge, Brave, Vivaldi, Kiwi, Quetta and Orion install from there.
- **firefox**: `background.scripts` instead of `service_worker`, no `minimum_chrome_version`, plus `browser_specific_settings` (gecko id `rentradar-austria@joeperpetua`, min 128 on desktop and Android, `data_collection_permissions: none`). Upload to addons.mozilla.org; AMO signs it. `gecko_android` makes it listable for Firefox on Android. AMO warns that `data_collection_permissions` needs Firefox 140 (Android 142) while the floor is 128; the warning is expected and harmless, because older Firefox ignores the key. Raising the floor would drop Firefox 128 to 139. AMO also warns on every `innerHTML` template in `src/app/`; each one escapes its values with `esc()` from `format.js`.

The store links live in `STORES` in `landing/guides.js` and point at the two listings: the Chrome Web Store and `addons.mozilla.org/firefox/addon/rentradar/`.

## Release

`.github/workflows/release.yml` runs on demand from the Actions tab. Pick `patch`, `minor` or `major`, and the run tests the code, builds both targets with that bump, commits the new version to `main` as `chore(release)`, tags it `v<version>` and publishes a GitHub release.

The release carries the store links and three files: the chromium zip, the firefox zip that goes to AMO, and the same firefox zip named `.xpi`. The `.xpi` is unsigned, so it installs only in Firefox Developer Edition or Nightly with `xpinstall.signatures.required` set to false; release Firefox takes only the copy AMO signed. There is no `.crx`, because a Chromium zip renamed to `.crx` has no CRX header and Chrome rejects it. Packing a real one needs a private key in a repository secret.

The run pushes to `main` with the built-in `GITHUB_TOKEN`. The workflow asks for `contents: write`, which overrides a read-only default under Actions, General, Workflow permissions, so that setting needs no change. A branch protection rule on `main` would block the push; `main` is unprotected today.

## Store images

```bash
npm run store -- scan capture compose
```

`scripts/store/run.mjs` starts a headless Chrome with its own profile in `store/.profile/`, loads `src/` over CDP (`Extensions.loadUnpacked`, so branded Chrome works) and runs the given steps. Without steps it runs `capture compose`.

- **scan**: creates three demo searches (Vienna, Graz, Salzburg) in a fresh profile and scans the real portals; later runs rescan them.
- **capture**: raw app screenshots at 2× (phone 3×) into `store/raw/`. The scan radar comes from a live scan of a temporary Innsbruck search that is deleted afterwards.
- **compose**: captions and frames from `scripts/store/copy.mjs` and `template.html`, rendered to `store/<lang>/`: seven 1280×800 screenshots, the 440×280 small promo tile and the 1400×560 marquee. Also renders `src/app/favicon.svg` to `store/icon-128.png` (96px artwork with 16px transparent padding, the Chrome Web Store icon spec) and `store/icon-512.png`.

`--lang en,de` picks languages, `--only list,radar` (shots) or `--only 01-search,tile` (slides) limits a step. `CHROME` overrides the browser path. The Chrome Web Store takes five screenshots (01–05), AMO takes all seven.

## Landing page

`landing/` is a static page (preview: `landing` in `.claude/launch.json`, port 5181). The content script `src/landing.js` runs only on origins listed under `content_scripts` in the manifest (localhost and the GitHub Pages site `https://joeperpetua.github.io/rent-radar/`). It sets `data-rentradar` on `<html>` at `document_start`, so the page knows on load whether the extension is installed. The match is `http://localhost/*` because Firefox ignores ports in match patterns; the script itself only acts on port 5181 for localhost.

- First install: `runtime.onInstalled` (reason `install`) opens the app tab, so nobody has to come back and reload the landing page. Updates don't open anything.
- Installed: the page posts `rentradar:open`; the background focuses an open app tab, or navigates the landing tab to the app. Coming back via the back button doesn't reopen it. An *Open RentRadar* button stays as fallback.
- If the background does not answer within 1.5 seconds, or reports a failure, `src/landing.js` navigates the tab to the app page itself. That needs `app/index.html` in `web_accessible_resources`, limited to localhost and the Pages site. It keeps the button working where background messaging is incomplete, for example Orion on iOS. The background also survives a missing `runtime.getContexts` or `chrome.action`, which Chrome has and other engines may not.
- *The extension was updated or removed* shows only when the content script lost its extension context (`chrome.runtime.id` is gone), or when the direct navigation did not leave the page either.
- Not installed: install guides from `landing/guides.js`, picked by platform, each with a button to its store listing. Desktop: Chrome/Edge/Brave (Chrome Web Store) and Firefox (AMO). Android: Kiwi, Quetta, Vivaldi 8.2+ (Chrome Web Store) and Firefox 128+ (AMO). iOS: Orion (Chrome Web Store, after turning on Chrome extension support). Orion runs Chrome and Firefox extensions; the guide takes the Chrome one. The guide for the current browser is preselected; a desktop browser that can't run it (Safari, old versions) gets a warning above the guides.
- Extension reloaded or removed while the page was open: the content script answers `rentradar:stale` and the page asks for a reload.
- Text is in `landing/i18n.js` (DE/EN, switch in the header, remembered in `localStorage`).
- The landing page loads nothing from third parties; Plus Jakarta Sans is served from `landing/fonts/` (copied from `src/app/fonts/`).
- `landing/privacy.html` is the privacy policy (DE and EN side by side, the inactive language hidden), linked from the footer. Its URL goes into the privacy field of both store listings. Update it whenever the extension starts talking to a new kind of service.
- The sun/moon button in the header flips light/dark. It follows the system until clicked, then the choice is kept in `localStorage` and `landing/boot.js` applies it before first paint.
- `landing/radar.js` runs the scan radar from the app as a fixed backdrop: right side on wide screens, faded behind the header below 1100px. Blips are placed at random and pop as the sweep passes them, three more per sweep up to 28.

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
src/manifest.json   MV3 manifest, host permissions per source domain plus the Overpass servers (test/hosts.test.js checks coverage)
src/background.js   toolbar click or landing page → open/focus the app tab; closes duplicate app tabs (no `windows` API on Android is fine)
src/landing.js      content script on the landing page: install marker + open request
src/core/           db.js (IndexedDB), api.js, scan.js, prefs, dedup, categories, geo, http, sources/*
src/app/            UI + bridge.js
landing/            static landing page, not part of the extension
scripts/build.js    per-browser dist/ + store upload zips (zip.js is the zip writer)
scripts/store/      store screenshots and promo tiles from real scans
store/              generated store images per language; raw/ and .profile/ gitignored
dist/               build output, gitignored
```

- `bridge.js` opens the DB and exposes the `window.rentradar.call` / `onScanStatus` API to `app.js`.
- Only one app tab runs at a time (Web Locks). A second one hands focus to the first and closes, so two scan queues never run at once.
- Scans stop if the app tab is closed. Nothing scans in the background.
- `http.js` doesn't set `User-Agent`, so the browser sends its own.
- No contact data (phone, email) is parsed or stored. Contact goes through the linked original listing.

## Portal terms of use

Checked 2026-11-05. ImmoScout24, willhaben and Rentola all forbid automated access without written permission:

| Portal | Clause | Also forbids |
|---|---|---|
| ImmoScout24 ([AGB für Verbraucher](https://www.immobilienscout24.at/unternehmen/AGB/agb-fuer-verbraucher.html) §5(2), Stand 17.02.2024) | automated queries by scripts, bots or crawlers, data mining or extraction, unless allowed in writing | building your own database from the data, commercial use, linking the database with other (meta-)databases. It also claims database and database-work rights (§5(1)). |
| willhaben ([Nutzungsbedingungen](https://www.willhaben.at/iad/nutzungsbedingungen) §2, §3) | copying, publishing or making content available without the rights holders' consent, explicitly including copying by robots/crawlers | use of the data for commercial purposes or on other websites (§3) |
| Rentola ([Terms](https://rentola.at/en/terms-and-conditions) §3) | bots, scrapers, crawlers or other automated means without prior written permission | infringing third-party IP; rights in listing content stay with the rights holders (§6). UK law. |

Private use is still a breach of contract, but low-risk at its current volume.

## License

MIT, see `../LICENSE`. Bundled third-party work is listed in `../THIRD-PARTY-NOTICES.md`; the license texts ship inside the package, at `app/lucide-LICENSE.txt` and `app/fonts/*-LICENSE.txt`. On AMO, pick MIT as the source-code license to match.
