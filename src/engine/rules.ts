import type { LinearRule, Rules, ThresholdRule } from './types.js';
import snapshot from './rules.snapshot.json' with { type: 'json' };

/** The checked-in copy of Rules_Thresholds / Rules_Linear (refresh with `npm run fetch -- --update-rules`). */
export const RULES_SNAPSHOT: Rules = snapshot as Rules;

function num(v: unknown): number {
  if (v === '' || v == null) return 0;
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
}

/** Rules_Thresholds records (header-keyed) → ThresholdRule[]. Blank threshold_max = open-ended. */
export function parseThresholdRules(records: Record<string, string>[]): ThresholdRule[] {
  return records
    .filter(r => r.rule_id)
    .map(r => {
      const rawMax = r.threshold_max;
      const max = rawMax === '' || rawMax == null ? null : Number(rawMax);
      return {
        rule_id: r.rule_id,
        category: r.category,
        stat: r.stat_name,
        pos: r.position_group,
        scope: r.event_scope,
        min: num(r.threshold_min),
        max: max != null && !Number.isNaN(max) ? max : null,
        points: num(r.points),
      };
    });
}

/**
 * Rules_Linear rows → LinearRule[]. The live tab stores each rule as one CSV-mashed string in
 * column A (header included); a clean 10-column layout is accepted too.
 */
export function parseLinearRules(rows: string[][], splitCsvLine: (line: string) => string[]): LinearRule[] {
  if (!rows.length) return [];
  const clean = rows[0].length >= 5 && !String(rows[0][0]).includes(',');
  const table = clean ? rows : rows.map(r => splitCsvLine(String(r[0] ?? '')));
  const hdr = table[0].map(h => String(h).trim());
  const ix = (k: string) => hdr.indexOf(k);
  return table
    .slice(1)
    .filter(c => c.length >= 5 && c[ix('rule_id')])
    .map(c => ({
      rule_id: c[ix('rule_id')],
      category: c[ix('category')],
      stat: c[ix('stat_name')],
      pos: c[ix('position_group')],
      scope: c[ix('event_scope')],
      ppu: num(c[ix('points_per_unit')]),
      unit: c[ix('unit')],
      logic: c[ix('logic_type')],
    }));
}

/** Tiered table: the best (max) points among rows for (stat, pos) whose threshold_min ≤ value. 0 if none. */
export function highestThreshold(rules: ThresholdRule[], stat: string, pos: string, value: number): number {
  return bestThresholdRule(rules, stat, pos, value)?.points ?? 0;
}

/** Same as highestThreshold but returns the rule that produced the points (for the audit trail). */
export function bestThresholdRule(rules: ThresholdRule[], stat: string, pos: string, value: number): ThresholdRule | null {
  let best: ThresholdRule | null = null;
  for (const r of rules) {
    if (r.stat !== stat || String(r.pos).toUpperCase() !== pos.toUpperCase()) continue;
    if (value >= r.min && (!best || r.points > best.points)) best = r;
  }
  return best;
}

/** Banded table (per-TD / per-FG): the first row for `stat` with min ≤ value ≤ max. Ignores position, like the sheet. */
export function bandRule(rules: ThresholdRule[], stat: string, value: number): ThresholdRule | null {
  for (const r of rules) {
    if (r.stat !== stat) continue;
    if (value < r.min) continue;
    if (r.max != null && value > r.max) continue;
    return r;
  }
  return null;
}

export function bandMatch(rules: ThresholdRule[], stat: string, value: number): number {
  return bandRule(rules, stat, value)?.points ?? 0;
}

/** Field-by-field diff of two rule sets (used by the snapshot ⇄ live test and the parity report). */
export function diffRules(a: Rules, b: Rules): string[] {
  const out: string[] = [];
  const cmp = <T extends { rule_id: string }>(label: string, xs: T[], ys: T[]) => {
    const ym = new Map(ys.map(y => [y.rule_id, y]));
    const xm = new Map(xs.map(x => [x.rule_id, x]));
    for (const x of xs) {
      const y = ym.get(x.rule_id);
      if (!y) { out.push(`${label} ${x.rule_id}: only in snapshot`); continue; }
      for (const k of Object.keys(x) as (keyof T)[]) {
        if (String(x[k]) !== String(y[k])) out.push(`${label} ${x.rule_id}.${String(k)}: snapshot=${x[k]} live=${y[k]}`);
      }
    }
    for (const y of ys) if (!xm.has(y.rule_id)) out.push(`${label} ${y.rule_id}: only in live tab`);
  };
  cmp('threshold', a.threshold, b.threshold);
  cmp('linear', a.linear, b.linear);
  return out;
}
