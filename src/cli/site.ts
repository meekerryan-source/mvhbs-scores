// Site builder: computes every week that has a Week_N tab, nflverse stats or live ESPN data and writes
// the read-only site to dist/ (index.html + app.js + engine.js + style.css + data.json). No secrets in the output.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import type { EngineInput } from '../engine/season.js';
import type { SheetConfig } from '../data/load.js';
import { buildSync } from 'esbuild';
import { runSeason } from '../engine/season.js';
import { BUCKET_ORDER } from '../engine/lineup.js';
import { TEAM_ORDER } from '../engine/normalize.js';
import { SHEET_ID } from '../data/sheet.js';
import { weekJson } from '../web/present.js';

export function buildSite(input: EngineInput, config: SheetConfig, rulesSource: string): string {
const statWeeks = [...new Set([...input.stats.map(s => s.week), ...Object.keys(input.live ?? {}).map(Number)])];
const tabWeeks = existsSync('.cache/sheet') ? readdirSync('.cache/sheet').map(f => f.match(/^Week_(\d+)\.csv$/)?.[1]).filter(Boolean).map(Number) : [];
const maxWeek = Math.max(1, config.live_week, ...statWeeks, ...tabWeeks);
const weeks = Array.from({ length: maxWeek }, (_, i) => i + 1);
const season = runSeason(input, weeks);

const parity: Record<number, unknown> = {};
for (const w of weeks) {
  const p = `reports/parity-w${w}.json`;
  if (existsSync(p)) parity[w] = JSON.parse(readFileSync(p, 'utf8'));
}

const data = {
  season: season.season, generatedAt: new Date().toISOString(), liveWeek: config.live_week, rulesSource,
  teams: TEAM_ORDER, buckets: BUCKET_ORDER,
  weeks: season.weeks.map(weekJson),
  standings: season.standings,
  seasonAudit: season.audit,
  transactions: season.transactions,
  rules: input.rules,
  parity,
  // What the page needs to score a live week itself (see src/web/liveEngine.ts). Public league data only.
  base: { season: input.season, sheetId: SHEET_ID, rules: input.rules, roster: input.roster, transactions: input.transactions, doublers: input.doublers },
};

mkdirSync('dist', { recursive: true });
writeFileSync('dist/data.json', JSON.stringify(data));
for (const f of ['index.html', 'app.js', 'style.css']) copyFileSync(`src/web/${f}`, `dist/${f}`);
// The scoring engine, bundled for the browser so the page can score live games without a server.
buildSync({ entryPoints: ['src/web/liveEngine.ts'], bundle: true, format: 'esm', platform: 'browser', target: 'es2020', minify: true, outfile: 'dist/engine.js', logLevel: 'warning' });
return `dist/ built: weeks ${weeks.join(', ')} (${season.weeks.map(w => `W${w.week} ${w.status}`).join(', ')}); parity reports for ${Object.keys(parity).map(w => 'W' + w).join(', ') || 'none — run npm run parity first'}`;
}
