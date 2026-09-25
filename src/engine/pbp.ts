import type { TdRow, TdType } from './types.js';
import { normTeam } from './normalize.js';

/**
 * TD distances keyed for the scorer. Player TDs (pass/rec/rush) are keyed `season_week_playerId`;
 * team-level TDs (picksix/fumreturn/st) are keyed `season_week_TEAM` because PBP doesn't name the
 * defender. Distances keep PBP row order.
 */
export interface PbpIndex {
  pass: Record<string, number[]>;
  rec: Record<string, number[]>;
  rush: Record<string, number[]>;
  picksix: Record<string, number[]>;
  fumreturn: Record<string, number[]>;
  st: Record<string, number[]>;
}

export function emptyPbpIndex(): PbpIndex {
  return { pass: {}, rec: {}, rush: {}, picksix: {}, fumreturn: {}, st: {} };
}

const TEAM_LEVEL: TdType[] = ['picksix', 'fumreturn', 'st'];

export function indexTdRows(rows: TdRow[]): PbpIndex {
  const out = emptyPbpIndex();
  for (const r of rows) {
    const bucket = out[r.td_type];
    if (!bucket) continue;
    const k = TEAM_LEVEL.includes(r.td_type)
      ? `${r.season}_${r.week}_${normTeam(r.team)}`
      : `${r.season}_${r.week}_${r.scorer_id}`;
    (bucket[k] ??= []).push(r.yards_gained);
  }
  return out;
}

/**
 * One nflverse play-by-play row → zero, one or two TdRows (§5.7). Only `touchdown == 1` plays emit.
 * Only REG plays are kept by the caller.
 */
export function extractTdRows(p: Record<string, string>): TdRow[] {
  if (String(p.touchdown) !== '1') return [];
  const base = {
    season: Number(p.season) || 0,
    week: Number(p.week) || 0,
    season_type: p.season_type,
    game_id: p.game_id,
  };
  const yd = Number(p.yards_gained) || 0;
  if (String(p.pass_touchdown) === '1') {
    return [
      { ...base, td_type: 'pass', scorer_id: p.passer_player_id ?? '', team: p.posteam, yards_gained: yd },
      { ...base, td_type: 'rec', scorer_id: p.receiver_player_id ?? '', team: p.posteam, yards_gained: yd },
    ];
  }
  if (String(p.rush_touchdown) === '1') {
    return [{ ...base, td_type: 'rush', scorer_id: p.rusher_player_id ?? '', team: p.posteam, yards_gained: yd }];
  }
  if (String(p.return_touchdown) === '1') {
    const rty = Number(p.return_yards) || 0;
    if (String(p.interception) === '1') return [{ ...base, td_type: 'picksix', scorer_id: '', team: p.defteam, yards_gained: rty }];
    if (String(p.fumble_lost) === '1') return [{ ...base, td_type: 'fumreturn', scorer_id: '', team: p.defteam, yards_gained: rty }];
    const rt = p.kickoff_returner_player_id || p.punt_returner_player_id || '';
    return [{ ...base, td_type: 'st', scorer_id: rt, team: p.td_team || p.posteam, yards_gained: rty }];
  }
  return [];
}
