import { describe, expect, it } from 'vitest';
import { statLine } from '../src/web/present.js';
import { parseCsv } from '../src/web/liveEngine.js';
import { k, qb, rb, idp } from './helpers.js';

describe('My team stat line', () => {
  it('QB / RB / K / IDP one-liners', () => {
    expect(statLine(qb({ passing_yards: 249, passing_tds: 2, rushing_yards: 12 }))).toBe('249 pass yds, 2 TD · 12 rush yds');
    expect(statLine(rb({ rushing_yards: 169, rushing_tds: 1, receptions: 2, receiving_yards: 19 }))).toBe('169 rush yds, 1 TD · 2 rec, 19 yds');
    expect(statLine(k({ fg_made: 2, fg_att: 4, fg_made_list: '44;51', fg_missed_list: '33', pat_made: 3, pat_att: 3 }))).toBe('FG 44, 51, missed 33, 3/3 XP, 1 FG blocked');
    expect(statLine(idp({ def_sacks: 1.5, def_interceptions: 1 }))).toBe('1.5 sacks, 1 INT');
    expect(statLine(undefined)).toBe('');
  });
});

describe('browser CSV parser (sheet tabs)', () => {
  it('quotes, doubled quotes, commas, CRLF, blank lines', () => {
    const csv = '"season","week","fantasy_team","player"\r\n"2026","3","Two Allens, One Cup","De\'Von ""DA"" Achane"\r\n\r\n2026,3,KGSC,Mark Andrews\n';
    expect(parseCsv(csv)).toEqual([
      { season: '2026', week: '3', fantasy_team: 'Two Allens, One Cup', player: 'De\'Von "DA" Achane' },
      { season: '2026', week: '3', fantasy_team: 'KGSC', player: 'Mark Andrews' },
    ]);
  });
});
