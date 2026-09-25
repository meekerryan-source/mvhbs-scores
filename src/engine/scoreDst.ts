import type { AuditEntry, DstScore, GameResult, PlayerWeekStats, ScoreLine } from './types.js';
import { normTeam, round2 } from './normalize.js';

export interface TeamGame {
  team: string;
  opp: string;
  pf: number;
  pa: number;
}

/** Played games → lookup keyed `season_week_TEAM` (both sides of each game). */
export function indexGames(games: GameResult[]): Record<string, TeamGame> {
  const out: Record<string, TeamGame> = {};
  for (const g of games) {
    const home = normTeam(g.home_team);
    const away = normTeam(g.away_team);
    if (!home || !away) continue;
    out[`${g.season}_${g.week}_${home}`] = { team: home, opp: away, pf: g.home_score, pa: g.away_score };
    out[`${g.season}_${g.week}_${away}`] = { team: away, opp: home, pf: g.away_score, pa: g.home_score };
  }
  return out;
}

/** Margin-of-victory band (only called for wins). */
export function movPoints(margin: number): { points: number; band: string } | null {
  if (margin >= 29) return { points: 10, band: '29+' };
  if (margin >= 22) return { points: 8, band: '22–28' };
  if (margin >= 15) return { points: 6, band: '15–21' };
  if (margin >= 11) return { points: 4, band: '11–14' };
  if (margin >= 8) return { points: 2, band: '8–10' };
  if (margin >= 4) return { points: 1, band: '4–7' };
  return null;
}

/**
 * Team D/ST for one team-week — team outcomes ONLY (win, MOV, shutout, 50-burger). Sacks, INTs,
 * defensive and return TDs never score here (they belong to IDPs / the returner).
 */
export function scoreDstGame(season: number, week: number, team: string, opp: string, g: TeamGame | undefined, audit: AuditEntry[] = []): DstScore {
  const lines: ScoreLine[] = [];
  const add = (category: string, detail: string, points: number, rule_id?: string) =>
    lines.push({ component: 'dst', category, detail, points, rule_id });
  let pts_win = 0, pts_mov = 0, pts_shutout = 0, pts_50_burger = 0, margin = 0, win = 0, pf = NaN, pa = NaN;
  if (g) {
    pf = g.pf; pa = g.pa; margin = pf - pa; win = margin > 0 ? 1 : 0;
    if (win) {
      pts_win = 3;
      add('D/ST win', `${g.team} ${pf}–${pa} over ${g.opp}`, 3, 'TEAM_WIN');
      const mov = movPoints(margin);
      if (mov) { pts_mov = mov.points; add('D/ST margin', `Won by ${margin} → ${mov.band} band`, mov.points); }
      else add('D/ST margin', `Won by ${margin} (under 4, no margin bonus)`, 0);
      if (pf >= 50) { pts_50_burger = 5; add('D/ST 50-burger', `Scored ${pf} in a win`, 5, 'TEAM_50_BURGER'); }
    } else {
      add('D/ST result', `${margin === 0 ? 'Tie ' : 'Lost '}${pf}–${pa} to ${g.opp} (no win bonus)`, 0);
    }
    if (pa === 0) { pts_shutout = 5; add('D/ST shutout', 'Allowed 0 points', 5, 'TEAM_SHUTOUT'); }
  } else {
    audit.push({ type: 'missing_game', msg: `No game row for ${team} W${week}` });
    add('D/ST', 'No game row (bye or missing data)', 0);
  }
  const total = round2(pts_win + pts_mov + pts_shutout + pts_50_burger);
  return { season, week, team, opp, win, margin, pf, pa, total, pts_win, pts_mov, pts_shutout, pts_50_burger, lines };
}

/**
 * Every team that appears in the week's player stats gets a D/ST row (mirrors the sheet's
 * scoreAllDST_, which aggregates from Raw_Player_Stats — so a team with no stat rows has no row).
 */
export function scoreAllDst(stats: PlayerWeekStats[], games: Record<string, TeamGame>, audit: AuditEntry[] = []): DstScore[] {
  const seen = new Map<string, { season: number; week: number; team: string; opp: string }>();
  for (const s of stats) {
    const k = `${s.season}_${s.week}_${s.team}`;
    if (!seen.has(k)) seen.set(k, { season: s.season, week: s.week, team: s.team, opp: s.opponent_team });
  }
  return [...seen.entries()].map(([k, a]) => scoreDstGame(a.season, a.week, a.team, a.opp, games[k], audit));
}
