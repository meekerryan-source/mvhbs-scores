import { describe, expect, it } from 'vitest';
import { idp, k, qb, rb, score, stats, td, te, wr } from './helpers.js';
import { intPenalty, parseDistList, sackPoints } from '../src/engine/scorePlayer.js';

describe('Quarterback (§5.1)', () => {
  it('passing yards tier + QB yardage bonus excludes passing yards (§8.11)', () => {
    const r = score(qb({ passing_yards: 410, rushing_yards: 0 }));
    expect(r.components.passing).toBe(16);
    expect(r.components.yardage).toBe(0);
    expect(r.total).toBe(16);
  });
  it('QB rush + rec yards tiers', () => {
    expect(score(qb({ rushing_yards: 24 })).components.yardage).toBe(0);
    expect(score(qb({ rushing_yards: 20, receiving_yards: 5 })).components.yardage).toBe(1);
    expect(score(qb({ rushing_yards: 60 })).components.yardage).toBe(4);
    expect(score(qb({ rushing_yards: 210 })).components.yardage).toBe(18);
  });
  it('passing TD per-TD bands', () => {
    const r = score(qb({ player_id: 'Q', passing_tds: 3 }), [td('pass', 'Q', 3), td('pass', 'Q', 22), td('pass', 'Q', 75)]);
    expect(r.components.td_distance).toBe(2 + 6 + 12);
  });
  it('QB rushing TD uses the RB rushing bands', () => {
    expect(score(qb({ player_id: 'Q2', rushing_tds: 1 }), [td('rush', 'Q2', 8)]).components.td_distance).toBe(4);
  });
  it('REGRESSION §8.1: TD milestone counts TOTAL TDs — Josh Allen W1 3 pass + 2 rush = 5 → +5', () => {
    const r = score(qb({ player_id: 'JA', passing_tds: 3, rushing_tds: 2 }), [
      td('pass', 'JA', 10), td('pass', 'JA', 10), td('pass', 'JA', 10), td('rush', 'JA', 1), td('rush', 'JA', 1),
    ]);
    expect(r.components.td_milestone).toBe(5);
    expect(score(qb({ passing_tds: 3 })).components.td_milestone).toBe(0);
    expect(score(qb({ passing_tds: 8 })).components.td_milestone).toBe(10);
  });
  it('REGRESSION §8.10: INT penalty escalates cumulatively', () => {
    expect([1, 2, 3, 4].map(n => score(qb({ passing_interceptions: n })).components.int_penalty)).toEqual([-1, -3, -6, -10]);
    expect(intPenalty(0)).toBe(-0);
  });
  it('non-QBs never take an INT penalty', () => {
    expect(score(wr({ passing_interceptions: 1 })).components.int_penalty).toBe(0);
  });
  it('2-pt conversions (pass + rush + rec) +2 each', () => {
    expect(score(qb({ passing_2pt_conversions: 1, rushing_2pt_conversions: 1 })).components.two_pt).toBe(4);
    expect(score(wr({ receiving_2pt_conversions: 1 })).components.two_pt).toBe(2);
  });
});

describe('Running back (§5.2)', () => {
  it('scrimmage yards = rush + rec, highest tier only', () => {
    expect(score(rb({ rushing_yards: 60, receiving_yards: 14 })).components.yardage).toBe(0);
    expect(score(rb({ rushing_yards: 60, receiving_yards: 15 })).components.yardage).toBe(4);
    expect(score(rb({ rushing_yards: 180, receiving_yards: 30 })).components.yardage).toBe(15);
    expect(score(rb({ rushing_yards: 301 })).components.yardage).toBe(25);
  });
  it('rushing and receiving TD bands', () => {
    const r = score(rb({ player_id: 'R', rushing_tds: 2, receiving_tds: 1 }), [td('rush', 'R', 1), td('rush', 'R', 18), td('rec', 'R', 7)]);
    expect(r.components.td_distance).toBe(2 + 6 + 3);
    expect(r.components.td_milestone).toBe(5); // 3 TDs → +5 (David Montgomery W1)
  });
  it('RB/TE receptions table', () => {
    expect([4, 5, 7, 12, 14, 15, 20].map(n => score(rb({ receptions: n })).components.receptions)).toEqual([0, 1, 4, 11.5, 14.5, 16, 16]);
  });
});

