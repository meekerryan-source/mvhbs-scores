// Parsers for the sheet's OUTPUT tabs (what parity compares against). Pure: CSV text in, data out.

import type { Bucket, DisplayTeam } from '../engine/types.js';
import { TEAM_ORDER, normName, normTeam } from '../engine/normalize.js';
import { parseCsvRecords, parseCsvRows } from '../data/csv.js';

const num = (v: unknown) => {
  const s = String(v ?? '').replace(/−/g, '-').replace(/,/g, '').trim();
  if (s === '' || s === '—') return NaN;
  return Number(s);
};

export interface SheetPlayerRow {
  week: number; player_id: string; player: string; position: string; pos_group: string; team: string;
  fantasy_points: number; components: Record<string, number>;
}

export function parseScoredPlayerGame(text: string, season: number): SheetPlayerRow[] {
  return parseCsvRecords(text)
    .filter(r => Number(r.season) === season)
    .map(r => ({
      week: Number(r.week), player_id: r.player_id, player: r.player, position: r.position, pos_group: r.pos_group,
      team: normTeam(r.team), fantasy_points: num(r.fantasy_points),
      components: Object.fromEntries(Object.keys(r).filter(k => k.startsWith('pts_')).map(k => [k.slice(4), num(r[k])])),
    }));
}

export interface SheetDstRow { week: number; team: string; fantasy_points: number; win: number; margin: number; pf: number; pa: number; components: Record<string, number> }

export function parseScoredDstGame(text: string, season: number): SheetDstRow[] {
  return parseCsvRecords(text)
    .filter(r => Number(r.season) === season)
    .map(r => ({
      week: Number(r.week), team: normTeam(r.team), fantasy_points: num(r.fantasy_points), win: num(r.win), margin: num(r.margin),
      pf: num(r.points_for), pa: num(r.points_against),
      components: Object.fromEntries(['win', 'mov', 'shutout', '50_burger'].map(k => [k, num(r['pts_' + k])])),
    }));
}

export interface SheetGridCell { label: string; bucket: Bucket; rank: number; team: DisplayTeam; name: string; starred: boolean; ptsText: string; pts: number }
export interface SheetGrid {
  final: boolean;
  headerText: string;
  cells: SheetGridCell[];
  weekTotal: Record<DisplayTeam, number>;
  previous: Record<DisplayTeam, number>;
  newTotal: Record<DisplayTeam, number>;
}

/**
 * Week_N tab. The header row is the one whose column B is "Jannai"; slot rows follow until
 * "Week total". Points column for team i is index 2 + 2i. Doubled cells may read "raw × 2 = pts"
 * (raw grid) or just pts (formatted grid); names may carry a "★ " prefix.
 */
export function parseWeekGrid(text: string): SheetGrid {
  const rows = parseCsvRows(text);
  const h = rows.findIndex(r => String(r[1] ?? '').trim().endsWith('Jannai'));
  if (h < 0) throw new Error('Week grid: no header row with "Jannai" in column B');
  const headerText = rows.slice(0, h + 1).flat().join(' ');
  const cells: SheetGridCell[] = [];
  const totals = { weekTotal: {}, previous: {}, newTotal: {} } as Record<'weekTotal' | 'previous' | 'newTotal', Record<DisplayTeam, number>>;
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i];
    const label = String(r[0] ?? '').trim();
    const lc = label.toLowerCase();
    const which = lc === 'week total' ? 'weekTotal' : lc === 'previous' || lc === 'previous total' ? 'previous' : lc === 'new total' ? 'newTotal' : null;
    if (which) { TEAM_ORDER.forEach((t, k) => { totals[which][t] = num(r[2 + 2 * k]); }); continue; }
    const m = label.match(/^(QB|RB|WR|TE|K|DST|IDP)(\d+)$/);
    if (!m) continue;
    TEAM_ORDER.forEach((t, k) => {
      const rawName = String(r[1 + 2 * k] ?? '').trim();
      const ptsText = String(r[2 + 2 * k] ?? '').trim();
      if (!rawName) return;
      const dm = ptsText.match(/^\s*(-?[\d.]+)\s*×\s*2\s*=\s*(-?[\d.]+)\s*$/);
      cells.push({
        label, bucket: m[1] as Bucket, rank: Number(m[2]), team: t,
        name: rawName.replace(/^★\s*/, ''), starred: rawName.startsWith('★') || !!dm,
        ptsText, pts: dm ? Number(dm[2]) : num(ptsText),
      });
    });
  }
  return { final: /\bFinal\b/.test(headerText), headerText, cells, ...totals };
}

export interface SheetLogPlayer { week: number; team: string; player: string; key: string; points: number; counted: string; doubler: string; checks: string[]; lines: { category: string; detail: string; points: number }[] }

/** Points Log → per (week, team, player) summaries (sum of lines, Counted, Doubler, Check). */
export function parsePointsLog(text: string): Map<string, SheetLogPlayer> {
  const out = new Map<string, SheetLogPlayer>();
  for (const r of parseCsvRecords(text)) {
    const week = Number(r.Week);
    if (!week) continue;
    const key = `${week}|${r.Team}|${normName(r.Player)}`;
    let p = out.get(key);
    if (!p) out.set(key, (p = { week, team: r.Team, player: r.Player, key, points: 0, counted: r.Counted ?? '', doubler: r.Doubler ?? '', checks: [], lines: [] }));
    const pts = num(r.Points);
    p.points += Number.isNaN(pts) ? 0 : pts;
    p.lines.push({ category: r.Category, detail: r.Detail, points: pts });
    if (r.Check && !p.checks.includes(r.Check)) p.checks.push(r.Check);
  }
  return out;
}

export interface SheetStandingsRow { team: string; total: number; weeks: Record<number, number>; liveWeeks: number[] }

export function parseStandings(text: string): SheetStandingsRow[] {
  const rows = parseCsvRows(text);
  const h = rows.findIndex(r => r.some(c => String(c).trim() === 'Team') && r.some(c => /^W\d+/.test(String(c).trim())));
  if (h < 0) return [];
  const hdr = rows[h].map(c => String(c).trim());
  const ti = hdr.indexOf('Team');
  const toti = hdr.indexOf('Total');
  const wcols = hdr.map((c, i) => [c.match(/^W(\d+)/), i, /live/i.test(c)] as const).filter(([m]) => m);
  return rows.slice(h + 1).filter(r => String(r[ti] ?? '').trim()).map(r => ({
    team: String(r[ti]).trim(),
    total: num(r[toti]),
    weeks: Object.fromEntries(wcols.map(([m, i]) => [Number(m![1]), num(r[i])])),
    liveWeeks: wcols.filter(([, , live]) => live).map(([m]) => Number(m![1])),
  }));
}
