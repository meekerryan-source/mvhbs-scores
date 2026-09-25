import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { parseCsvRecords, splitCsvLine, toCsv } from '../src/data/csv.js';
import { toPlayerWeekStats, files } from '../src/data/nflverse.js';
import { extractTdRows } from '../src/engine/pbp.js';
import { parseLinearRules } from '../src/engine/rules.js';
import { parseWeekGrid, parseStandings } from '../src/parity/sheetOutputs.js';
import { sheetRound } from '../src/parity/parity.js';
import { cachePath } from '../src/data/sheet.js';

describe('REGRESSION §8.5: columns are always read by NAME, never by position', () => {
  it('a reordered stats header parses identically, and every week is kept', () => {
    const header = ['season', 'week', 'season_type', 'player_id', 'player_display_name', 'position', 'position_group', 'team', 'receptions', 'receiving_yards'];
    const rows = [['2026', '1', 'REG', 'A', 'Alpha', 'WR', 'WR', 'KC', '6', '80'], ['2026', '2', 'REG', 'A', 'Alpha', 'WR', 'WR', 'KC', '9', '120']];
    const perm = [9, 3, 0, 8, 1, 7, 2, 6, 4, 5];
    const a = parseCsvRecords(toCsv([header, ...rows])).map(toPlayerWeekStats);
    const b = parseCsvRecords(toCsv([perm.map(i => header[i]), ...rows.map(r => perm.map(i => r[i]))])).map(toPlayerWeekStats);
    expect(b).toEqual(a);
    expect(a.map(s => [s.week, s.receptions, s.receiving_yards])).toEqual([[1, 6, 80], [2, 9, 120]]);
  });
  it('nflverse NA values become 0 / blank', () => {
    const [s] = parseCsvRecords('player_id,season,week,team,fg_made_list,def_sacks\nX,2026,1,LAR,NA,NA\n').map(toPlayerWeekStats);
    expect([s.team, s.fg_made_list, s.def_sacks]).toEqual(['LA', '', 0]);
  });
});

describe('PBP TD extraction (§5.7)', () => {
  it('pass TD → pass + rec rows; rush; pick-six / fumble return (team-level); ST return', () => {
    const base = { season: '2026', week: '1', season_type: 'REG', game_id: 'g', touchdown: '1', posteam: 'KC', defteam: 'BUF', yards_gained: '22', return_yards: '0' };
    expect(extractTdRows({ ...base, pass_touchdown: '1', passer_player_id: 'Q', receiver_player_id: 'W' }).map(r => [r.td_type, r.scorer_id, r.yards_gained])).toEqual([['pass', 'Q', 22], ['rec', 'W', 22]]);
    expect(extractTdRows({ ...base, rush_touchdown: '1', rusher_player_id: 'R' })[0].td_type).toBe('rush');
    expect(extractTdRows({ ...base, return_touchdown: '1', interception: '1', return_yards: '40' })[0]).toMatchObject({ td_type: 'picksix', team: 'BUF', yards_gained: 40, scorer_id: '' });
    expect(extractTdRows({ ...base, return_touchdown: '1', fumble_lost: '1', return_yards: '9' })[0]).toMatchObject({ td_type: 'fumreturn', team: 'BUF' });
    expect(extractTdRows({ ...base, return_touchdown: '1', punt_returner_player_id: 'PR', td_team: 'BUF', return_yards: '70' })[0]).toMatchObject({ td_type: 'st', scorer_id: 'PR', team: 'BUF' });
    expect(extractTdRows({ ...base, touchdown: '0', pass_touchdown: '1' })).toEqual([]);
  });
});

