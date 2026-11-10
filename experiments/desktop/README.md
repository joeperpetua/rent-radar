# RentRadar Austria — Desktop (V2)

Desktop version of the webapp in the parent folder. Same scrapers, dedup and UI, but:

- **No accounts, no server.** Everything lives in one local SQLite file.
- **Saved searches.** Each search is scanned on its own and keeps its own result set, scan history and "new" markers.
- **Scans run on demand:** a new search is scanned right away. Click **Scannen** for the active search or **Alle scannen** for all. Auto-refresh while the app is open is optional (sidebar, off by default).

```bash
npm install
npm start
```

```bash
npm test
```

Build an installer and a portable `.exe` into `dist/`:

```bash
npm run dist
```

## Data

- DB file: `%APPDATA%\rentradar-desktop\rentradar.db` (Electron `userData`). Override it with `RENTRADAR_DB=<path>`.
- Tables:
  - `searches`: name, filter prefs, and the scope of the last scan
  - `scans` / `scan_sources`: one row per scan and per portal (ok, error, count, ms, partial)
  - `listings` / `price_history`: normalized listings, shared by all searches, so a listing found by two searches is stored once and keeps one price history
  - `search_listings`: which search found which listing, with per-search `first_seen` / `last_seen` / `removed_at`
  - `favorites`, `settings` (language, active search, list view, auto-refresh)
- A listing missing from a complete scan is marked removed for **that search only**. A failed or partial scan never removes anything. Removed rows are purged after 90 days, and listings no search references are deleted.
- Editing a search only rescans when a scan-relevant filter is widened (region, type, portal, wider price/area/room range). Narrowing, districts and categories just filter the stored results.

## Layout

```
src/main/       Electron main process (window, app:// protocol, IPC, auto-refresh) + preload bridge
src/core/       db.js, api.js (IPC handlers), scan.js (queue, view), prefs.js, dedup, categories, geo, sources/*
src/renderer/   UI (index.html, app.js, i18n, translate, location, style.css)
```

- The renderer is sandboxed with context isolation. It talks to the main process only through `window.rentradar.call(method, payload)`, and receives scan progress via `onScanStatus`.
- Scans run one at a time in a queue, so the portals see the same request pattern as the webapp.
- External links (listings, Google Maps) open in the system browser.

## Differences from the webapp

- Description translation and the AI location rating use Chrome's built-in AI APIs (`Translator`, `LanguageModel`). Electron does not ship them, so both panels stay hidden. Everything else works as in the browser.
- The portals' terms of use still apply (see the parent README). A desktop app for your own use is the low-risk case described there.
