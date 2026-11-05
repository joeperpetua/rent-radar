import { runScrape } from './scrape.js';
import { scrapeScope } from './prefs.js';

const scope = scrapeScope();
if (!scope) {
  console.log('No saved searches yet. Sign in to the web UI, set your filters and click "Search" first.');
  process.exit(1);
}

console.log('Scraping the union of all saved searches:', JSON.stringify(scope));
await runScrape(scope);
