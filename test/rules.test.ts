import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { bandMatch, diffRules, highestThreshold, RULES_SNAPSHOT } from '../src/engine/rules.js';
import { loadLiveRules } from '../src/data/load.js';
import { cachePath } from '../src/data/sheet.js';

const T = RULES_SNAPSHOT.threshold;
const tiers = (stat: string, pos: string) => T.filter(r => r.stat === stat && r.pos === pos).map(r => [r.min, r.points]);
const bands = (stat: string) => T.filter(r => r.stat === stat).map(r => [r.min, r.max, r.points]);

// The §5 tables of SPEC.md, verbatim. If the league changes a rule, change it here AND in the sheet.
describe('snapshot matches the 2026 LOCKED rule tables (§5)', () => {
  it('QB passing yards', () => expect(tiers('passing_yards', 'QB')).toEqual([[200, 2], [225, 3], [250, 4], [275, 6], [300, 8], [325, 10], [350, 12], [375, 14], [400, 16], [450, 20], [500, 25]]));
  it('QB rush+rec yards', () => expect(tiers('qb_total_yards', 'QB')).toEqual([[25, 1], [50, 4], [75, 6], [100, 8], [125, 11], [150, 13], [200, 18]]));
  it('RB scrimmage yards', () => expect(tiers('total_scrimmage_yards', 'RB')).toEqual([[75, 4], [100, 6], [125, 8], [150, 10], [175, 12], [200, 15], [250, 20], [300, 25]]));
  it('WR/TE scrimmage yards', () => expect(tiers('total_scrimmage_yards', 'WR/TE')).toEqual([[75, 2], [100, 4], [125, 6], [150, 8], [175, 10], [200, 13], [250, 18], [300, 23]]));
  it('RB/TE receptions', () => expect(tiers('receptions', 'RB/TE')).toEqual([[5, 1], [6, 2], [7, 4], [8, 5], [9, 7], [10, 9], [11, 10], [12, 11.5], [13, 13], [14, 14.5], [15, 16]]));
  it('WR receptions', () => expect(tiers('receptions', 'WR')).toEqual([[5, 0], [6, 1], [7, 2], [8, 4], [9, 5], [10, 7], [11, 9], [12, 10], [13, 12], [14, 13], [15, 15]]));
  it('passing TD bands', () => expect(bands('passing_td_distance')).toEqual([[0, 4, 2], [5, 10, 3], [11, 20, 4], [21, 35, 6], [36, 49, 9], [50, null, 12]]));
  it('rushing TD bands', () => expect(bands('rushing_td_distance')).toEqual([[0, 4, 2], [5, 10, 4], [11, 20, 6], [21, 35, 9], [36, 49, 12], [50, null, 15]]));
  it('receiving TD bands', () => expect(bands('receiving_td_distance')).toEqual([[0, 4, 2], [5, 10, 3], [11, 20, 5], [21, 35, 7], [36, 49, 10], [50, null, 13]]));
  it('FG made bands', () => expect(bands('fg_made_distance')).toEqual([
    [17, 29, 2], [30, 39, 3], [40, 49, 4], [50, 55, 7], [56, 59, 9], [60, 60, 11], [61, 61, 12], [62, 62, 13], [63, 63, 14], [64, 64, 15], [65, 65, 16], [66, null, 18],
  ]));
  it('linear rules carry the per-event values', () => {
    const L = Object.fromEntries(RULES_SNAPSHOT.linear.map(r => [r.rule_id, r]));
    expect(L.TWO_POINT_CONV.ppu).toBe(2);
    expect(L.TD_BONUS_QB.unit).toBe('4_tds');
    expect(L.TD_BONUS_NON_QB.unit).toBe('3_tds');
    expect(L.XP_MADE.ppu).toBe(1);
    expect(L.XP_MISSED.ppu).toBe(-1);
    expect(L.FG_MISSED_UNDER_37.ppu).toBe(-1);
    expect(L.TEAM_WIN.ppu).toBe(3);
    expect(L.TEAM_SHUTOUT.ppu).toBe(5);
    expect(L.TEAM_50_BURGER.ppu).toBe(5);
  });
});

describe('highestThreshold / bandMatch', () => {
  it('awards the highest tier reached only — no stacking (§8.11)', () => {
    expect(highestThreshold(T, 'passing_yards', 'QB', 199)).toBe(0);
    expect(highestThreshold(T, 'passing_yards', 'QB', 200)).toBe(2);
    expect(highestThreshold(T, 'passing_yards', 'QB', 312)).toBe(8);
    expect(highestThreshold(T, 'passing_yards', 'QB', 612)).toBe(25);
  });
  it('position group must match', () => {
    expect(highestThreshold(T, 'total_scrimmage_yards', 'RB', 100)).toBe(6);
    expect(highestThreshold(T, 'total_scrimmage_yards', 'WR/TE', 100)).toBe(4);
  });
  it('bands are inclusive and the top band is open-ended', () => {
    expect(bandMatch(T, 'rushing_td_distance', 4)).toBe(2);
    expect(bandMatch(T, 'rushing_td_distance', 5)).toBe(4);
    expect(bandMatch(T, 'rushing_td_distance', 49)).toBe(12);
    expect(bandMatch(T, 'rushing_td_distance', 99)).toBe(15);
    expect(bandMatch(T, 'fg_made_distance', 16)).toBe(0);
    expect(bandMatch(T, 'fg_made_distance', 70)).toBe(18);
  });
});

// Snapshot ⇄ live tabs. Needs `npm run fetch` to have cached the sheet; skipped otherwise.
const live = existsSync(cachePath('Rules_Thresholds')) ? loadLiveRules() : null;
describe.skipIf(!live)('snapshot ⇄ live Rules_* tabs', () => {
  it('agree field-for-field', () => expect(diffRules(RULES_SNAPSHOT, live!)).toEqual([]));
});
