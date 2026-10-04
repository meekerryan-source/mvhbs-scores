import type { AdjustmentRow, AuditEntry, DstScore, PlayerScore } from './types.js';
import { DST_TEAM_TO_CODE, normName, round2 } from './normalize.js';

/**
 * Apply the sheet's manual Adjustments for one week, like the sheet's engine does: each row adds
 * `points` to that player's (or D/ST's) score as its own "Adjustment" line carrying the reason.
 * Players match by normName (so "Deebo Samuel" matches "Deebo Samuel Sr."); a row that matches
 * nobody in the week's stats is reported, never silently dropped. Mutates the scores in place.
 */
export function applyAdjustments(
  season: number, week: number, rows: AdjustmentRow[], players: PlayerScore[], dst: DstScore[], audit: AuditEntry[] = [],
): void {
  for (const a of rows) {
    if (a.season !== season || a.week !== week || !a.points) continue;
    const line = { component: 'adjustment' as const, category: 'Adjustment', detail: a.reason || 'Manual adjustment', points: a.points };
    const code = DST_TEAM_TO_CODE[a.player.trim()];
    if (code) {
      const d = dst.find(x => x.team === code);
      if (d) { d.lines.push({ ...line, component: 'dst' }); d.total = round2(d.total + a.points); continue; }
    } else {
      const p = players.find(x => normName(x.player) === normName(a.player));
      if (p) {
        p.lines.push(line);
        p.components.adjustment = round2((p.components.adjustment ?? 0) + a.points);
        p.total = round2(p.total + a.points);
        continue;
      }
    }
    audit.push({ type: 'adjustment_unmatched', msg: `W${week} adjustment for "${a.player}" (${a.points > 0 ? '+' : ''}${a.points}) matches nobody in this week's stats — not applied` });
  }
}
