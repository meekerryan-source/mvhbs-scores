// npm run parity -- --week 2 [--week 1 ...] | --all  [--refresh] [--force] [--live]
//
// Computes the week from nflverse + the sheet's inputs, then diffs it against the sheet's
// published outputs (Scored_Player_Game, Scored_DST_Game, Week_N, Points Log, Standings).
// Exit code 1 on any mismatch in an asserted week. A week is asserted once it is over on the
// sheet (Config live_week has moved past it, or the Week_N header says "Final"); --force asserts anyway.
// --live fills weeks nflverse hasn't published from ESPN, to compare against the sheet's live grid.

import { mkdirSync, writeFileSync } from 'node:fs';
import { loadEngineInput, loadLiveRules } from '../data/load.js';
import { fetchSheetTabs, hasCachedTab, readCachedTab } from '../data/sheet.js';
import { fetchNflverse } from '../data/nflverse.js';
import { fetchLiveWeek } from '../data/espn.js';
import { runSeason } from '../engine/season.js';
import { RULES_SNAPSHOT } from '../engine/rules.js';
import { formatReport, runParity } from '../parity/parity.js';
import { parsePointsLog, parseScoredDstGame, parseScoredPlayerGame, parseStandings, parseWeekGrid } from '../parity/sheetOutputs.js';

const args = process.argv.slice(2);
const weeks = args.flatMap((a, i) => (a === '--week' ? [Number(args[i + 1])] : [])).filter(Boolean);
if (!weeks.length && !args.includes('--all')) { console.error('usage: npm run parity -- (--week <n> [--week <m>] | --all) [--refresh] [--force] [--live]'); process.exit(2); }

if (args.includes('--refresh')) { await fetchSheetTabs(); await fetchNflverse(2026); }

const { input, config } = await loadEngineInput();
// --all: every week nflverse has published
if (args.includes('--all')) weeks.push(...[...new Set(input.stats.map(s => s.week))].filter(w => !weeks.includes(w)).sort((a, b) => a - b));
if (args.includes('--live')) {
  input.live = {};
  for (const w of weeks) if (!input.stats.some(s => s.week === w)) input.live[w] = await fetchLiveWeek(input.season, w, input.roster);
}
const maxWeek = Math.max(...weeks);
const season = runSeason(input, Array.from({ length: maxWeek }, (_, i) => i + 1));
const players = parseScoredPlayerGame(readCachedTab('Scored_Player_Game'), input.season);
const dst = parseScoredDstGame(readCachedTab('Scored_DST_Game'), input.season);
const log = parsePointsLog(readCachedTab('Points Log'));
const standings = parseStandings(readCachedTab('Standings'));

mkdirSync('reports', { recursive: true });
let failed = false;
for (const week of weeks) {
  const grid = hasCachedTab(`Week_${week}`) ? parseWeekGrid(readCachedTab(`Week_${week}`)) : null;
  const over = config.live_week > week || !!grid?.final;
  const assert = over || args.includes('--force');
  const skipReason = over ? undefined : `Config live_week is ${config.live_week} and the Week_${week} header is not "Final" — sheet week still live`;
  const report = runParity(season, week, { players, dst, grid, log, standings, liveRules: loadLiveRules() }, { assert, skipReason, snapshotRules: RULES_SNAPSHOT });
  const w = season.weeks.find(x => x.week === week)!;
  const text = formatReport(report, [...season.audit, ...w.audit]);
  console.log(text + '\n');
  writeFileSync(`reports/parity-w${week}.json`, JSON.stringify(report, null, 1));
  writeFileSync(`reports/parity-w${week}.txt`, text + '\n');
  if (assert && report.mismatches.length) failed = true;
}
process.exit(failed ? 1 : 0);
