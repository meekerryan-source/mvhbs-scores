import type { PlayerWeekStats, RosterEntry, TdRow } from '../src/engine/types.js';
import { RULES_SNAPSHOT } from '../src/engine/rules.js';
import { emptyPbpIndex, indexTdRows } from '../src/engine/pbp.js';
import { scorePlayerGame } from '../src/engine/scorePlayer.js';

export const rules = RULES_SNAPSHOT;

let nextId = 1;
export function stats(p: Partial<PlayerWeekStats> = {}): PlayerWeekStats {
  return {
    season: 2026, week: 1, season_type: 'REG', game_id: 'g', player_id: p.player_id ?? `P${nextId++}`,
    player_display_name: 'Test Player', position: 'WR', position_group: 'WR', team: 'KC', opponent_team: 'BUF',
    passing_yards: 0, passing_tds: 0, passing_interceptions: 0, passing_2pt_conversions: 0,
    rushing_yards: 0, rushing_tds: 0, rushing_2pt_conversions: 0,
    receptions: 0, receiving_yards: 0, receiving_tds: 0, receiving_2pt_conversions: 0, special_teams_tds: 0,
    fg_made: 0, fg_att: 0, fg_made_list: '', fg_missed_list: '', pat_made: 0, pat_att: 0, pat_missed: 0,
    def_sacks: 0, def_interceptions: 0, def_tds: 0, fumble_recovery_opp: 0, fumble_recovery_tds: 0,
    ...p,
  };
}

export const qb = (p: Partial<PlayerWeekStats> = {}) => stats({ position: 'QB', position_group: 'QB', ...p });
export const rb = (p: Partial<PlayerWeekStats> = {}) => stats({ position: 'RB', position_group: 'RB', ...p });
export const wr = (p: Partial<PlayerWeekStats> = {}) => stats({ position: 'WR', position_group: 'WR', ...p });
export const te = (p: Partial<PlayerWeekStats> = {}) => stats({ position: 'TE', position_group: 'TE', ...p });
export const k = (p: Partial<PlayerWeekStats> = {}) => stats({ position: 'K', position_group: 'SPEC', ...p });
export const idp = (p: Partial<PlayerWeekStats> = {}) => stats({ position: 'OLB', position_group: 'LB', ...p });

export function td(td_type: TdRow['td_type'], scorer_id: string, yards: number, extra: Partial<TdRow> = {}): TdRow {
  return { season: 2026, week: 1, season_type: 'REG', game_id: 'g', td_type, scorer_id, team: 'KC', yards_gained: yards, ...extra };
}

/** Score a stat line with optional TD plays; returns the PlayerScore plus the audit it produced. */
export function score(s: PlayerWeekStats, tds: TdRow[] = []) {
  const audit: { type: string; msg: string }[] = [];
  const r = scorePlayerGame(s, rules, tds.length ? indexTdRows(tds) : emptyPbpIndex(), audit);
  return { ...r, audit };
}

export function rosterRow(fantasy_team: string, player: string, position: string, nfl_team = 'KC'): RosterEntry {
  return { round: 1, pick: 1, fantasy_team, player, nfl_team, position };
}
