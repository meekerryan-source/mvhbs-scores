// nflverse downloads (official stats). Cached under .cache/nflverse/.

import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'csv-parse';
import type { GameResult, PlayerWeekStats, TdRow } from '../engine/types.js';
import { normTeam } from '../engine/normalize.js';
import { extractTdRows } from '../engine/pbp.js';
import { parseCsvRecords } from './csv.js';

export const NFLVERSE_CACHE = '.cache/nflverse';
const REL = 'https://github.com/nflverse/nflverse-data/releases/download';
export const urls = (season: number) => ({
  stats: `${REL}/stats_player/stats_player_week_${season}.csv`,
  pbp: `${REL}/pbp/play_by_play_${season}.csv`,
  games: 'https://github.com/nflverse/nfldata/raw/master/data/games.csv',
});
export const files = (season: number) => ({
  stats: join(NFLVERSE_CACHE, `stats_player_week_${season}.csv`),
  pbp: join(NFLVERSE_CACHE, `play_by_play_${season}.csv`),
  games: join(NFLVERSE_CACHE, 'games.csv'),
});

export async function fetchNflverse(season: number, log: (s: string) => void = console.log): Promise<void> {
  mkdirSync(NFLVERSE_CACHE, { recursive: true });
  const u = urls(season);
  const f = files(season);
  for (const k of ['stats', 'pbp', 'games'] as const) {
    const res = await fetch(u[k], { redirect: 'follow' });
    if (!res.ok) throw new Error(`nflverse ${k}: HTTP ${res.status} (${u[k]})`);
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(f[k], buf);
    log(`  nflverse ${k.padEnd(6)} ${buf.length.toLocaleString().padStart(12)} bytes`);
  }
}

function need(p: string): string {
  if (!existsSync(p)) throw new Error(`Missing ${p} — run \`npm run fetch\` first.`);
  return p;
}

const n = (v: string | undefined) => {
  if (v == null || v === '' || v === 'NA') return 0;
  const x = Number(v);
  return Number.isNaN(x) ? 0 : x;
};

/** nflverse stats_player_week record → PlayerWeekStats (numbers coerced, teams normalised). */
export function toPlayerWeekStats(r: Record<string, string>): PlayerWeekStats {
  return {
    season: n(r.season), week: n(r.week), season_type: r.season_type, game_id: r.game_id ?? '',
    player_id: r.player_id, player_display_name: r.player_display_name || r.player_name,
    position: r.position === 'NA' ? '' : r.position ?? '', position_group: r.position_group === 'NA' ? '' : r.position_group ?? '',
    team: normTeam(r.team), opponent_team: normTeam(r.opponent_team),
    passing_yards: n(r.passing_yards), passing_tds: n(r.passing_tds), passing_interceptions: n(r.passing_interceptions),
    passing_2pt_conversions: n(r.passing_2pt_conversions),
    rushing_yards: n(r.rushing_yards), rushing_tds: n(r.rushing_tds), rushing_2pt_conversions: n(r.rushing_2pt_conversions),
    receptions: n(r.receptions), receiving_yards: n(r.receiving_yards), receiving_tds: n(r.receiving_tds),
    receiving_2pt_conversions: n(r.receiving_2pt_conversions), special_teams_tds: n(r.special_teams_tds),
    fg_made: n(r.fg_made), fg_att: n(r.fg_att),
    fg_made_list: r.fg_made_list === 'NA' ? '' : r.fg_made_list ?? '', fg_missed_list: r.fg_missed_list === 'NA' ? '' : r.fg_missed_list ?? '',
    pat_made: n(r.pat_made), pat_att: n(r.pat_att), pat_missed: n(r.pat_missed),
    def_sacks: n(r.def_sacks), def_interceptions: n(r.def_interceptions), def_tds: n(r.def_tds),
    fumble_recovery_opp: n(r.fumble_recovery_opp), fumble_recovery_tds: n(r.fumble_recovery_tds),
  };
}

export function loadStats(season: number): PlayerWeekStats[] {
  return parseCsvRecords(readFileSync(need(files(season).stats), 'utf8'))
    .filter(r => r.player_id)
    .map(toPlayerWeekStats)
    .filter(s => s.season === season);
}

/** Streams the (large) PBP CSV and keeps only REG touchdown plays for the season. */
export async function loadTdRows(season: number): Promise<TdRow[]> {
  const out: TdRow[] = [];
  const parser = createReadStream(need(files(season).pbp)).pipe(parse({ columns: true, relax_column_count: true, bom: true }));
  for await (const rec of parser as AsyncIterable<Record<string, string>>) {
    if (rec.touchdown !== '1') continue;
    if (Number(rec.season) !== season || rec.season_type !== 'REG') continue;
    out.push(...extractTdRows(rec).map(t => ({ ...t, team: normTeam(t.team), scorer_id: t.scorer_id === 'NA' ? '' : t.scorer_id })));
  }
  return out;
}

export interface ScheduleGame { season: number; week: number; game_id: string; played: boolean; game: GameResult }

/** Full season schedule (REG only). A game is played only when both scores are non-blank. */
export function loadSchedule(season: number): ScheduleGame[] {
  return parseCsvRecords(readFileSync(need(files(season).games), 'utf8'))
    .filter(r => Number(r.season) === season && r.game_type === 'REG')
    .map(r => {
      const played = r.home_score !== '' && r.home_score !== 'NA' && r.away_score !== '' && r.away_score !== 'NA';
      return {
        season, week: Number(r.week), game_id: r.game_id, played,
        game: { season, week: Number(r.week), game_id: r.game_id, home_team: normTeam(r.home_team), away_team: normTeam(r.away_team), home_score: Number(r.home_score) || 0, away_score: Number(r.away_score) || 0 },
      };
    });
}
