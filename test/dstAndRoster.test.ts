import { describe, expect, it } from 'vitest';
import { indexGames, movPoints, scoreAllDst, scoreDstGame } from '../src/engine/scoreDst.js';
import { addDropAllowedForWeek, pairTransactions, resolveRosterForWeek, validateTransactions } from '../src/engine/roster.js';
import { idp, rosterRow } from './helpers.js';
import type { AuditEntry, TransactionRow } from '../src/engine/types.js';

const game = (pf: number, pa: number) => ({ team: 'KC', opp: 'BUF', pf, pa });

describe('Team D/ST — outcomes only (§5.5)', () => {
  it('win +3 and MOV bands (highest only)', () => {
    expect([1, 3, 4, 7, 8, 10, 11, 14, 15, 21, 22, 28, 29, 40].map(m => scoreDstGame(2026, 1, 'KC', 'BUF', game(5 + m, 5)).total))
      .toEqual([3, 3, 4, 4, 5, 5, 7, 7, 9, 9, 11, 11, 13, 13]);
  });
  it('loss scores 0', () => expect(scoreDstGame(2026, 1, 'KC', 'BUF', game(10, 24)).total).toBe(0));
  it('shutout +5 on top of win/MOV', () => expect(scoreDstGame(2026, 1, 'KC', 'BUF', game(17, 0)).total).toBe(3 + 6 + 5));
  it('REGRESSION §8.12: ties — no win, no MOV; a 0–0 tie is still a shutout (+5)', () => {
    expect(scoreDstGame(2026, 1, 'KC', 'BUF', game(20, 20)).total).toBe(0);
    const t = scoreDstGame(2026, 1, 'KC', 'BUF', game(0, 0));
    expect([t.total, t.win, t.pts_mov]).toEqual([5, 0, 0]);
  });
  it('50-burger only in a win', () => {
    expect(scoreDstGame(2026, 1, 'KC', 'BUF', game(52, 10)).pts_50_burger).toBe(5);
    expect(scoreDstGame(2026, 1, 'KC', 'BUF', game(50, 53)).total).toBe(0);
  });
  it('no game row → 0 and a missing_game audit', () => {
    const audit: AuditEntry[] = [];
    expect(scoreDstGame(2026, 7, 'KC', 'BUF', undefined, audit).total).toBe(0);
    expect(audit[0].type).toBe('missing_game');
  });
  it('REGRESSION §8.8: sacks / INTs / defensive and return TDs never score for the team D/ST', () => {
    const games = indexGames([{ season: 2026, week: 1, game_id: 'g', home_team: 'KC', away_team: 'BUF', home_score: 13, away_score: 20 }]);
    const [kc] = scoreAllDst([idp({ team: 'KC', def_sacks: 5, def_interceptions: 3, def_tds: 2, special_teams_tds: 1 })], games);
    expect(kc.total).toBe(0);
  });
  it('movPoints gives nothing under 4', () => expect(movPoints(3)).toBeNull());
  it('indexGames maps both sides and normalises codes', () => {
    const g = indexGames([{ season: 2026, week: 2, game_id: 'x', home_team: 'LAR', away_team: 'SFO', home_score: 7, away_score: 27 }]);
    expect(g['2026_2_LA']).toEqual({ team: 'LA', opp: 'SF', pf: 7, pa: 27 });
    expect(g['2026_2_SF'].pf).toBe(27);
  });
});

const tx = (Week: number, Team: string, Kind: string, Action: string, Player: string, Position: string): TransactionRow => ({ Week, Team, Kind, Action, Player, Position });

