// Site builder: computes every week that has a Week_N tab, nflverse stats or live ESPN data and writes
// the read-only site to dist/ (index.html + app.js + engine.js + style.css + data.json). No secrets in the output.

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import type { EngineInput } from '../engine/season.js';
import type { SheetConfig } from '../data/load.js';
import { buildSync } from 'esbuild';
import { runSeason } from '../engine/season.js';
import { BUCKET_ORDER } from '../engine/lineup.js';
import { TEAM_ORDER } from '../engine/normalize.js';
import { SHEET_ID } from '../data/sheet.js';
import { weekJson } from '../web/present.js';
import { loadIr } from '../data/injuries.js';
import { normName } from '../engine/normalize.js';

export function buildSite(input: EngineInput, config: SheetConfig, rulesSource: string): string {
const statWeeks = [...new Set([...input.stats.map(s => s.week), ...Object.keys(input.live ?? {}).map(Number)])];
const tabWeeks = existsSync('.cache/sheet') ? readdirSync('.cache/sheet').map(f => f.match(/^Week_(\d+)\.csv$/)?.[1]).filter(Boolean).map(Number) : [];
const maxWeek = Math.max(1, config.live_week, ...statWeeks, ...tabWeeks);
const weeks = Array.from({ length: maxWeek }, (_, i) => i + 1);
const season = runSeason(input, weeks);

// Each rostered player's most recent NFL team (from the latest stat line) — roster teams go stale
// after trades (Daniel Carlson LV → NO) or are blank (Stefon Diggs).
const latestTeam: Record<string, string> = {};
const byName = new Map<string, { week: number; team: string }>();
for (const s of input.stats) {
  const k = normName(s.player_display_name);
  const cur = byName.get(k);
  if (!cur || s.week >= cur.week) byName.set(k, { week: s.week, team: s.team });
}
for (const r of input.roster) { const hit = byName.get(normName(r.player)); if (hit) latestTeam[normName(r.player)] = hit.team; }
const ir = loadIr();

const parity: Record<number, unknown> = {};
for (const w of weeks) {
  const p = `reports/parity-w${w}.json`;
  if (existsSync(p)) parity[w] = JSON.parse(readFileSync(p, 'utf8'));
}

const data = {
  season: season.season, generatedAt: new Date().toISOString(), liveWeek: config.live_week, rulesSource,
  teams: TEAM_ORDER, buckets: BUCKET_ORDER,
  weeks: season.weeks.map(w => weekJson(w, latestTeam)),
  // Official NFL Injured Reserve (ESPN), refreshed by the daily build. Matched to rosters in the page.
  ir: ir ? { fetchedAt: ir.fetchedAt, players: ir.players } : null,
  standings: season.standings,
  seasonAudit: season.audit,
  transactions: season.transactions,
  rules: input.rules,
  parity,
  // What the page needs to score a live week itself (see src/web/liveEngine.ts). Public league data only.
  base: { season: input.season, sheetId: SHEET_ID, rules: input.rules, roster: input.roster, transactions: input.transactions, doublers: input.doublers, latestTeam },
};

mkdirSync('dist', { recursive: true });
writeFileSync('dist/data.json', JSON.stringify(data));
// The scoring engine, bundled for the browser so the page can score live games without a server.
buildSync({ entryPoints: ['src/web/liveEngine.ts'], bundle: true, format: 'esm', platform: 'browser', target: 'es2020', minify: true, outfile: 'dist/engine.js', logLevel: 'warning' });
copyFileSync('src/web/style.css', 'dist/style.css');
copyFileSync('src/web/manifest.webmanifest', 'dist/manifest.webmanifest');
mkdirSync('dist/icons', { recursive: true });
for (const f of ['icon-192.png', 'icon-512.png', 'apple-touch-icon.png']) copyFileSync(`src/web/icons/${f}`, `dist/icons/${f}`);
// Cache-busting: browsers (and GitHub Pages' 10-minute cache) keep old copies of app.js etc., so
// every asset URL carries a hash of its contents — a changed file gets a new URL phones must fetch.
const v = (f: string) => createHash('sha256').update(readFileSync(f)).digest('hex').slice(0, 10);
const engineV = v('dist/engine.js');
writeFileSync('dist/app.js', readFileSync('src/web/app.js', 'utf8').replace("from './engine.js'", `from './engine.js?v=${engineV}'`));
writeFileSync('dist/index.html', readFileSync('src/web/index.html', 'utf8')
  .replace('href="style.css"', `href="style.css?v=${v('dist/style.css')}"`)
  .replace('src="app.js"', `src="app.js?v=${v('dist/app.js')}"`));
return `dist/ built: weeks ${weeks.join(', ')} (${season.weeks.map(w => `W${w.week} ${w.status}`).join(', ')}); parity reports for ${Object.keys(parity).map(w => 'W' + w).join(', ') || 'none — run npm run parity first'}`;
}
