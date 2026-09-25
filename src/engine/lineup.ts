import type { AuditEntry, Bucket, DisplayTeam, DoublerRow, DstScore, PlayerScore, RosterEntry, Slot } from './types.js';
import { DST_TEAM_TO_CODE, TEAM_DISPLAY, TEAM_ORDER, matchShortName, normName, normTeam, posBucket, round2 } from './normalize.js';

export const LINEUP_SLOTS: Record<Bucket, number> = { QB: 1, RB: 3, WR: 3, TE: 1, K: 1, DST: 1, IDP: 3 };
export const BUCKET_ORDER: Bucket[] = ['QB', 'RB', 'WR', 'TE', 'K', 'DST', 'IDP'];
export const BONUS_POOL: Bucket[] = ['QB', 'TE', 'K', 'DST'];
export const SIXTHMAN_POSITIONS: Bucket[] = ['WR', 'RB'];
export const SIXTHMAN_ROSTER_MIN = 6;
/** Grid rows per bucket: QB1–3, RB1–6, WR1–6, TE1–3, K1–3, DST1–3, IDP1–6. */
export const GRID_ROWS: [Bucket, number][] = [['QB', 3], ['RB', 6], ['WR', 6], ['TE', 3], ['K', 3], ['DST', 3], ['IDP', 6]];

export interface LineupEntry {
  team: DisplayTeam;
  roster: RosterEntry;
  player: string;
  bucket: Bucket;
  /** Undoubled score (0 if not found in the week's stats). */
  raw: number;
  doubled: boolean;
  /** Score used for ranking and totals (raw × 2 when doubled). */
  pts: number;
  /** Appeared in the week's stats (informational; the sixth-man rule uses raw > 0, not this). */
  active: boolean;
  slot: Slot;
  sixthMan: boolean;
  /** How the roster name was matched to a stats row. */
  match: { how: 'team' | 'name' | 'short' | 'dst' | 'none'; player_id?: string; statsName?: string; statsTeam?: string };
  score?: PlayerScore;
  dst?: DstScore;
}

export interface TeamWeek {
  team: DisplayTeam;
  buckets: Record<Bucket, LineupEntry[]>;
  sixth: { WR: boolean; RB: boolean };
  weekTotal: number;
}

/** Doublers rows → `season_week_rosterTeam` → normName(player). Later rows win, like the sheet. */
export function indexDoublers(rows: DoublerRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) {
    if (!r.fantasy_team || !r.player) continue;
    out[`${r.season}_${r.week}_${r.fantasy_team}`] = normName(r.player);
  }
  return out;
}

/**
 * Lineups for every team for one week — a port of the sheet's buildWeeklyGrid_:
 *  raw score lookup (name|team → name-only → short-name within the position pool),
 *  doubler (×2, used for ranking), buckets sorted by pts desc (stable), sixth man
 *  (≥6 rostered with raw > 0 → one extra WR/RB starter), then one bonus from bench QB/TE/K/DST.
 */
