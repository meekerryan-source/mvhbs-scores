import type { AuditEntry, Component, PlayerScore, PlayerWeekStats, Rules, ScoreLine, ThresholdRule } from './types.js';
import { COMPONENTS } from './types.js';
import { bandRule, bestThresholdRule } from './rules.js';
import type { PbpIndex } from './pbp.js';
import { round2 } from './normalize.js';

/** Floor applied to a TD whose distance is unknown (the 0–4 band). */
export const TD_FLOOR = 2;
export const ST_TD_POINTS = 15;

export function parseDistList(v: unknown): number[] {
  if (!v) return [];
  return String(v)
    .split(';')
    .map(x => Number(x.trim()))
    .filter(x => !Number.isNaN(x) && x > 0);
}

/** Escalating INT penalty: −(1+2+…+n). */
export function intPenalty(n: number): number {
  let pen = 0;
  for (let k = 1; k <= n; k++) pen += k;
  return -pen;
}

/** Sacks → IDP points: whole × 3 + half × 2 (1.5 → 5, 0.5 → 2). */
export function sackPoints(sacks: number): { whole: number; half: number; points: number } {
  const whole = Math.floor(sacks || 0);
  const half = Math.round(((sacks || 0) - whole) * 2);
  return { whole, half, points: whole * 3 + half * 2 };
}

export function positionFlags(s: Pick<PlayerWeekStats, 'position' | 'position_group' | 'fg_att' | 'pat_att'>) {
  const pos = String(s.position || '').toUpperCase();
  const pg = String(s.position_group || '').toUpperCase();
  return {
    isQB: pos === 'QB' || pg === 'QB',
    isRB: pos === 'RB' || pg === 'RB',
    isWR: pos === 'WR' || pg === 'WR',
    isTE: pos === 'TE' || pg === 'TE',
    isK: pos === 'K' || (pg === 'SPEC' && (s.fg_att > 0 || s.pat_att > 0)),
    isDef: ['DL', 'LB', 'DB'].includes(pg) || ['DE', 'DT', 'OLB', 'MLB', 'ILB', 'LB', 'CB', 'S', 'FS', 'SS'].includes(pos),
  };
}

function bandLabel(r: ThresholdRule | null): string {
  return r ? `${r.min}–${r.max != null ? r.max : ''} band` : 'no band';
}

/**
 * Score one player-week (offense, K, IDP) — a line-for-line port of the sheet's scorePlayerGame_.
 * Position comes from the STATS row (position, falling back to position_group), not the roster.
 * Every point is emitted as a ScoreLine; components and total are sums of those lines.
 */
