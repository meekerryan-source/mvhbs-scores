// Parity: diff the app's computed week against the sheet's published output tabs.

import type { DisplayTeam, Rules } from '../engine/types.js';
import type { SeasonResult, WeekResult } from '../engine/season.js';
import { BUCKET_ORDER, GRID_ROWS, countedLabel, type LineupEntry } from '../engine/lineup.js';
import { TEAM_ORDER, normName, round2 } from '../engine/normalize.js';
import { diffRules } from '../engine/rules.js';
import type { SheetDstRow, SheetGrid, SheetLogPlayer, SheetPlayerRow, SheetStandingsRow } from './sheetOutputs.js';

export type Section = 'rules' | 'player' | 'dst' | 'slot' | 'grid' | 'week_total' | 'season_total' | 'points_log';
export const SECTION_ORDER: Section[] = ['rules', 'player', 'dst', 'slot', 'grid', 'week_total', 'season_total', 'points_log'];
export const SECTION_TITLE: Record<Section, string> = {
  rules: 'Rules snapshot vs live Rules_* tabs',
  player: 'Per-player raw scores (Scored_Player_Game)',
  dst: 'Team D/ST scores (Scored_DST_Game)',
  slot: 'Slot assignment (Points Log "Counted")',
  grid: 'Week grid cells (name / points per slot row)',
  week_total: 'Team week totals (Week_N "Week total")',
  season_total: 'Season totals (Week_N "New Total" and Standings)',
  points_log: 'Points Log per-player sums',
};

export interface Mismatch { section: Section; key: string; app: string; sheet: string; detail?: string }
export interface Note { key: string; msg: string }

export interface SheetSnapshot {
  players: SheetPlayerRow[];
  dst: SheetDstRow[];
  grid: SheetGrid | null;
  log: Map<string, SheetLogPlayer>;
  standings: SheetStandingsRow[];
  liveRules: Rules | null;
}

export interface ParityReport {
  week: number;
  generatedAt: string;
  appStatus: WeekResult['status'];
  sheetFinal: boolean;
  asserted: boolean;
  skipReason?: string;
  mismatches: Mismatch[];
  notes: Note[];
  counts: Record<Section, number>;
  checked: Record<string, number>;
}

/** Google Sheets' "0" number format: round half away from zero. */
export const sheetRound = (x: number) => Math.sign(x) * Math.round(Math.abs(x));

/**
 * True when the app value equals the sheet cell, allowing for the sheet's integer display format
 * (the published tabs show 157.5 as 158). `note` is called when only the rounded values agree.
 */
function sameShown(app: number, sheet: number, note?: () => void): boolean {
  if (Number.isNaN(sheet)) return false;
  if (Math.abs(app - sheet) < 0.01) return true;
  if (Number.isInteger(sheet) && !Number.isInteger(round2(app)) && sheetRound(app) === sheet) { note?.(); return true; }
  return false;
}

const fmtComponents = (c: Record<string, number>) =>
  Object.entries(c).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(' ') || '(all zero)';

function entriesOf(w: WeekResult, team: DisplayTeam): LineupEntry[] {
  return BUCKET_ORDER.flatMap(b => w.lineups[team].buckets[b]);
}

