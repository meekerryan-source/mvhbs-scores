import type {
  AuditEntry, DisplayTeam, DoublerRow, DstScore, GameResult, PlayerScore, PlayerWeekStats, RosterEntry, Rules, TdRow, TransactionRow,
} from './types.js';
import { indexTdRows } from './pbp.js';
import { scorePlayerGame } from './scorePlayer.js';
import { indexGames, scoreAllDst } from './scoreDst.js';
import { pairTransactions, resolveRosterForWeek, validateTransactions } from './roster.js';
import { BUCKET_ORDER, buildLineups, countedLabel, indexDoublers, type TeamWeek } from './lineup.js';
import { DST_TEAM_TO_CODE, TEAM_DISPLAY, TEAM_ORDER, normName, round2 } from './normalize.js';
import type { EspnGame } from './espn.js';

/** ESPN live data for a week nflverse hasn't published yet. Provisional — never Final. */
export interface LiveWeekData {
  stats: PlayerWeekStats[];
  tds: TdRow[];
  /** Started games at their current score. */
  games: GameResult[];
  espnGames: EspnGame[];
  fetchedAt: string;
  notes: string[];
}

export interface EngineInput {
  season: number;
  seasonType: string; // 'REG'
  rules: Rules;
  roster: RosterEntry[];
  transactions: TransactionRow[];
  doublers: DoublerRow[];
  stats: PlayerWeekStats[];
  tds: TdRow[];
  games: GameResult[];
  /** Every scheduled game (played or not) — used only to decide whether a week is final. */
  schedule?: { season: number; week: number; game_id: string; played: boolean }[];
  /** ESPN live data by week. Used only for weeks with no nflverse rows. */
  live?: Record<number, LiveWeekData>;
}

export type WeekStatus = 'final' | 'provisional' | 'live' | 'unsettled';

export interface WeekResult {
  week: number;
  status: WeekStatus;
  statusNote: string;
  roster: RosterEntry[];
  players: PlayerScore[];
  dst: DstScore[];
  lineups: Record<DisplayTeam, TeamWeek>;
  weekTotals: Record<DisplayTeam, number>;
  previousTotals: Record<DisplayTeam, number>;
  newTotals: Record<DisplayTeam, number>;
  audit: AuditEntry[];
  /** Present for a live (ESPN) week: game scores/states and when they were fetched. */
  live?: { games: EspnGame[]; fetchedAt: string; allFinal: boolean; notes: string[] };
}

export interface StandingsRow {
  rank: number;
  team: DisplayTeam;
  total: number;
  avg: number;
  behind: number | null;
  last: number;
  best: number;
  weeks: number[];
}

export interface SeasonResult {
  season: number;
  weeks: WeekResult[];
  standings: StandingsRow[];
  audit: AuditEntry[];
  transactions: ReturnType<typeof pairTransactions>;
}

/** Final = stats exist and every scheduled game has a score; provisional = stats but some games unplayed. */
export function weekStatus(input: EngineInput, week: number): { status: WeekStatus; note: string } {
  const nStats = input.stats.filter(s => s.season === input.season && s.week === week && s.season_type === input.seasonType).length;
  const sched = (input.schedule ?? []).filter(g => g.season === input.season && g.week === week);
  const unplayed = sched.filter(g => !g.played).length;
  if (!nStats) {
    const lw = input.live?.[week];
    if (lw) {
      const g = lw.espnGames;
      const done = g.filter(x => x.state === 'post').length;
      const on = g.filter(x => x.state === 'in').length;
      return { status: 'live', note: `LIVE from ESPN — ${done} of ${g.length} games final${on ? `, ${on} in progress` : ''}. Provisional until the Tuesday nflverse settle.` };
    }
    return { status: 'unsettled', note: `nflverse has 0 player-stat rows for W${week} — refusing to settle` };
  }
  if (unplayed) return { status: 'provisional', note: `${unplayed} of ${sched.length} W${week} games have no final score yet` };
  return { status: 'final', note: `${nStats} player lines, ${sched.length || '?'} games final (nflverse)` };
}

function dedupe(a: AuditEntry[]): AuditEntry[] {
  const seen = new Set<string>();
  return a.filter(x => { const k = x.type + '|' + x.msg; if (seen.has(k)) return false; seen.add(k); return true; });
}