describe('Roster resolution (§4)', () => {
  const base = [
    rosterRow('KGSC', 'Jaylen Waddle', 'WR', 'MIA'),
    rosterRow('KGSC', "De'Zhaun Stribling", 'WR', 'SF'),
    rosterRow('KGSC', 'Mark Andrews', 'TE', 'BAL'),
  ];
  const known = [tx(2, 'Jannai', 'IR_SWAP', 'DROP', "De'Zhaun Stribling", 'WR'), tx(2, 'Jannai', 'IR_SWAP', 'ADD', 'Demarcus Robinson', 'WR')];

  it('pairs ADD/DROP within (Week, Team, Kind) and maps display → roster team', () => {
    expect(pairTransactions(known)).toEqual([{ week: 2, fantasy_team: 'KGSC', type: 'IR', player_out: "De'Zhaun Stribling", player_in: 'Demarcus Robinson', nfl_team_in: '', position_in: 'WR' }]);
  });
  it('the Week 2 Jannai IR swap applies from Week 2 on, in place', () => {
    const txs = pairTransactions(known);
    expect(resolveRosterForWeek(base, txs, 1).map(r => r.player)).toEqual(['Jaylen Waddle', "De'Zhaun Stribling", 'Mark Andrews']);
    const w2 = resolveRosterForWeek(base, txs, 2);
    expect(w2.map(r => r.player)).toEqual(['Jaylen Waddle', 'Demarcus Robinson', 'Mark Andrews']);
    expect(w2[1]).toMatchObject({ position: 'WR', nfl_team: 'SF', acquired_week: 2, acquired_via: 'IR' });
  });
  it('matches the dropped player by short name ("D. Stribling") and suffix-insensitive name', () => {
    const txs = pairTransactions([tx(3, 'Jannai', 'ADD_DROP', 'DROP', 'M. Andrews', 'TE'), tx(3, 'Jannai', 'ADD_DROP', 'ADD', 'Kyle Pitts Sr.', 'TE')]);
    expect(resolveRosterForWeek(base, txs, 3).map(r => r.player)).toContain('Kyle Pitts Sr.');
    expect(resolveRosterForWeek(base, txs, 3).map(r => r.player)).not.toContain('Mark Andrews');
  });
  it('a drop that matches nobody is logged loudly and the ADD still lands', () => {
    const audit: AuditEntry[] = [];
    const txs = pairTransactions([tx(5, 'Jannai', 'ADD_DROP', 'DROP', 'Nobody Here', 'WR'), tx(5, 'Jannai', 'ADD_DROP', 'ADD', 'New Guy', 'WR')]);
    const r = resolveRosterForWeek(base, txs, 5, audit);
    expect(r.map(x => x.player)).toContain('New Guy');
    expect(audit.map(a => a.type)).toEqual(['tx_player_not_on_roster']);
  });
  it('half transactions apply and warn', () => {
    const audit: AuditEntry[] = [];
    const txs = pairTransactions([tx(6, 'Jannai', 'ADD_DROP', 'DROP', 'Jaylen Waddle', 'WR')], audit);
    expect(audit[0].type).toBe('tx_unpaired');
    expect(resolveRosterForWeek(base, txs, 6).map(r => r.player)).toEqual(["De'Zhaun Stribling", 'Mark Andrews']);
  });
  it('accepts both Hotish and Hottish', () => {
    expect(pairTransactions([tx(5, 'Hotish', 'ADD_DROP', 'ADD', 'A', 'WR')])[0].fantasy_team).toBe('Hotish');
    expect(pairTransactions([tx(5, 'Hottish', 'ADD_DROP', 'ADD', 'A', 'WR')])[0].fantasy_team).toBe('Hotish');
  });
  it('validation warns on IR team/position mismatch and on ADD_DROP budget', () => {
    const audit: AuditEntry[] = [];
    const txs = pairTransactions([
      tx(2, 'Jannai', 'IR_SWAP', 'DROP', "De'Zhaun Stribling", 'WR'), tx(2, 'Jannai', 'IR_SWAP', 'ADD', 'Some Tight End', 'TE'),
      tx(3, 'Jannai', 'ADD_DROP', 'DROP', 'Jaylen Waddle', 'WR'), tx(3, 'Jannai', 'ADD_DROP', 'ADD', 'X', 'WR'),
      tx(5, 'Jannai', 'ADD_DROP', 'DROP', 'X', 'WR'), tx(5, 'Jannai', 'ADD_DROP', 'ADD', 'Y', 'WR'),
    ]);
    validateTransactions(base, txs, p => (p === 'Some Tight End' ? 'DAL' : undefined), audit);
    expect(audit.map(a => a.type)).toEqual(['tx_ir_team_mismatch', 'tx_ir_pos_mismatch', 'tx_addrop_too_early', 'tx_addrop_budget']);
  });
  it('ADD_DROP budget unlocks after weeks 4 / 8 / 12', () => {
    expect([4, 5, 8, 9, 12, 13, 18].map(addDropAllowedForWeek)).toEqual([0, 1, 1, 3, 3, 4, 4]);
  });
});