describe('sheet output parsers', () => {
  it('Rules_Linear in its CSV-mashed single-column form', () => {
    const rows = [['rule_id,category,stat_name,position_group,event_scope,points_per_unit,unit,logic_type,source_needed,notes'], ['XP_MADE,kicking_bonus,xp_made,K,per_event,1,xp,linear,weekly_stats,""']];
    expect(parseLinearRules(rows, splitCsvLine)).toEqual([{ rule_id: 'XP_MADE', category: 'kicking_bonus', stat: 'xp_made', pos: 'K', scope: 'per_event', ppu: 1, unit: 'xp', logic: 'linear' }]);
  });
  it('Week_N grid: finds the header by "Jannai", handles ★ and "raw × 2 = pts", reads totals', () => {
    const teams = ['Jannai', 'Meeker', 'Allens', 'Koo', 'Guzman', 'Woo', 'Hottish', 'AZN'];
    const row = (label: string, cells: string[]) => [label, ...cells];
    const csv = toCsv([
      ['', 'Week 2 — 2026', '', '', 'Counted', '', '', '', '', '', '', '', '', '', 'Final · counted lineup highlighted', '', ''],
      row('Slot', teams.flatMap(t => [t, ''])),
      row('QB1', teams.flatMap((t, i) => (i === 0 ? ['★ Jalen Hurts', '9 × 2 = 18'] : [`${t} QB`, '3']))),
      row('Week total', teams.flatMap(() => ['', '157.5'])),
      row('Previous', teams.flatMap(() => ['', '100'])),
      row('New Total', teams.flatMap(() => ['', '257.5'])),
    ]);
    const g = parseWeekGrid(csv);
    expect(g.final).toBe(true);
    expect(g.cells[0]).toMatchObject({ team: 'Jannai', bucket: 'QB', rank: 1, name: 'Jalen Hurts', starred: true, pts: 18 });
    expect([g.weekTotal.AZN, g.previous.AZN, g.newTotal.AZN]).toEqual([157.5, 100, 257.5]);
  });
  it('Standings: header row, W columns, live marker', () => {
    const s = parseStandings('Standings — 2026,,,\n,,,\n#,Team,Total,W1,W2,W3 (live)\n🥇,Allens,312,154,158,0\n');
    expect(s[0]).toEqual({ team: 'Allens', total: 312, weeks: { 1: 154, 2: 158, 3: 0 }, liveWeeks: [3] });
  });
  it('sheetRound = Sheets "0" format (half away from zero)', () => {
    expect([157.5, 11.5, -0.5, 2.4].map(sheetRound)).toEqual([158, 12, -1, 2]);
  });
});

// End-to-end smoke test against the real data (needs `npm run fetch`). §7.4: season totals after W2.
const haveData = existsSync(files(2026).stats) && existsSync(files(2026).pbp) && existsSync(cachePath('Rosters'));
describe.skipIf(!haveData)('real data: 2026 through Week 2', () => {
  it('season totals equal the published standings (Allens 312 is 311.5 shown with the integer format)', async () => {
    const { loadEngineInput } = await import('../src/data/load.js');
    const { runSeason } = await import('../src/engine/season.js');
    const { input } = await loadEngineInput();
    const r = runSeason(input, [1, 2]);
    const totals = Object.fromEntries(r.standings.map(s => [s.team, s.total]));
    expect(totals).toEqual({ Allens: 311.5, Woo: 281, Koo: 273, Guzman: 254, Jannai: 243, Hottish: 223, Meeker: 210, AZN: 194 });
    expect(Object.fromEntries(r.standings.map(s => [s.team, sheetRound(s.total)]))).toEqual({ Allens: 312, Woo: 281, Koo: 273, Guzman: 254, Jannai: 243, Hottish: 223, Meeker: 210, AZN: 194 });
  }, 60_000);
  // SPEC.md says "3 pass + 2 rush"; nflverse has 2 pass + 2 rush. Either way passing-only (the bug) gives 0.
  it('Josh Allen W1 (2 pass + 2 rush TDs in nflverse) gets the +5 QB milestone', async () => {
    const { loadEngineInput } = await import('../src/data/load.js');
    const { runSeason } = await import('../src/engine/season.js');
    const { input } = await loadEngineInput();
    const allen = runSeason(input, [1]).weeks[0].players.find(p => p.player === 'Josh Allen')!;
    expect([allen.stats.passing_tds, allen.stats.rushing_tds, allen.components.td_milestone]).toEqual([2, 2, 5]);
  }, 60_000);
});
