import { describe, expect, it } from 'vitest';
import { buildLineups, countedLabel, indexDoublers, ptsCell } from '../src/engine/lineup.js';
import { runSeason, weekStatus, type EngineInput } from '../src/engine/season.js';
import { normName, normTeam, posBucket, matchShortName } from '../src/engine/normalize.js';
import { rules, rosterRow } from './helpers.js';
import type { AuditEntry, DstScore, PlayerScore, RosterEntry } from '../src/engine/types.js';

/** Minimal PlayerScore with a given total (lineup logic only reads name/team/pos/total). */
function ps(player: string, total: number, team = 'KC', position_group = 'WR'): PlayerScore {
  return {
    season: 2026, week: 1, player_id: player, player, position: position_group, position_group, team, opp: 'BUF', game_id: 'g', total,
    components: {} as PlayerScore['components'], lines: [], stats: {} as PlayerScore['stats'],
  };
}
const dst = (team: string, total: number): DstScore => ({ season: 2026, week: 1, team, opp: 'X', win: 1, margin: 1, pf: 1, pa: 0, total, pts_win: 0, pts_mov: 0, pts_shutout: 0, pts_50_burger: 0, lines: [] });

/** A full 30-man roster for team AZN with scores given per bucket (index i → player `${B}${i}`). */
function team(scores: Partial<Record<'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'IDP', number[]>>, dstScores: number[] = [0, 0, 0]) {
  const roster: RosterEntry[] = [];
  const players: PlayerScore[] = [];
  const sizes = { QB: 3, RB: 6, WR: 6, TE: 3, K: 3, IDP: 6 } as const;
  for (const [b, n] of Object.entries(sizes) as [keyof typeof sizes, number][]) {
    for (let i = 0; i < n; i++) {
      const name = `${b} Player${i + 1}`;
      roster.push(rosterRow('AZN', name, b === 'IDP' ? 'LB' : b));
      const v = scores[b]?.[i];
      if (v != null) players.push(ps(name, v, 'KC', b === 'IDP' ? 'LB' : b));
    }
  }
  const dstTeams = ['Kansas City Chiefs', 'Buffalo Bills', 'Detroit Lions'];
  const codes = ['KC', 'BUF', 'DET'];
  dstTeams.forEach(t => roster.push(rosterRow('AZN', t, 'DST', '')));
  return { roster, players, dsts: codes.map((c, i) => dst(c, dstScores[i])) };
}

const lineup = (t: ReturnType<typeof team>, doublers: Record<string, string> = {}, audit: AuditEntry[] = []) =>
  buildLineups(2026, 1, t.roster, t.players, t.dsts, doublers, audit).AZN;