export function scorePlayerGame(s: PlayerWeekStats, rules: Rules, pbp: PbpIndex, audit: AuditEntry[] = []): PlayerScore {
  const lines: ScoreLine[] = [];
  const add = (component: Component, category: string, detail: string, points: number, rule_id?: string) =>
    lines.push({ component, category, detail, points, rule_id });
  const T = rules.threshold;
  const { isQB, isRB, isWR, isTE, isK, isDef } = positionFlags(s);

  const tier = (component: Component, stat: string, pg: string, value: number, label: string) => {
    const m = bestThresholdRule(T, stat, pg, value);
    if (m) add(component, label, `${value} → ≥${m.min}${m.max != null ? '–' + m.max : '+'} tier`, m.points, m.rule_id);
    else add(component, label, `${value} (below the lowest tier)`, 0);
  };

  // Yardage bonuses (highest tier only). QB bonus uses rush+rec yards — passing excluded.
  if (isQB) {
    tier('yardage', 'qb_total_yards', 'QB', s.rushing_yards + s.receiving_yards, 'QB rush+rec yards');
    tier('passing', 'passing_yards', 'QB', s.passing_yards, 'Passing yards');
  } else if (isRB) {
    tier('yardage', 'total_scrimmage_yards', 'RB', s.rushing_yards + s.receiving_yards, 'Scrimmage yards');
  } else if (isWR || isTE) {
    tier('yardage', 'total_scrimmage_yards', 'WR/TE', s.rushing_yards + s.receiving_yards, 'Scrimmage yards');
  }

  // Reception bonuses
  if (isRB || isTE) tier('receptions', 'receptions', 'RB/TE', s.receptions, 'Receptions');
  else if (isWR) tier('receptions', 'receptions', 'WR', s.receptions, 'Receptions');

  // TD distance bonuses — per TD. Use PBP distances only when the count matches the stat line.
  const key = `${s.season}_${s.week}_${s.player_id}`;
  const tdLines = (count: number, dists: number[], stat: string, label: string, kind: string) => {
    if (!count) return;
    if (dists.length === count) {
      dists.forEach((d, i) => {
        const r = bandRule(T, stat, d);
        add('td_distance', label, `${count > 1 ? '#' + (i + 1) + ' ' : ''}${d} yds → ${bandLabel(r)}`, r ? r.points : 0, r?.rule_id);
      });
    } else {
      for (let n = 0; n < count; n++) add('td_distance', label, 'distance unavailable → floor', TD_FLOOR);
      audit.push({
        type: dists.length > 0 ? 'pbp_count_mismatch' : 'pbp_missing',
        msg: `${s.player_display_name} W${s.week} ${kind} TDs floored: stats=${count} pbp=${dists.length}`,
      });
    }
  };
  tdLines(s.rushing_tds, pbp.rush[key] ?? [], 'rushing_td_distance', 'Rush TD', 'rush');
  tdLines(s.receiving_tds, pbp.rec[key] ?? [], 'receiving_td_distance', 'Receiving TD', 'rec');
  tdLines(s.passing_tds, pbp.pass[key] ?? [], 'passing_td_distance', 'Passing TD', 'pass');

  // TD milestone: QB every 4 TOTAL TDs (pass+rush+rec); everyone else every 3 rush+rec TDs.
  if (isQB) {
    const rr = (s.rushing_tds || 0) + (s.receiving_tds || 0);
    const qt = (s.passing_tds || 0) + rr;
    const n = Math.floor(qt / 4);
    if (n) add('td_milestone', 'TD milestone', `${qt} total TDs (${s.passing_tds} pass + ${rr} rush/rec) → every 4 = +5`, n * 5, 'TD_BONUS_QB');
  } else {
    const t = s.rushing_tds + s.receiving_tds;
    const n = Math.floor(t / 3);
    if (n) add('td_milestone', 'TD milestone', `${t} TDs → every 3 = +5`, n * 5, 'TD_BONUS_NON_QB');
  }

  // Escalating INT penalty (QB only)
  if (isQB && s.passing_interceptions > 0) {
    for (let n = 1; n <= s.passing_interceptions; n++) add('int_penalty', 'Interception', `INT #${n} (escalating)`, -n, 'PASS_INT_ESC');
  }

  // 2-pt conversions
  const twopt = s.passing_2pt_conversions + s.rushing_2pt_conversions + s.receiving_2pt_conversions;
  for (let n = 0; n < twopt; n++) add('two_pt', '2-pt conversion', '+2 each', 2, 'TWO_POINT_CONV');

  // Kicking — anyone with a made FG or a PAT attempt gets kicking points.
  if (isK || s.fg_made > 0 || s.pat_att > 0) {
    for (const d of parseDistList(s.fg_made_list)) {
      const r = bandRule(T, 'fg_made_distance', d);
      add('kicking', 'FG made', `${d} yds → ${bandLabel(r)}`, r ? r.points : 0, r?.rule_id);
    }
    if (s.pat_made) add('kicking', 'XP made', `${s.pat_made} × +1`, s.pat_made, 'XP_MADE');
    if (s.pat_missed) add('kicking', 'XP missed', `${s.pat_missed} × −1`, -s.pat_missed, 'XP_MISSED');
    for (const d of parseDistList(s.fg_missed_list)) {
      if (d < 37) add('kicking', 'FG missed', `${d} yds (under 37) → −1`, -1, 'FG_MISSED_UNDER_37');
      else add('kicking', 'FG missed', `${d} yds (37+, no penalty)`, 0);
    }
  }

  // IDP: sacks, INTs, defensive TDs via the distance tables (pick-six → receiving, fumble → rushing).
  if (isDef) {
    const sk = sackPoints(s.def_sacks);
    if (sk.whole) add('idp', 'Sacks', `${sk.whole} × +3`, sk.whole * 3, 'DST_SACK');
    if (sk.half) add('idp', 'Half sack', `${sk.half} × +2`, sk.half * 2, 'DST_HALF_SACK');
    if (s.def_interceptions) add('idp', 'Interceptions', `${s.def_interceptions} × +5`, s.def_interceptions * 5, 'DST_INT');
    const defTd = s.def_tds || 0;
    if (defTd > 0) {
      const tkey = `${s.season}_${s.week}_${s.team}`;
      const p6 = (pbp.picksix[tkey] ?? []).slice();
      const fr = (pbp.fumreturn[tkey] ?? []).slice();
      for (let n = 0; n < defTd; n++) {
        if (p6.length) {
          const d = p6.shift()!;
          const r = bandRule(T, 'receiving_td_distance', d);
          add('idp', 'Pick-six', `${d} yds → receiving TD table`, r ? r.points : 0, r?.rule_id);
        } else if (fr.length) {
          const d = fr.shift()!;
          const r = bandRule(T, 'rushing_td_distance', d);
          add('idp', 'Fumble return TD', `${d} yds → rushing TD table`, r ? r.points : 0, r?.rule_id);
        } else {
          add('idp', 'Defensive TD', 'distance unavailable → floor', TD_FLOOR);
          audit.push({ type: 'pbp_missing', msg: `${s.player_display_name} W${s.week} defensive TD floored to +2 (no PBP distance)` });
        }
      }
    }
  }

  // Special-teams TD: flat +15 to the scorer (offense or IDP). Team D/ST never gets it.
  if (s.special_teams_tds) add('st_td', 'Special teams TD', `${s.special_teams_tds} × +15 (flat)`, s.special_teams_tds * ST_TD_POINTS, 'DST_SPECIAL_TEAMS_TD');

  const components = Object.fromEntries(COMPONENTS.map(c => [c, 0])) as Record<Component, number>;
  for (const l of lines) components[l.component as Component] += l.points;
  const total = round2(COMPONENTS.reduce((a, c) => a + components[c], 0));

  return {
    season: s.season, week: s.week, player_id: s.player_id, player: s.player_display_name,
    position: s.position, position_group: s.position_group, team: s.team, opp: s.opponent_team,
    game_id: s.game_id, total, components, lines, stats: s,
  };
}