describe('Wide receiver / tight end (§5.3)', () => {
  it('WR/TE scrimmage yards', () => {
    expect(score(wr({ receiving_yards: 99 })).components.yardage).toBe(2);
    expect(score(te({ receiving_yards: 250 })).components.yardage).toBe(18);
  });
  it('WR receptions use the WR table; TE uses the RB/TE table', () => {
    expect([5, 6, 8, 15].map(n => score(wr({ receptions: n })).components.receptions)).toEqual([0, 1, 4, 15]);
    expect([5, 6, 8, 15].map(n => score(te({ receptions: n })).components.receptions)).toEqual([1, 2, 5, 16]);
  });
  it('WR rushing TD uses the rushing bands; milestone every 3', () => {
    const r = score(wr({ player_id: 'W', rushing_tds: 1, receiving_tds: 2 }), [td('rush', 'W', 40), td('rec', 'W', 55), td('rec', 'W', 30)]);
    expect(r.components.td_distance).toBe(12 + 13 + 7);
    expect(r.components.td_milestone).toBe(5);
  });
  it('position falls back to position_group', () => {
    expect(score(stats({ position: '', position_group: 'RB', rushing_yards: 100 })).components.yardage).toBe(6);
  });
});

describe('TD distances from PBP (§5.7)', () => {
  it('floors every TD to +2 and logs pbp_missing when PBP has none', () => {
    const r = score(rb({ rushing_tds: 2 }));
    expect(r.components.td_distance).toBe(4);
    expect(r.audit.map(a => a.type)).toEqual(['pbp_missing']);
  });
  it('floors and logs pbp_count_mismatch when PBP has some but not all', () => {
    const r = score(wr({ player_id: 'M', receiving_tds: 2 }), [td('rec', 'M', 60)]);
    expect(r.components.td_distance).toBe(4);
    expect(r.audit.map(a => a.type)).toEqual(['pbp_count_mismatch']);
  });
});

describe('Kicker (§5.4)', () => {
  it('FG made bands across the board', () => {
    const r = score(k({ fg_made: 12, fg_att: 12, fg_made_list: '17;29;30;39;40;49;50;55;56;59;60;66' }));
    expect(r.components.kicking).toBe(2 + 2 + 3 + 3 + 4 + 4 + 7 + 7 + 9 + 9 + 11 + 18);
  });
  it('each 60–65 yard FG has its own value', () => {
    expect([61, 62, 63, 64, 65].map(d => score(k({ fg_made: 1, fg_att: 1, fg_made_list: String(d) })).components.kicking)).toEqual([12, 13, 14, 15, 16]);
  });
  it('REGRESSION §8.9: only misses under 37 yards cost −1', () => {
    expect(score(k({ fg_att: 3, fg_missed_list: '36;37;52' })).components.kicking).toBe(-1);
  });
  it('XP made +1, XP missed −1', () => {
    expect(score(k({ pat_made: 4, pat_att: 5, pat_missed: 1 })).components.kicking).toBe(3);
  });
  it('anyone with a made FG or PAT attempt gets kicking points (e.g. a punter)', () => {
    expect(score(stats({ position: 'P', position_group: 'SPEC', pat_att: 1, pat_made: 1 })).components.kicking).toBe(1);
  });
  it('kickers get no yardage / reception logic', () => {
    expect(score(k({ receiving_yards: 100, receptions: 8 })).total).toBe(0);
  });
  it('parseDistList', () => expect(parseDistList('27;44; 52;;x')).toEqual([27, 44, 52]));
});

describe('IDP (§5.6)', () => {
  it('sacks: whole ×3, half ×2', () => {
    expect(sackPoints(1.5).points).toBe(5);
    expect(sackPoints(0.5).points).toBe(2);
    expect(sackPoints(2).points).toBe(6);
    expect(score(idp({ def_sacks: 1.5 })).components.idp).toBe(5);
  });
  it('INT +5 each', () => expect(score(idp({ def_interceptions: 2 })).components.idp).toBe(10));
  it('REGRESSION §8.7: pick-six → receiving bands, fumble return → rushing bands, consumed in order', () => {
    const tds = [td('picksix', '', 40, { team: 'KC' }), td('fumreturn', '', 12, { team: 'KC' })];
    expect(score(idp({ def_tds: 1 }), tds).components.idp).toBe(10); // 40-yd pick-six = +10 (Decision 1 example)
    expect(score(idp({ def_tds: 2 }), tds).components.idp).toBe(10 + 6);
  });
  it('defensive TD with no PBP distance floors to +2 and logs pbp_missing', () => {
    const r = score(idp({ def_tds: 1 }));
    expect(r.components.idp).toBe(2);
    expect(r.audit[0].type).toBe('pbp_missing');
  });
  it('special-teams TD is a flat +15 to the scorer, offense or IDP', () => {
    expect(score(idp({ special_teams_tds: 1 })).components.st_td).toBe(15);
    expect(score(wr({ special_teams_tds: 1 })).total).toBe(15);
  });
});

describe('per-player total (§5.8)', () => {
  it('is the sum of components and of the audit lines', () => {
    const r = score(qb({ player_id: 'T', passing_yards: 305, passing_tds: 2, rushing_yards: 30, passing_interceptions: 2 }), [td('pass', 'T', 12), td('pass', 'T', 48)]);
    expect(r.total).toBe(8 + 1 + 4 + 9 - 3);
    expect(r.lines.reduce((a, l) => a + l.points, 0)).toBe(r.total);
  });
});
