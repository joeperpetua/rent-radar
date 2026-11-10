# RentRadar Austria

Unified rental search for Austria across **willhaben.at**, **immobilienscout24.at** and **rentola.at**. Scrapes all three, merges duplicate listings, and shows them in one UI with links to every original listing.

No dependencies; needs Node 22.13+ (uses the built-in `node:sqlite`).

```bash
npm start
```

Open http://localhost:3000.
- **Fresh install:** no filters are set and nothing is scraped until someone sets criteria and clicks **Search**.
- **After that:** every saved search is refreshed every `REFRESH_MINUTES` (30 by default).

One-off scrape of the saved search from the CLI (prints merged duplicates):

```bash
npm run scrape
```

Tests:

```bash
npm test
```

### Configuration

| Env var | Default | |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `HOST` | all interfaces | bind address |
| `DATA_DIR` | `./data` | where `immo.db` lives; put it on a persistent volume when hosting |
| `BETTER_AUTH_URL` | `http://localhost:$PORT` | public URL of the app; must match what the browser uses, or sign-in is rejected |
| `BETTER_AUTH_SECRET` | generated and stored in the DB | session signing secret; set it explicitly in production (`openssl rand -base64 32`) |
| `ALLOW_SIGNUP` | `true` | `false` closes registration; existing accounts can still sign in |
| `IP_HEADER` | unset | client IP header from your reverse proxy (e.g. `x-forwarded-for`) so login rate limits apply per IP; only set it behind a proxy |
| `REFRESH_MINUTES` | `30` | how often the union of all saved searches is re-scraped; `0` disables |
| `TRUSTED_ORIGINS` | the app URL | extra comma-separated origins allowed to call the auth API |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | unset | enable "Continue with Google"; both must be set |
| `GUEST_SEARCH_DAYS` | `7` | how long a guest's search stays in the scrape scope after its last visit; `0` scrapes only account searches |

The server closes the DB cleanly on `SIGINT`/`SIGTERM`. The SQLite file needs a persistent disk, so host it on a VPS or a container with a volume (e.g. Fly.io, Railway), not on serverless functions.

### Accounts and guests

