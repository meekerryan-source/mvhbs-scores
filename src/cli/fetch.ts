// npm run fetch [-- --season 2026] [--sheet-only | --nflverse-only]
// Refreshes the on-disk caches (.cache/sheet, .cache/nflverse). Read-only against the sheet.
import { fetchSheetTabs } from '../data/sheet.js';
import { fetchNflverse } from '../data/nflverse.js';
import { loadConfig } from '../data/load.js';

const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const opt = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };

if (!flag('--nflverse-only')) { console.log('Google Sheet (read-only):'); await fetchSheetTabs(); }
if (!flag('--sheet-only')) {
  const season = Number(opt('--season')) || loadConfig().season;
  console.log(`nflverse ${season}:`);
  await fetchNflverse(season);
}
console.log('done.');
