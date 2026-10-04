import { describe, expect, it } from 'vitest';
import { applyAdjustments } from '../src/engine/adjust.js';
import { parseAdjustments } from '../src/data/load.js';
import { scoreDstGame } from '../src/engine/scoreDst.js';
import { score, wr } from './helpers.js';
import type { AuditEntry } from '../src/engine/types.js';

describe("sheet Adjustments tab (manual corrections)", () => {
  it('adds the points as their own line with the reason; matches suffix names (Deebo Samuel ↔ Deebo Samuel Sr.)', () => {
    const p = score(wr({ player_display_name: 'Deebo Samuel Sr.', week: 3, receiving_tds: 1, receiving_yards: 94 }));
    expect(p.total).toBe(4); // 94 yds +2, TD floored +2 (PBP mis-tagged)
    applyAdjustments(2026, 3, [{ season: 2026, week: 3, player: 'Deebo Samuel', points: 11, reason: '80-yd hook-and-ladder TD' }], [p], []);
    expect(p.total).toBe(15);
    expect(p.components.adjustment).toBe(11);
    expect(p.lines.at(-1)).toMatchObject({ category: 'Adjustment', detail: '80-yd hook-and-ladder TD', points: 11 });
  });
  it('only applies to its own season and week', () => {
    const p = score(wr({ player_display_name: 'Mike Evans', week: 4 }));
    applyAdjustments(2026, 4, [{ season: 2026, week: 3, player: 'Mike Evans', points: 5, reason: '' }], [p], []);
    expect(p.total).toBe(0);
  });
  it('D/ST adjustments by team name; unmatched rows are reported, not dropped silently', () => {
    const d = scoreDstGame(2026, 3, 'LA', 'SF', { team: 'LA', opp: 'SF', pf: 20, pa: 17 });
    const audit: AuditEntry[] = [];
    applyAdjustments(2026, 3, [
      { season: 2026, week: 3, player: 'Los Angeles Rams', points: -3, reason: 'stat correction' },
      { season: 2026, week: 3, player: 'Nobody Atall', points: 4, reason: '' },
    ], [], [d], audit);
    expect(d.total).toBe(0);
    expect(audit.map(a => a.type)).toEqual(['adjustment_unmatched']);
  });
  it('parses the tab and skips blank / zero rows', () => {
    expect(parseAdjustments([
      { season: '2026', week: '3', player: 'Deebo Samuel', points: '11', reason: 'why' },
      { season: '2026', week: '3', player: '', points: '4', reason: '' },
      { season: '2026', week: '3', player: 'X', points: '0', reason: '' },
    ])).toEqual([{ season: 2026, week: 3, player: 'Deebo Samuel', points: 11, reason: 'why' }]);
  });
});