export function runParity(season: SeasonResult, week: number, sheet: SheetSnapshot, opts: { assert: boolean; skipReason?: string; snapshotRules: Rules }): ParityReport {
  const w = season.weeks.find(x => x.week === week);
  if (!w) throw new Error(`Week ${week} was not computed`);
  const mm: Mismatch[] = [];
  const notes: Note[] = [];
  const checked: Record<string, number> = {};
  const bump = (k: string) => { checked[k] = (checked[k] ?? 0) + 1; };

  // 0) Rules: checked-in snapshot vs the live tabs
  if (sheet.liveRules) for (const d of diffRules(opts.snapshotRules, sheet.liveRules)) mm.push({ section: 'rules', key: d, app: 'snapshot', sheet: 'live' });

  // 1) Per-player raw scores — keyed by player_id within the week
  const sheetP = new Map(sheet.players.filter(p => p.week === week).map(p => [p.player_id, p]));
  const appP = new Map(w.players.map(p => [p.player_id, p]));
  for (const [id, a] of appP) {
    bump('player');
    const s = sheetP.get(id);
    if (!s) { if (a.total !== 0) mm.push({ section: 'player', key: `${a.player} (${a.team}) ${id}`, app: String(a.total), sheet: '(no row)', detail: fmtComponents(a.components) }); continue; }
    if (Math.abs(a.total - s.fantasy_points) >= 0.01) {
      mm.push({ section: 'player', key: `${a.player} (${a.team}) ${id}`, app: String(a.total), sheet: String(s.fantasy_points), detail: `app: ${fmtComponents(a.components)} | sheet: ${fmtComponents(s.components)}` });
    }
  }
  for (const [id, s] of sheetP) if (!appP.has(id) && s.fantasy_points !== 0) {
    mm.push({ section: 'player', key: `${s.player} (${s.team}) ${id}`, app: '(no row)', sheet: String(s.fantasy_points), detail: fmtComponents(s.components) });
  }

  // 1b) D/ST
  const sheetD = new Map(sheet.dst.filter(d => d.week === week).map(d => [d.team, d]));
  for (const a of w.dst) {
    bump('dst');
    const s = sheetD.get(a.team);
    if (!s) { mm.push({ section: 'dst', key: a.team, app: String(a.total), sheet: '(no row)' }); continue; }
    if (Math.abs(a.total - s.fantasy_points) >= 0.01) {
      mm.push({ section: 'dst', key: a.team, app: String(a.total), sheet: String(s.fantasy_points), detail: `app ${a.pf}–${a.pa} win=${a.pts_win} mov=${a.pts_mov} so=${a.pts_shutout} 50=${a.pts_50_burger} | sheet ${s.pf}–${s.pa} ${fmtComponents(s.components)}` });
    }
  }
  for (const [team, s] of sheetD) if (!w.dst.some(d => d.team === team)) mm.push({ section: 'dst', key: team, app: '(no row)', sheet: String(s.fantasy_points) });

  // 2) Slot assignment — Points Log "Counted" per rostered player (only once the sheet week is final)
  for (const t of TEAM_ORDER) for (const e of entriesOf(w, t)) {
    const s = sheet.log.get(`${week}|${t}|${normName(e.player)}`);
    if (!s) { mm.push({ section: 'slot', key: `${t} · ${e.player}`, app: countedLabel(e), sheet: '(not in Points Log)' }); continue; }
    if (!s.counted) continue; // week not final on the sheet — no slots published
    bump('slot');
    if (s.counted !== countedLabel(e)) {
      mm.push({ section: 'slot', key: `${t} · ${e.player}`, app: countedLabel(e), sheet: s.counted, detail: `pts ${e.pts}${e.doubled ? ' (doubler)' : ''}` });
    }
  }

  // 3) Grid cells (row by row, so ordering differences show up too) + totals
  if (sheet.grid) {
    const g = sheet.grid;
    for (const [b, n] of GRID_ROWS) for (let k = 1; k <= n; k++) for (const t of TEAM_ORDER) {
      bump('grid');
      const e = w.lineups[t].buckets[b][k - 1];
      const c = g.cells.find(x => x.team === t && x.bucket === b && x.rank === k);
      const key = `${t} ${b}${k}`;
      if (!e && !c) continue;
      if (!e || !c) { mm.push({ section: 'grid', key, app: e ? `${e.player} ${e.pts}` : '(empty)', sheet: c ? `${c.name} ${c.ptsText}` : '(empty)' }); continue; }
      const nameOk = normName(e.player) === normName(c.name);
      const ptsOk = sameShown(e.pts, c.pts, () => notes.push({ key, msg: `${e.player}: app ${e.pts}, sheet shows ${c.ptsText} (integer display format)` }));
      if (!nameOk || !ptsOk) mm.push({ section: 'grid', key, app: `${e.player} ${e.pts}`, sheet: `${c.name} ${c.ptsText}` });
      if (nameOk && e.doubled !== c.starred) mm.push({ section: 'grid', key, app: e.doubled ? 'doubled' : 'not doubled', sheet: c.starred ? '★ doubled' : 'not doubled' });
    }
    for (const t of TEAM_ORDER) {
      bump('week_total');
      const a = w.weekTotals[t];
      if (!sameShown(a, g.weekTotal[t], () => notes.push({ key: `${t} week total`, msg: `app ${a}, sheet shows ${g.weekTotal[t]} (integer display format)` }))) {
        mm.push({ section: 'week_total', key: t, app: String(a), sheet: String(g.weekTotal[t]) });
      }
      bump('season_total');
      const n = w.newTotals[t];
      if (!sameShown(n, g.newTotal[t], () => notes.push({ key: `${t} new total`, msg: `app ${n}, sheet shows ${g.newTotal[t]} (integer display format)` }))) {
        mm.push({ section: 'season_total', key: `${t} (Week_${week} New Total)`, app: String(n), sheet: String(g.newTotal[t]) });
      }
    }
  } else {
    notes.push({ key: 'grid', msg: `No Week_${week} tab cached — grid/total checks skipped` });
  }

  // 3b) Standings: week column and cumulative through this week
  for (const s of sheet.standings) {
    const t = s.team as DisplayTeam;
    if (!TEAM_ORDER.includes(t)) continue;
    const sw = s.weeks[week];
    if (sw != null && !s.liveWeeks.includes(week) && !sameShown(w.weekTotals[t], sw)) {
      mm.push({ section: 'season_total', key: `${t} (Standings W${week})`, app: String(w.weekTotals[t]), sheet: String(sw) });
    }
    const cum = Object.entries(s.weeks).filter(([k]) => Number(k) <= week).reduce((a, [, v]) => a + (Number.isNaN(v) ? 0 : v), 0);
    if (!sameShown(w.newTotals[t], cum, () => notes.push({ key: `${t} standings`, msg: `app cumulative ${w.newTotals[t]}, Standings W1–W${week} sum ${cum}` }))) {
      mm.push({ section: 'season_total', key: `${t} (Standings W1–W${week} sum)`, app: String(w.newTotals[t]), sheet: String(cum) });
    }
  }

  // 4) Points Log per-player sums (each line displayed with the integer format, so compare line-rounded sums)
  for (const t of TEAM_ORDER) for (const e of entriesOf(w, t)) {
    const s = sheet.log.get(`${week}|${t}|${normName(e.player)}`);
    if (!s) continue;
    bump('points_log');
    const lines = e.dst?.lines ?? e.score?.lines ?? [];
    const shown = lines.reduce((a, l) => a + sheetRound(l.points), 0);
    if (Math.abs(shown - s.points) >= 0.01 && Math.abs(e.raw - s.points) >= 0.01) {
      mm.push({ section: 'points_log', key: `${t} · ${e.player}`, app: String(e.raw), sheet: String(s.points), detail: s.lines.map(l => `${l.category} ${l.points}`).join('; ') });
    }
    const bad = s.checks.filter(c => c.startsWith('MISMATCH'));
    if (bad.length) notes.push({ key: `${t} · ${e.player}`, msg: `sheet Points Log self-check: ${bad.join(', ')}` });
  }

  const counts = Object.fromEntries(SECTION_ORDER.map(s => [s, mm.filter(m => m.section === s).length])) as Record<Section, number>;
  return {
    week, generatedAt: new Date().toISOString(), appStatus: w.status, sheetFinal: !!sheet.grid?.final,
    asserted: opts.assert, skipReason: opts.skipReason, mismatches: mm, notes, counts, checked,
  };
}