Sign-in uses [Better Auth](https://www.better-auth.com) (email + password, optionally Google) in the same SQLite file; its tables are created on start-up.
- **Guests** can search and browse without an account.
  - Their search lives in an HttpOnly cookie (`rr_search`), so it survives reloads on that browser.
  - Each guest search is also recorded in `guest_searches` and joins the scrape scope for `GUEST_SEARCH_DAYS` after its last use (at most 5,000 are kept).
  - Clicking ☆ asks them to sign in; the listing is remembered and saved as a favourite once they do.
- **Accounts** keep their search (`user_prefs`), favourites (`favorites`) and UI language (`user_settings`) on the server, so they follow the user across devices.
  - On sign-in, a guest search is moved into an account that has none yet, and favourites kept in the browser by older versions are uploaded.
  - The account's language wins over the browser's; switching language saves it.
  - The first account created also takes over a search saved before accounts existed.
- `/api/favorites` and `/api/settings` need a session; everything else is public. A manual refresh is ignored within 2 minutes of the last scrape.
- The scraper works on the union of all account and recent guest searches (widest range, all chosen states, types and sites); each view filters that shared pool.

#### Google sign-in

1. In the [Google Cloud console](https://console.cloud.google.com/apis/credentials), create an OAuth client ID of type **Web application**.
2. Add the authorised redirect URI `<BETTER_AUTH_URL>/api/auth/callback/google`, e.g. `http://localhost:3000/api/auth/callback/google` and `https://rentradar.example.at/api/auth/callback/google`.
3. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` and restart; the button appears on the sign-in screen.

- A Google sign-in with the email of an existing **password** account is refused ("sign in with your password") until that email is verified. This is Better Auth's default and stops someone from pre-registering your address. A verified email (once email verification is set up) is linked automatically.
- `ALLOW_SIGNUP=false` also stops new accounts via Google.
- Google's access and refresh tokens are stored encrypted; the app never uses them.

### Docker

```bash
docker compose up -d --build
```

- Serves on http://localhost:3000; `PORT=8080 docker compose up -d` changes the host port.
- Data lives in the named volume `immo-data` (mounted at `/data`), so it survives rebuilds and `docker compose down`. Only `down -v` deletes it.
- The image is `node:24-alpine`; `npm ci --omit=dev` installs Better Auth, the only dependency.
  - It runs as the unprivileged `node` user, with timezone `UTC`. Timestamps are stored as UTC ISO strings, and the browser shows them in the viewer's local time.
  - It has a healthcheck on `/api/health` and stops cleanly within a couple of seconds.
- Back up the DB without stopping the container:

  ```bash
  docker exec immo-tool node --disable-warning=ExperimentalWarning -e "new (require('node:sqlite').DatabaseSync)('/data/immo.db').exec(\"VACUUM INTO '/data/backup.db'\")"
  docker cp immo-tool:/data/backup.db ./backup.db
  ```

- Set `BETTER_AUTH_URL` to the address people use (e.g. `https://rentradar.example.at`) and serve it over HTTPS through a reverse proxy (Caddy, Traefik, nginx).

### Going live checklist

- **HTTPS and secrets:**
  - Put a reverse proxy in front for HTTPS.
  - Set `BETTER_AUTH_URL`, a fixed `BETTER_AUTH_SECRET` and `IP_HEADER`.
  - Decide whether `ALLOW_SIGNUP` stays open.
- **Accounts:**
  - Password reset and email verification need an email provider (Better Auth supports both via `sendResetPassword` / `emailVerification` hooks); without them a forgotten password means manual help.
  - Google users don't need either.
  - For Google sign-in in production, publish the OAuth consent screen (app name, privacy policy URL, authorised domain); in "Testing" mode only listed test users can sign in.
- **Load:** every new state or wider range in any account or guest search widens what is scraped every `REFRESH_MINUTES`. With guests, anyone can widen it to all of Austria, so expect that as the steady state. Watch request volume to the portals and consider a longer interval or per-state caps as users grow.
- **Legal:**
  - The portals' terms forbid this kind of use (see [Portal terms of use](#portal-terms-of-use)); get written permission or a data feed before running it publicly.
  - An Austrian public site needs an Impressum.
  - Storing emails needs a privacy policy (GDPR). The `rr_search` and session cookies are strictly necessary, so they need no consent banner.

### Portal terms of use

Checked 2026-11-05. All three forbid automated access without written permission:

| Portal | Clause | Also forbids |
|---|---|---|
| ImmoScout24 ([AGB für Verbraucher](https://www.immobilienscout24.at/unternehmen/AGB/agb-fuer-verbraucher.html) §5(2), Stand 17.02.2024) | automated queries by scripts, bots or crawlers, data mining or extraction, unless allowed in writing | building your own database from the data, commercial use, linking the database with other (meta-)databases. It also claims database and database-work rights (§5(1)). |
| willhaben ([Nutzungsbedingungen](https://www.willhaben.at/iad/nutzungsbedingungen) §2, §3) | copying, publishing or making content available without the rights holders' consent, explicitly including copying by robots/crawlers | use of the data for commercial purposes or on other websites (§3) |
| Rentola ([Terms](https://rentola.at/en/terms-and-conditions) §3) | bots, scrapers, crawlers or other automated means without prior written permission | infringing third-party IP; rights in listing content stay with the rights holders (§6). UK law. |

- **Private use:** a private tool for yourself is still a breach of contract, but low-risk at its current volume.
- **Public site:** a public site that republishes their listings, photos and descriptions is exactly what these clauses target. Austrian and EU law give portals a separate database right (UrhG §76c ff., Database Directive), and the CJEU has applied it to a specialised meta-search engine (Innoweb v Wegener, C-202/12) and to job-ad aggregation that harms the portal's investment (CV-Online v Melons, C-762/19).
- **Options before going public:**
  - ask the portals for a partner feed or API access
  - show only short facts and link out instead of copying photos and descriptions
  - keep it private or invite-only (`ALLOW_SIGNUP=false`)
- **Operations:** schedule DB backups (see above), monitor `/api/health`, and keep the volume on a disk that survives redeploys.

## How it works

| Source | Data used | Server-side filters |
|---|---|---|
| willhaben | `__NEXT_DATA__` search result JSON (`mietwohnungen` / `haus-mieten`) | price, living area, room buckets |
| ImmoScout24 | `findPropertiesByParams` GraphQL, 100 per request; then a batched `expose` query on `/expose/graphql` for every picture and the full description (50 listings per request, resized to 1280px WebP) | price, area, rooms, `estateType` |
| Rentola | `SearchResultsPage` JSON-LD (`/wohnung/` / `/haus/`); then each listing's `RealEstateListing` JSON-LD for every picture and the description. A detail page is fetched once per listing and reused on later scrapes (at most 120 per run, 3 at a time) | `rent`, `size`, `rooms`, `order=newest` |

ImmoScout's GraphQL uses Automatic Persisted Queries. The scraper ships its own query and sends `sha256(query)` as the persisted ID. On `PERSISTED_QUERY_NOT_FOUND` it POSTs the full query with that hash, which registers it and returns the data. It never depends on ImmoScout's own (rotating) query ID. If GraphQL fails outright it falls back to `window.__INITIAL_STATE__`, which only holds the first 15 of each 25-hit page.

- **Region:** pick any of the nine states, or none for all of Austria (`src/geo.js` maps each state to willhaben `areaId`, ImmoScout `region` and Rentola's URL slug).
  - Each listing is tagged with its state: willhaben's `STATE` attribute, the searched state, or the postcode as a fallback.
  - Vienna districts appear in the filter once Wien is selected and only narrow Vienna listings; other places show their town.
  - Searches saved before region support keep Vienna.
- **Storage** (`src/db.js`): one SQLite file, `immo.db`, in `DATA_DIR`.
  - `listings` holds filter columns plus the normalized listing as JSON; `price_history`, `runs` and `meta` (prefs, last run) sit alongside.
  - A listing missing from a complete scrape gets `removed_at` instead of being deleted. It comes back with its original first-seen date if it reappears, and is purged after 90 days.
  - A failed or partial scrape (e.g. ImmoScout's HTML fallback) never marks anything as removed.
  - Each listing's price is recorded whenever it changes. The UI shows the latest change:
    - on cards, a drop badge plus the crossed-out old price
    - a "Preis gesenkt" filter and a "Größte Preissenkung" sort
    - on the detail screen, the change and a per-portal price history
  - An old `data/store.json` / `prefs.json` is imported on first start and renamed to `*.migrated`.
- A merged group uses the gallery of its member with the most pictures, so the same photos from two portals aren't shown twice, and the longest description.
- Deduplication runs once per scrape and filter scope and is cached in memory, about 1 s at 3k listings. Page requests, district changes and category toggles reuse the cache (about 5–30 ms).
- **Dedup** (`src/dedup.js`): candidate pairs (same postcode, or postcode unknown) are scored on:
  - title similarity, weighted by token rarity (IDF), so generic titles like "Gemeindewohnung Direktvergabe" count for little
  - area, price, rooms
  - street name (a mismatch is a strong penalty), precise coordinates, agency name

  Pairs are then clustered greedily from the strongest match down. A merge is refused if any two members conflict (different postcode, rooms off by more than 1, more than 2.5 km apart), or if two members from the same portal don't match each other directly.
  - Same-portal merges (reposts) need an identical title, price, rooms and area.
  - A title one portal uses at several prices is a project template, so those listings must match on price.
  - Rentola is an aggregator that often lists one flat several times through different agency feeds, sometimes with net rent (60–88% of gross) or an inflated area. Those copies are allowed to join when the title is identical.
  - Regression cases live in `test/dedup.test.js` (`npm test`).
- Prefs (stored in the DB) are edited in the sidebar: property type, min/max rent, size and rooms, districts, sources. Widening any range, adding a type or enabling a source triggers a re-scrape; tightening and district changes only filter.
- **Categories** (`src/categories.js`): each group is tagged as Gemeindewohnung/Wiener Wohnen, Genossenschaft, WG/Zimmer, Wohnungstausch, or regular. Tags come from title and description keywords, portal badges (`SOCIAL_HOUSING`, `COOPERATIVE_HOUSING`, willhaben's `Zimmer/WG`), and non-profit housing associations as advertiser. Tagging runs at view time, so keyword fixes apply to stored listings. A group is shown only if all of its tags are ticked, so unticking "Wohnungstausch" also hides a council-flat swap. Category toggles apply immediately without a re-scrape.
- While a scrape runs, the UI polls `/api/status` and shows a progress toast per source.
- UI language is German or English (`public/i18n.js`), auto-detected from the browser and switchable in the header.
- Descriptions are translated into the UI language with Chrome's built-in `LanguageDetector` and `Translator` APIs (`public/translate.js`), which run on-device.
  - If the model is already installed, the description translates automatically; otherwise a "Translate to …" button triggers the model download, which Chrome only allows after a click.
  - In other browsers, or if the API doesn't answer within 8 s, the original text is shown with no button.
- The detail view rates the location with Chrome's built-in Prompt API (`LanguageModel`, Gemini Nano) in `public/location.js`. It runs when a listing opens, never during scraping.
  - Nearby stops (U-Bahn, S-Bahn, tram, bus), shops, doctors, schools and parks within 1 km come from the public Overpass API (OpenStreetMap), tried across three mirrors and cached in `localStorage` for 30 days per coordinate.
  - The model gets these straight-line distances plus the description and returns 1–10 scores for transit, shops & services, green space and overall, with a short summary. Listings without coordinates, or when Overpass is down, are rated from address and description only, and the UI says so.
  - Like translation, it runs automatically when the model is installed; otherwise a button triggers the download. The panel stays hidden in browsers without the API.
- Favourites and language are stored per account; guests' language stays in the browser.

## Layout

```
src/
  server.js         HTTP server + API
  db.js             SQLite schema, writes, queries, legacy JSON import
  prefs.js          search preferences (defaults, validation)
  scrape.js         runs sources, saves results, caches dedup, builds the view
  categories.js     Gemeinde / Genossenschaft / WG / Tausch tagging
  dedup.js          duplicate scoring and grouping
  sources/*.js      one scraper per portal -> normalized listings
public/             UI (list + detail view)
data/               created at runtime
```
