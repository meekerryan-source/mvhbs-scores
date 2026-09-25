// Engine results → the JSON shape the web UI renders. Pure; used by the Node site build AND by the
// in-browser live engine, so official and live weeks look identical to the page.

import { buildPointsLog, type WeekResult } from '../engine/season.js';
import { BUCKET_ORDER, countedLabel, type LineupEntry } from '../engine/lineup.js';
import { TEAM_ORDER, normName } from '../engine/normalize.js';
import type { PlayerWeekStats } from '../engine/types.js';

const STAT_FIELDS: (keyof PlayerWeekStats)[] = [
  'passing_yards', 'passing_tds', 'passing_interceptions', 'passing_2pt_conversions', 'rushing_yards', 'rushing_tds', 'rushing_2pt_conversions',
  'receptions', 'receiving_yards', 'receiving_tds', 'receiving_2pt_conversions', 'special_teams_tds', 'fg_made', 'fg_att', 'fg_made_list',
  'fg_missed_list', 'pat_made', 'pat_att', 'pat_missed', 'def_sacks', 'def_interceptions', 'def_tds',
];

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

/** A box-score style one-liner: "268 pass yds, 2 TD, 1 INT · 23 rush yds" / "6 rec, 94 yds, 1 TD" / "FG 44, 51 · 3 XP". */
export function statLine(s: PlayerWeekStats | undefined): string {
  if (!s) return '';
  const parts: string[] = [];
  if (s.passing_yards || s.passing_tds || s.passing_interceptions) {
    parts.push([`${s.passing_yards} pass yds`, s.passing_tds && `${s.passing_tds} TD`, s.passing_interceptions && `${s.passing_interceptions} INT`].filter(Boolean).join(', '));
  }
  if (s.rushing_yards || s.rushing_tds) parts.push([`${s.rushing_yards} rush yds`, s.rushing_tds && `${s.rushing_tds} TD`].filter(Boolean).join(', '));
  if (s.receptions || s.receiving_yards || s.receiving_tds) parts.push([`${s.receptions} rec`, `${s.receiving_yards} yds`, s.receiving_tds && `${s.receiving_tds} TD`].filter(Boolean).join(', '));
  if (s.fg_att || s.pat_att || s.pat_made) {
    const made = String(s.fg_made_list || '').split(';').filter(Boolean);
    const missed = String(s.fg_missed_list || '').split(';').filter(Boolean);
    const k = [made.length && `FG ${made.join(', ')}`, missed.length && `missed ${missed.join(', ')}`, (s.pat_made || s.pat_missed) && `${s.pat_made}/${s.pat_made + s.pat_missed} XP`].filter(Boolean);
    if (s.fg_att > made.length + missed.length) k.push(plural(s.fg_att - made.length - missed.length, 'FG blocked', 'FGs blocked'));
    parts.push(k.join(', '));
  }
  const d = [s.def_sacks && plural(s.def_sacks, 'sack'), s.def_interceptions && plural(s.def_interceptions, 'INT', 'INTs'), s.def_tds && plural(s.def_tds, 'def TD')].filter(Boolean);
  if (d.length) parts.push(d.join(', '));
  const two = s.passing_2pt_conversions + s.rushing_2pt_conversions + s.receiving_2pt_conversions;
  if (two) parts.push(plural(two, '2-pt conv', '2-pt convs'));
  if (s.special_teams_tds) parts.push(plural(s.special_teams_tds, 'return TD'));
  return parts.filter(Boolean).join(' · ');
}

/** normName(roster player) → the NFL team of their most recent stat line (catches trades / stale roster teams). */
export type LatestTeams = Record<string, string>;

export function entryJson(e: LineupEntry, id: string, latest: LatestTeams = {}) {
  const s = e.score?.stats;
  const nfl = e.bucket === 'DST' ? e.roster.nfl_team || e.match.statsTeam || '' : e.match.statsTeam || latest[normName(e.player)] || e.roster.nfl_team || '';
  return {
    id, player: e.player, team: e.team, bucket: e.bucket, pos: e.roster.position, nfl,
    raw: e.raw, pts: e.pts, doubled: e.doubled, slot: e.slot, sixthMan: e.sixthMan, counted: countedLabel(e), active: e.active,
    acquired: e.roster.acquired_week ? { week: e.roster.acquired_week, via: e.roster.acquired_via, replaces: e.roster.replaces } : null,
    match: e.match,
    statsPos: e.score ? `${e.score.position}/${e.score.position_group}` : null,
    game: e.dst ? { team: e.dst.team, opp: e.dst.opp, pf: e.dst.pf, pa: e.dst.pa } : e.score ? { team: e.score.team, opp: e.score.opp, game_id: e.score.game_id } : null,
    lines: (e.dst?.lines ?? e.score?.lines ?? []).map(l => ({ c: l.category, d: l.detail, p: l.points, r: l.rule_id ?? null, k: l.component })),
    components: e.score?.components ?? null,
    stats: s ? Object.fromEntries(STAT_FIELDS.filter(f => s[f] !== 0 && s[f] !== '').map(f => [f, s[f]])) : null,
    statLine: e.dst ? (e.dst.pf != null && !Number.isNaN(e.dst.pf) ? `${e.dst.team} ${e.dst.pf}–${e.dst.pa} vs ${e.dst.opp}` : '') : statLine(s),
  };
}

export type WeekJson = ReturnType<typeof weekJson>;

export function weekJson(w: WeekResult, latest: LatestTeams = {}) {
  const grid: Record<string, Record<string, string[]>> = {};
  const entries: Record<string, ReturnType<typeof entryJson>> = {};
  for (const t of TEAM_ORDER) {
    grid[t] = {};
    for (const b of BUCKET_ORDER) {
      grid[t][b] = w.lineups[t].buckets[b].map((e, i) => {
        const id = `${w.week}-${t}-${b}-${i}`;
        entries[id] = entryJson(e, id, latest);
        return id;
      });
    }
  }
  return {
    week: w.week, status: w.status, statusNote: w.statusNote,
    weekTotals: w.weekTotals, previousTotals: w.previousTotals, newTotals: w.newTotals,
    sixth: Object.fromEntries(TEAM_ORDER.map(t => [t, w.lineups[t].sixth])),
    grid, entries, audit: w.audit, pointsLogRows: buildPointsLog(w).length, live: w.live ?? null,
  };
}
