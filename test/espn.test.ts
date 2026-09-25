import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseEspnSummary, parseScoreboard, rosterIndex, liveGameResults } from '../src/engine/espn.js';
import { runSeason, type EngineInput } from '../src/engine/season.js';
import { rosterRow, rules } from './helpers.js';

// Trimmed ESPN payloads captured during ATL @ GB, 2026 Week 3 (4th quarter, ATL 24–7).
const sb = JSON.parse(readFileSync('test/fixtures/espn_scoreboard_2026_w3.json', 'utf8'));
const summary = JSON.parse(readFileSync('test/fixtures/espn_summary_2026_w3_ATL_GB.json', 'utf8'));
const roster = [
  rosterRow('Yellow Legal Pad', 'Bijan Robinson', 'RB', 'ATL'),
  rosterRow('Yellow Legal Pad', 'Nick Folk', 'K', 'ATL'),
  rosterRow('Allens', 'Michael Penix Jr.', 'QB', 'ATL'),
  rosterRow('Jannai', 'Trey Smack', 'K', 'GB'),
  rosterRow('Koo', 'Christian Watson', 'WR', 'GB'),
];
const games = parseScoreboard(sb);
const game = games.find(g => g.id === '401872948')!;
const parsed = parseEspnSummary(summary, game, 2026, 3, rosterIndex(roster));
const by = (name: string, team: string) => parsed.stats.filter(s => s.player_display_name === name && s.team === team);

describe('ESPN scoreboard', () => {
  it('parses all 16 games with state and current score; only started games become results', () => {
    expect(games).toHaveLength(16);
    expect(game).toMatchObject({ home: 'GB', away: 'ATL', hs: 7, as: 24, state: 'in', started: true });
    expect(liveGameResults(games, 2026, 3)).toEqual([{ season: 2026, week: 3, game_id: '401872948', home_team: 'GB', away_team: 'ATL', home_score: 7, away_score: 24 }]);
  });
});

describe('ESPN summary → stat lines (port of LiveScoring.gs parseGame_)', () => {
  it('box score lines, with roster spelling and position', () => {
    expect(by('Michael Penix Jr.', 'ATL')[0]).toMatchObject({ position: 'QB', passing_yards: 200, passing_tds: 1, passing_interceptions: 1 });
    expect(by('Christian Watson', 'GB')[0]).toMatchObject({ position: 'WR', receptions: 3, receiving_yards: 31, receiving_tds: 1 });
  });
  it('does not map Brian Robinson Jr. onto rostered Bijan Robinson (same team, last name and initial)', () => {
    expect(by('Bijan Robinson', 'ATL')).toHaveLength(1);
    expect(by('Bijan Robinson', 'ATL')[0]).toMatchObject({ rushing_yards: 169, rushing_tds: 1 });
    expect(by('Brian Robinson Jr.', 'ATL')[0]).toMatchObject({ rushing_yards: 50, rushing_tds: 1 });
  });
  it('kicking: FG distance from scoringPlays; a BLOCKED FG is an attempt, not a miss', () => {
    expect(by('Nick Folk', 'ATL')[0]).toMatchObject({ position: 'K', position_group: 'SPEC', fg_made: 1, fg_made_list: '44', pat_made: 3 });
    expect(by('Trey Smack', 'GB')[0]).toMatchObject({ fg_att: 1, fg_made: 0, fg_missed_list: '', pat_made: 1 });
  });
  it('TD distances keyed to the right ESPN athlete', () => {
    const id = (n: string, t: string) => by(n, t)[0].player_id;
    const k = (x: { td_type: string; scorer_id: string; yards_gained: number }) => `${x.td_type}:${x.scorer_id}:${x.yards_gained}`;
    expect(parsed.tds.map(k)).toEqual([
      `pass:${id('Jordan Love', 'GB')}:4`, `rec:${id('Christian Watson', 'GB')}:4`,
      `rush:${id('Bijan Robinson', 'ATL')}:3`,
      `pass:${id('Michael Penix Jr.', 'ATL')}:5`, `rec:${id('Austin Hooper', 'ATL')}:5`,
      `rush:${id('Brian Robinson Jr.', 'ATL')}:7`,
    ]);
    expect(parsed.notes).toEqual([]);
  });
});

describe('live week in the season pipeline', () => {
  const input: EngineInput = {
    season: 2026, seasonType: 'REG', rules, roster, transactions: [], doublers: [], stats: [], tds: [], games: [],
    live: { 3: { stats: parsed.stats, tds: parsed.tds, games: liveGameResults(games, 2026, 3), espnGames: games, fetchedAt: '2026-09-24T23:40:00Z', notes: [] } },
  };
  const w = runSeason(input, [3]).weeks[0];
  it('is Live (never Final) and scores from ESPN with PBP distances', () => {
    expect(w.status).toBe('live');
    expect(w.live?.allFinal).toBe(false);
    const bijan = w.lineups.Guzman.buckets.RB[0];
    // 169 rush + 19 rec = 188 scrimmage → +12, 3-yd rush TD → +2
    expect([bijan.player, bijan.raw]).toEqual(['Bijan Robinson', 14]);
    // Folk: 44-yd FG +4, 3 XP +3
    expect(w.lineups.Guzman.buckets.K[0].raw).toBe(7);
    expect(w.audit.filter(a => a.type.startsWith('pbp_'))).toEqual([]);
  });
  it('nflverse data for the week always wins over ESPN', () => {
    const official = { ...input, stats: [{ ...parsed.stats[0], player_id: 'nflverse' }] };
    expect(runSeason(official, [3]).weeks[0].status).not.toBe('live');
  });
});
