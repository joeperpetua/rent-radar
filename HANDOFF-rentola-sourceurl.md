# Handoff: link Rentola listings to their original source

## Goal

Rentola (rentola.at) only re-publishes listings it scraped from other sites. It holds no landlord contact data and charges a subscription to "contact the landlord". Each Rentola listing exposes the original ad's URL in its page payload. Store that URL and link users to the original ad, not to Rentola.

## Findings to rely on (verified 2026-11-05)

These come from all 1,273 rentola.at listings in `data/immo.db`.

- A detail page fetched with request header `RSC: 1` returns the Next.js flight payload, about 640 KB. Plain HTML works too, but it is larger (about 860 KB).
- The payload contains a JSON object `"propertyAttributes":{...}`. Parse it with string-aware balanced-brace matching.
- `propertyAttributes` has these fields:
  - `sourceUrl`: the original ad.
  - `source`: `"spider"` on all 1,210 parseable listings.
  - `status`: `"active"`.
  - `images[].data.attributes.externalUrl`
  - `desc`
  - `monthlyRent`
  - `area`
  - `estimatedArea`: true means Rentola guessed the area.
  - `createdAt`, `updatedAt`
  - `contactEmail`, `contactPhone`, `contactFirstname`, `contactLastname`: always null.
- `revaId === md5(sourceUrl)`. The slug suffix is `p` + `revaId.slice(0, 6)`, so a listing's identity is the source URL.
- Deactivated listings answer HTTP 200 but redirect to a city search page with `?inactive_property_id=…`. There is no `propertyAttributes` in that case. 63 of 1,273 were in this state.
- About 97.5% of `sourceUrl`s were still live. Gone ones return 404, or redirect to e.g. `…/search-object-not-found` on edireal.
- Source hosts:
  - 179 distinct hosts: agency sites (often justimmo / EDI-Real / onOffice / immo-export.at hosted), housing cooperatives (wag.at, bwsg.at, oevw.at, …) and xpatrentals.com.
  - Partner feeds tagged `utm_source=rentola`: wunderflats.com (`/g/<code>` short links that redirect to the listing), spotahome.com, flatio.de, spacest.com.
  - Some `sourceUrl`s carry search-filter query params (`f[all][marketing_type]=…`, `from=…`). They still open the object page.
- Reference parser: `C:\Users\joelp\AppData\Local\Temp\claude\77222342b3855c40\f75fda9c-a110-4ed8-9175-b72f8d909e28\scratchpad\harvest.mjs` (functions `balanced`, `objectAfter`).
- Harvested data: `…\scratchpad\harvest\rentola-at.jsonl`.

## Current code

- `src/sources/rentola.js`:
  - `fetchDetails(url)` reads the `RealEstateListing` JSON-LD for images and description.
  - `addDetails` caches by `detailsAt` and caps detail fetches at `MAX_DETAIL_FETCHES_PER_RUN = 120`, with concurrency 3.
- `desktop/src/core/sources/rentola.js` and `extension/src/core/sources/rentola.js` are near-identical copies. Apply the same change to all three.
- `src/dedup.js`, `buildGroup`: `sources[]` exposes `{ id, source, url, title, price, area, rooms, firstSeen }`.
- `public/app.js:430` and `public/app.js:555` render `href="${esc(s.url)}"` per source.

## Work

1. **Parser.** In each `rentola.js`, change `fetchDetails` to request the flight payload (`fetchText(url, { accept })` and send an `RSC: 1` header).
   - `src/http.js` `fetchText` has no custom-header option yet. Add one, or a small dedicated fetch.
   - Parse `propertyAttributes`.
   - Return `{ images, description, sourceUrl, sourceHost, estimatedArea, rentolaStatus }`.
   - Keep the JSON-LD path as a fallback if `propertyAttributes` is missing.
2. **Inactive detection.**
   - If the response URL contains `inactive_property_id`, or `propertyAttributes` is absent, treat the listing as deactivated: drop it, or mark it removed.
   - Do not count that as a detail failure.
3. **Clean the URL.**
   - Strip `utm_*` params from `sourceUrl` before storing.
   - Keep everything else; object pages need some of their params.
4. **Persist.**
   - Store `sourceUrl` and `sourceHost` on the listing object (it lives in `listings.data` JSON, so no schema change is needed).
   - Carry them through the `stored` cache path in `addDetails`, the same way as `images`/`description`.
   - Listings whose details were cached before this change have `detailsAt` but no `sourceUrl`. Re-fetch those: treat a missing `sourceUrl` as "details pending".
5. **Dedup output.** Add `sourceUrl` and `sourceHost` to the `sources[]` entries in `buildGroup`.
6. **UI** (`public/app.js` plus the desktop and extension renderers):
   - For rentola entries with a `sourceUrl`, link to the original and label it with the host, e.g. "Original: wag.at".
   - Keep a secondary link to Rentola, or drop it. Ask the user which.
   - Add i18n strings in `public/i18n.js` (and the counterparts).
7. **Optional.** If a rentola listing's `sourceHost` is willhaben.at or immobilienscout24.at (none seen so far), the existing portal listing already covers it. Hide the Rentola entry in that case.
8. **Throughput.**
   - The first run must fetch `sourceUrl` for every existing listing (about 800 active). At the 120/run cap that takes about 7 refreshes.
   - Either raise the cap temporarily, or accept the gradual backfill. The current politeness settings (concurrency 3, 300 ms sleep) were fine for 1,273 fetches at concurrency 4.

## Tests

- Unit test the `propertyAttributes` extraction against a small trimmed fixture:
  - one active payload
  - one inactive redirect case
  - one payload where `propertyAttributes` is missing
- Unit test the utm stripping.
- Extend `test/dedup.test.js` (and the desktop/extension copies) so `sources[]` carries `sourceUrl`.
- Run `npm test` in the root, `desktop/` and `extension/`.

## Done when

- Rentola listings in the web UI, the desktop app and the extension link to the original ad.
- Deactivated Rentola listings no longer show.
- All test suites pass.
- Verify in the preview: `preview_start` with name `immo-tool`, then open a Rentola-sourced card and check the link target.