export function buildLineups(
  season: number,
  week: number,
  roster: RosterEntry[],
  playerScores: PlayerScore[],
  dstScores: DstScore[],
  doublers: Record<string, string>,
  audit: AuditEntry[] = [],
): Record<DisplayTeam, TeamWeek> {
  // Stats-side lookups for this week, in stats order (later rows overwrite on the team key; name-only takes the first).
  const byKey = new Map<string, PlayerScore>();
  const byName = new Map<string, PlayerScore[]>();
  const wk = playerScores.filter(p => p.season === season && p.week === week);
  for (const p of wk) {
    const nm = normName(p.player);
    byKey.set(`${nm}|${normTeam(p.team)}`, p);
    if (!byName.has(nm)) byName.set(nm, []);
    byName.get(nm)!.push(p);
  }
  const dstByTeam = new Map<string, DstScore>();
  for (const d of dstScores) if (d.season === season && d.week === week) dstByTeam.set(normTeam(d.team), d);

  const teams = {} as Record<DisplayTeam, TeamWeek>;
  for (const t of TEAM_ORDER) {
    teams[t] = { team: t, buckets: { QB: [], RB: [], WR: [], TE: [], K: [], DST: [], IDP: [] }, sixth: { WR: false, RB: false }, weekTotal: 0 };
  }

  for (const r of roster) {
    const display = TEAM_DISPLAY[r.fantasy_team];
    if (!display) continue;
    const bucket = posBucket(r.position);
    if (!bucket) continue;

    let raw = 0;
    let found = false;
    let match: LineupEntry['match'] = { how: 'none' };
    let score: PlayerScore | undefined;
    let dst: DstScore | undefined;
    if (bucket === 'DST') {
      const code = DST_TEAM_TO_CODE[r.player];
      dst = code ? dstByTeam.get(code) : undefined;
      if (dst) { raw = dst.total; found = true; match = { how: 'dst', statsTeam: code }; }
    } else {
      const nm = normName(r.player);
      score = byKey.get(`${nm}|${normTeam(r.nfl_team)}`);
      if (score) match = { how: 'team' };
      else if (byName.get(nm)?.length) {
        score = byName.get(nm)![0];
        match = { how: 'name' };
        audit.push({ type: 'name_only_match', msg: `W${week} ${display}: ${r.player} (${r.nfl_team || '?'}) matched by name only → ${score.player} (${score.team})` });
      } else {
        const pool = wk.filter(c => {
          const pg = String(c.position_group).toUpperCase();
          if (bucket === 'IDP') return ['DL', 'LB', 'DB', 'DP'].includes(pg);
          return pg === bucket;
        });
        const m = matchShortName(r.player, pool.map(c => c.player));
        if (m) {
          score = pool.find(c => c.player === m);
          match = { how: 'short' };
          audit.push({ type: 'short_name_match', msg: `W${week} ${display}: ${r.player} matched by short name → ${m}` });
        }
      }
      if (score) {
        raw = score.total;
        found = true;
        match = { ...match, player_id: score.player_id, statsName: score.player, statsTeam: score.team };
      }
    }

    const d = doublers[`${season}_${week}_${r.fantasy_team}`];
    const doubled = !!d && d === normName(r.player);
    teams[display].buckets[bucket].push({
      team: display, roster: r, player: r.player, bucket, raw, doubled, pts: doubled ? raw * 2 : raw,
      active: found, slot: 'bench', sixthMan: false, match, score, dst,
    });
  }

  // A doubler that names nobody on the resolved roster is a silent no-op in the sheet — surface it.
  for (const [k, nm] of Object.entries(doublers)) {
    const [s, w, ...rest] = k.split('_');
    if (Number(s) !== season || Number(w) !== week) continue;
    const rosterTeam = rest.join('_');
    const disp = TEAM_DISPLAY[rosterTeam];
    if (!disp) { audit.push({ type: 'doubler_unknown_team', msg: `W${week}: doubler team "${rosterTeam}" is not a roster team` }); continue; }
    const hit = BUCKET_ORDER.some(b => teams[disp].buckets[b].some(e => e.doubled));
    if (!hit) audit.push({ type: 'doubler_unmatched', msg: `W${week} ${disp}: doubler "${nm}" is not on the resolved roster` });
  }

  for (const t of TEAM_ORDER) {
    const tw = teams[t];
    for (const b of BUCKET_ORDER) tw.buckets[b].sort((a, c) => c.pts - a.pts); // Array.prototype.sort is stable

    for (const pos of SIXTHMAN_POSITIONS) {
      if (tw.buckets[pos].filter(p => p.raw > 0).length >= SIXTHMAN_ROSTER_MIN) tw.sixth[pos as 'WR' | 'RB'] = true;
    }
    for (const b of BUCKET_ORDER) {
      const extra = (b === 'WR' || b === 'RB') && tw.sixth[b];
      const n = LINEUP_SLOTS[b] + (extra ? 1 : 0);
      tw.buckets[b].forEach((p, i) => {
        p.slot = i < n ? 'starter' : 'bench';
        if (extra && i === n - 1) p.sixthMan = true;
      });
    }
    let best: LineupEntry | null = null;
    for (const b of BONUS_POOL) for (const p of tw.buckets[b]) {
      if (p.slot !== 'bench') continue;
      if (!best || p.pts > best.pts) best = p;
    }
    if (best) best.slot = 'bonus';

    let sum = 0;
    for (const b of BUCKET_ORDER) for (const p of tw.buckets[b]) if (p.slot !== 'bench') sum += p.pts;
    tw.weekTotal = round2(sum);
  }
  return teams;
}

/** Slot label as the sheet's Points Log "Counted" column spells it. */
export function countedLabel(e: Pick<LineupEntry, 'slot' | 'sixthMan'>): 'Counted' | 'Bonus' | '6th man' | 'Bench' {
  if (e.slot === 'bonus') return 'Bonus';
  if (e.slot === 'starter') return e.sixthMan ? '6th man' : 'Counted';
  return 'Bench';
}

/** Points cell as the raw sheet grid writes it: "raw × 2 = pts" for a doubler, else the number. */
export function ptsCell(e: Pick<LineupEntry, 'doubled' | 'raw' | 'pts'>): string {
  return e.doubled ? `${e.raw} × 2 = ${e.pts}` : String(e.pts);
}