/** Score a whole season, week by week (weeks with no nflverse rows are returned as 'unsettled' and score 0). */
export function runSeason(input: EngineInput, weeks: number[]): SeasonResult {
  const seasonAudit: AuditEntry[] = [];
  const txs = pairTransactions(input.transactions, seasonAudit);
  const teamOf = (player: string) => input.stats.find(s => normName(s.player_display_name) === normName(player))?.team;
  validateTransactions(input.roster, txs, teamOf, seasonAudit);

  // Live weeks contribute their ESPN stats / TDs / current game scores only when nflverse has nothing for them.
  const nflverseWeeks = new Set(input.stats.filter(s => s.season === input.season).map(s => s.week));
  const liveWeeks = Object.entries(input.live ?? {}).filter(([w]) => !nflverseWeeks.has(Number(w))).map(([w, d]) => [Number(w), d] as const);
  const allTds = [...input.tds, ...liveWeeks.flatMap(([, d]) => d.tds)];
  const pbp = indexTdRows(allTds.filter(t => t.season === input.season && t.season_type === input.seasonType));
  const games = indexGames([...input.games, ...liveWeeks.flatMap(([, d]) => d.games)].filter(g => g.season === input.season));
  const liveStats = new Map(liveWeeks.map(([w, d]) => [w, d.stats]));
  const doublers = indexDoublers(input.doublers);

  const results: WeekResult[] = [];
  const running = Object.fromEntries(TEAM_ORDER.map(t => [t, 0])) as Record<DisplayTeam, number>;
  for (const week of [...weeks].sort((a, b) => a - b)) {
    const audit: AuditEntry[] = [];
    const { status, note } = weekStatus(input, week);
    const stats = status === 'live'
      ? liveStats.get(week) ?? []
      : input.stats.filter(s => s.season === input.season && s.week === week && s.season_type === input.seasonType);
    const players = stats.map(s => scorePlayerGame(s, input.rules, pbp, audit));
    const dst = scoreAllDst(stats, games, audit);
    const roster = resolveRosterForWeek(input.roster, txs, week, audit);
    const lineups = buildLineups(input.season, week, roster, players, dst, doublers, audit);
    const weekTotals = {} as Record<DisplayTeam, number>;
    const previousTotals = { ...running };
    for (const t of TEAM_ORDER) {
      weekTotals[t] = lineups[t].weekTotal;
      running[t] = round2(running[t] + lineups[t].weekTotal);
    }
    if (status === 'unsettled') audit.unshift({ type: 'week_unsettled', msg: note });
    const lw = status === 'live' ? input.live![week] : undefined;
    const live = lw && { games: lw.espnGames, fetchedAt: lw.fetchedAt, allFinal: lw.espnGames.length > 0 && lw.espnGames.every(g => g.state === 'post'), notes: lw.notes };
    results.push({ week, status, statusNote: note, roster, players, dst, lineups, weekTotals, previousTotals, newTotals: { ...running }, audit: dedupe(audit), live });
  }
  return { season: input.season, weeks: results, standings: buildStandings(results), audit: dedupe(seasonAudit), transactions: txs };
}

/** Standings: season total desc (stable in TEAM_ORDER). Avg/Last/Best use final weeks only. */
export function buildStandings(weeks: WeekResult[]): StandingsRow[] {
  const finals = weeks.map(w => w.status === 'final');
  const rows = TEAM_ORDER.map(team => {
    const wk = weeks.map(w => w.weekTotals[team]);
    const fin = wk.filter((_, i) => finals[i]);
    const total = round2(wk.reduce((a, b) => a + b, 0));
    return {
      rank: 0, team, total,
      avg: fin.length ? Math.round((fin.reduce((a, b) => a + b, 0) / fin.length) * 10) / 10 : 0,
      behind: null as number | null,
      last: fin.length ? fin[fin.length - 1] : 0,
      best: fin.length ? Math.max(...fin) : 0,
      weeks: wk,
    };
  });
  rows.sort((a, b) => b.total - a.total);
  rows.forEach((r, i) => { r.rank = i + 1; r.behind = i === 0 ? null : round2(r.total - rows[0].total); });
  return rows;
}

// ---------------------------------------------------------------------------------------------
// Points Log (audit trail) — one row per scoring line per rostered player, like the sheet tab.
// ---------------------------------------------------------------------------------------------

export interface PointsLogRow {
  week: number;
  team: DisplayTeam;
  player: string;
  pos: string;
  nfl: string;
  category: string;
  detail: string;
  points: number;
  counted: string;
  doubler: string;
  rule_id?: string;
}

export function buildPointsLog(w: WeekResult): PointsLogRow[] {
  const rows: (PointsLogRow & { _i: number })[] = [];
  let i = 0;
  for (const r of w.roster) {
    const team = TEAM_DISPLAY[r.fantasy_team];
    if (!team) continue;
    const entry = BUCKET_ORDER.flatMap(b => w.lineups[team].buckets[b]).find(e => e.roster === r);
    const pos = String(r.position || '').toUpperCase();
    const isDst = pos === 'DST';
    const nfl = isDst ? DST_TEAM_TO_CODE[r.player] ?? '' : r.nfl_team;
    const counted = w.status === 'final' && entry ? countedLabel(entry) : '';
    const lines = entry?.dst?.lines ?? entry?.score?.lines;
    const total = entry?.raw ?? 0;
    const doubler = entry?.doubled ? (isDst ? '★ ×2' : `★ ×2 (${total} → ${total * 2})`) : '';
    const base = { week: w.week, team, player: r.player, pos, nfl, counted, doubler };
    if (!lines) {
      rows.push({ ...base, category: '—', detail: isDst ? 'No game played yet' : 'No stats recorded this week (did not play / game not started)', points: 0, _i: i++ });
      continue;
    }
    const shown = lines.length ? lines : [{ category: '—', detail: 'Played, no scoring events', points: 0, component: 'yardage' as const }];
    for (const l of shown) rows.push({ ...base, category: l.category, detail: l.detail, points: l.points, rule_id: l.rule_id, _i: i++ });
  }
  const order = Object.fromEntries(TEAM_ORDER.map((t, k) => [t, k]));
  rows.sort((a, b) => order[a.team] - order[b.team] || a.player.localeCompare(b.player) || a._i - b._i);
  return rows.map(({ _i, ...r }) => r);
}