describe('Lineup mechanics (§6)', () => {
  it('13 starters by bucket, ranked by points; bonus = best bench QB/TE/K/DST; bench never counts', () => {
    const t = team({ QB: [20, 15, 1], RB: [10, 9, 8, 7, 0, 0], WR: [12, 11, 10, 30, 0, 0], TE: [5, 4, 0], K: [9, 8, 7], IDP: [6, 5, 4, 3, 0, 0] }, [4, 3, 0]);
    const l = lineup(t);
    const starters = Object.values(l.buckets).flat().filter(e => e.slot === 'starter');
    expect(starters).toHaveLength(13);
    expect(l.buckets.WR[0].player).toBe('WR Player4'); // 30 sorts first
    const bonus = Object.values(l.buckets).flat().filter(e => e.slot === 'bonus');
    expect(bonus.map(b => b.player)).toEqual(['QB Player2']); // 15 beats bench TE 4 / K 8 / DST 3
    expect(l.weekTotal).toBe(20 + (10 + 9 + 8) + (30 + 12 + 11) + 5 + 9 + 4 + (6 + 5 + 4) + 15);
  });
  it('RB / WR / IDP never qualify for the bonus slot', () => {
    const t = team({ QB: [1], RB: [10, 9, 8, 50], TE: [1], K: [1] });
    const l = lineup(t);
    expect(l.buckets.RB[3].slot).toBe('bench');
    expect(Object.values(l.buckets).flat().find(e => e.slot === 'bonus')?.bucket).not.toBe('RB');
  });
  it('doubler: pts = raw × 2, used for ranking — a doubled bench player can be promoted', () => {
    const t = team({ WR: [10, 9, 8, 6, 0, 0] });
    const l = lineup(t, indexDoublers([{ season: 2026, week: 1, fantasy_team: 'AZN', player: 'WR Player4' }]));
    expect(l.buckets.WR[0]).toMatchObject({ player: 'WR Player4', raw: 6, pts: 12, doubled: true, slot: 'starter' });
    expect(l.buckets.WR[3]).toMatchObject({ player: 'WR Player3', slot: 'bench' });
    expect(ptsCell(l.buckets.WR[0])).toBe('6 × 2 = 12');
  });
  it('REGRESSION §8.2/§8.4: suffix/punctuation names match on both sides (roster ↔ stats, doublers ↔ roster)', () => {
    const roster = [rosterRow('Woo', 'James Cook III', 'RB', 'BUF'), rosterRow('Woo', 'Michael Penix Jr.', 'QB', 'ATL')];
    const players = [ps('James Cook', 10, 'BUF', 'RB'), ps('Michael Penix', 7, 'ATL', 'QB')];
    const audit: AuditEntry[] = [];
    const l = buildLineups(2026, 1, roster, players, [], indexDoublers([{ season: 2026, week: 1, fantasy_team: 'Woo', player: 'James Cook' }]), audit).Woo;
    expect(l.buckets.RB[0]).toMatchObject({ raw: 10, pts: 20, doubled: true });
    expect(l.buckets.QB[0].raw).toBe(7);
    expect(audit.filter(a => a.type === 'doubler_unmatched')).toEqual([]);
  });
  it('a doubler that is not on the resolved roster is surfaced', () => {
    const audit: AuditEntry[] = [];
    lineup(team({}), indexDoublers([{ season: 2026, week: 1, fantasy_team: 'AZN', player: 'Someone Else' }]), audit);
    expect(audit.map(a => a.type)).toContain('doubler_unmatched');
  });
  it('sixth man: all 6 WRs with raw > 0 → a 4th WR starter, marked sixthMan', () => {
    const l = lineup(team({ WR: [10, 9, 8, 7, 2, 1] }));
    expect(l.sixth.WR).toBe(true);
    expect(l.buckets.WR.map(countedLabel)).toEqual(['Counted', 'Counted', 'Counted', '6th man', 'Bench', 'Bench']);
  });
  it('REGRESSION §8.3: sixth man does NOT fire when a sixth player is active with 0 points', () => {
    const l = lineup(team({ WR: [10, 9, 8, 7, 2, 0] }));
    expect(l.sixth.WR).toBe(false);
    expect(l.buckets.WR[3].slot).toBe('bench');
  });
  it('sixth man uses raw, not doubled, points — and RB and WR can both trigger', () => {
    const l = lineup(team({ RB: [5, 5, 5, 5, 5, 1], WR: [1, 1, 1, 1, 1, 1] }), indexDoublers([{ season: 2026, week: 1, fantasy_team: 'AZN', player: 'RB Player6' }]));
    expect([l.sixth.RB, l.sixth.WR]).toEqual([true, true]);
  });
  it('ties keep roster order (stable sort)', () => {
    const l = lineup(team({ K: [7, 7, 7] }));
    expect(l.buckets.K.map(e => e.player)).toEqual(['K Player1', 'K Player2', 'K Player3']);
  });
  it('a roster player missing from the week stats scores 0 and is not active', () => {
    const l = lineup(team({ QB: [12] }));
    expect(l.buckets.QB[1]).toMatchObject({ raw: 0, active: false });
  });
  it('stats lookup falls back to name-only when the NFL team differs (traded player) and logs it', () => {
    const audit: AuditEntry[] = [];
    const l = buildLineups(2026, 1, [rosterRow('AZN', 'Stefon Diggs', 'WR', 'NE')], [ps('Stefon Diggs', 9, 'WAS', 'WR')], [], {}, audit).AZN;
    expect(l.buckets.WR[0].raw).toBe(9);
    expect(audit[0].type).toBe('name_only_match');
  });
});

describe('normalisation (§3)', () => {
  it('normName', () => {
    expect(normName('James Cook III')).toBe(normName('James Cook'));
    expect(normName('Michael Penix Jr.')).toBe(normName('Michael Penix'));
    expect(normName("De'Zhaun Stribling")).toBe(normName('DeZhaun Stribling'));
    expect(normName('A.J. Brown')).toBe('ajbrown');
  });
  it('normTeam', () => {
    expect(['LVR', 'NEP', 'GBP', 'KCC', 'LAR', 'NOS', 'SFO', 'TBB', 'JAC', 'buf', ''].map(normTeam)).toEqual(['LV', 'NE', 'GB', 'KC', 'LA', 'NO', 'SF', 'TB', 'JAX', 'BUF', '']);
  });
  it('posBucket', () => {
    expect(['QB', 'DST', 'D/ST', 'DEF', 'DL', 'CB', 'SS', 'ILB', 'P', ''].map(posBucket)).toEqual(['QB', 'DST', 'DST', 'DST', 'IDP', 'IDP', 'IDP', 'IDP', null, null]);
  });
  it('matchShortName', () => {
    expect(matchShortName('D. Robinson', ['Demarcus Robinson', 'Bijan Robinson'])).toBe('Demarcus Robinson');
    expect(matchShortName('Robinson', ['Demarcus Robinson', 'Bijan Robinson'])).toBeNull();
    expect(matchShortName('Rivers', ['Philip Rivers'])).toBe('Philip Rivers');
  });
});

describe('season pipeline', () => {
  const base: EngineInput = {
    season: 2026, seasonType: 'REG', rules, roster: [], transactions: [], doublers: [], stats: [], tds: [], games: [],
    schedule: [{ season: 2026, week: 1, game_id: 'g', played: true }, { season: 2026, week: 2, game_id: 'h', played: false }],
  };
  it('REGRESSION §8.6: refuses to settle a week with 0 nflverse rows', () => {
    expect(weekStatus(base, 1).status).toBe('unsettled');
    const r = runSeason(base, [1]);
    expect(r.weeks[0].status).toBe('unsettled');
    expect(r.weeks[0].audit[0].type).toBe('week_unsettled');
  });
  it('a week with stats but unplayed games is provisional, never final', () => {
    const s = { ...base, stats: [{ season: 2026, week: 2, season_type: 'REG' } as EngineInput['stats'][number]] };
    expect(weekStatus(s, 2).status).toBe('provisional');
  });
});