export function formatReport(r: ParityReport, audit: { type: string; msg: string }[]): string {
  const out: string[] = [];
  out.push(`Parity — Week ${r.week}   app: ${r.appStatus}   sheet grid: ${r.sheetFinal ? 'Final' : 'not final'}`);
  if (!r.asserted) out.push(`(not asserted: ${r.skipReason ?? 'week not final'}) — mismatches listed for information only`);
  out.push('');
  const pbp = audit.filter(a => a.type.startsWith('pbp_') || a.type === 'missing_game' || a.type === 'week_unsettled');
  if (pbp.length) {
    out.push(`!! ${pbp.length} data-quality warning(s) — TD bonuses may be floored:`);
    for (const a of pbp) out.push(`   [${a.type}] ${a.msg}`);
    out.push('');
  }
  for (const s of SECTION_ORDER) {
    const list = r.mismatches.filter(m => m.section === s);
    const n = r.checked[s];
    out.push(`${list.length ? '✗' : '✓'} ${SECTION_TITLE[s]}${n != null ? ` — ${n} checked` : ''}, ${list.length} mismatch${list.length === 1 ? '' : 'es'}`);
    for (const m of list.slice(0, 200)) {
      out.push(`    ${m.key}: app ${m.app}  ≠  sheet ${m.sheet}`);
      if (m.detail) out.push(`        ${m.detail}`);
    }
    if (list.length > 200) out.push(`    … ${list.length - 200} more`);
  }
  if (r.notes.length) {
    out.push('');
    out.push(`Notes (${r.notes.length}):`);
    for (const n of r.notes) out.push(`  · ${n.key}: ${n.msg}`);
  }
  const total = r.mismatches.length;
  out.push('');
  out.push(total ? `RESULT: ${total} mismatch${total === 1 ? '' : 'es'}${r.asserted ? '' : ' (not asserted)'}` : 'RESULT: parity clean ✓');
  return out.join('\n');
}
