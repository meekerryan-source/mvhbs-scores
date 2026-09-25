// Browser entry point (bundled to dist/engine.js). Lets the page score the current week LIVE on its
// own — straight from ESPN (CORS-open) plus the sheet's latest Doublers / Transactions / Rosters —
// using the same engine code as the official build. No server needed; nflverse stays official.

import type { DoublerRow, RosterEntry, Rules, TransactionRow } from '../engine/types.js';
import { liveGameResults, parseEspnSummary, parseScoreboard, rosterIndex, type EspnGame, type LiveParse } from '../engine/espn.js';
import { runSeason, type EngineInput } from '../engine/season.js';
import { normTeam } from '../engine/normalize.js';
import { weekJson, type WeekJson } from './present.js';

const ESPN = 'https://site.web.api.espn.com/apis/site/v2/sports/football/nfl';

export interface LiveBase {
  season: number;
  sheetId: string;
  rules: Rules;
  roster: RosterEntry[];
  transactions: TransactionRow[];
  doublers: DoublerRow[];
}

/** Minimal RFC 4180 CSV → records (quoted fields, doubled quotes, embedded commas/newlines). */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); rows.push(row); row = []; cur = '';
    } else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  if (!rows.length) return [];
  const hdr = rows[0].map(h => h.trim());
  return rows.slice(1).filter(r => r.some(x => x !== '')).map(r => Object.fromEntries(hdr.map((h, i) => [h, r[i] ?? ''])));
}

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Latest Doublers / Transactions / Rosters from the (link-viewable) sheet; falls back to the built copy per tab. */
async function freshSheet(base: LiveBase, notes: string[]): Promise<Pick<LiveBase, 'roster' | 'transactions' | 'doublers'>> {
  const tab = async (name: string) => {
    const url = `https://docs.google.com/spreadsheets/d/${base.sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(name)}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseCsv(await res.text());
  };
  const [d, t, r] = await Promise.allSettled([tab('Doublers'), tab('Transactions'), tab('Rosters')]);
  const out = { roster: base.roster, transactions: base.transactions, doublers: base.doublers };
  if (d.status === 'fulfilled') out.doublers = d.value.filter(x => x.fantasy_team && x.player).map(x => ({ season: Number(x.season) || 0, week: Number(x.week) || 0, fantasy_team: x.fantasy_team.trim(), player: x.player.trim() }));
  else notes.push('Doublers tab unreachable — using the copy from the last build');
  if (t.status === 'fulfilled') out.transactions = t.value.map(x => ({ Week: Number(x.Week) || 0, Team: x.Team, Kind: x.Kind, Action: x.Action, Player: x.Player, Position: x.Position }));
  else notes.push('Transactions tab unreachable — using the copy from the last build');
  if (r.status === 'fulfilled' && r.value.filter(x => x.player).length >= 200) {
    out.roster = r.value.filter(x => x.player).map(x => ({ round: Number(x.round) || '', pick: Number(x.pick) || '', fantasy_team: x.fantasy_team.trim(), player: x.player.trim(), nfl_team: normTeam(x.nfl_team), position: x.position.trim() }));
  }
  return out;
}

/** ESPN's current regular-season week, or null outside the regular season. */
export async function currentWeek(season: number): Promise<number | null> {
  const sb = await getJson(`${ESPN}/scoreboard`);
  return Number(sb?.season?.year) === season && Number(sb?.season?.type) === 2 ? Number(sb?.week?.number) || null : null;
}

// Parsed summaries of games that were already final — never refetched.
const finalCache = new Map<string, LiveParse>();

export interface LiveResult { week: WeekJson; games: EspnGame[]; anyInProgress: boolean; notes: string[] }

/**
 * Score `week` live. `previousTotals` = season totals before this week (from the official weeks).
 * Summaries are fetched only for games in progress or newly final.
 */
export async function computeLive(base: LiveBase, week: number, previousTotals: Record<string, number>): Promise<LiveResult> {
  const notes: string[] = [];
  const [sb, sheet] = await Promise.all([
    getJson(`${ESPN}/scoreboard?dates=${base.season}&seasontype=2&week=${week}&limit=50`),
    freshSheet(base, notes),
  ]);
  const games = parseScoreboard(sb);
  const match = rosterIndex(sheet.roster);
  const started = games.filter(g => g.started);
  const parsed = await Promise.all(started.map(async g => {
    const hit = finalCache.get(g.id);
    if (hit) return hit;
    try {
      const p = parseEspnSummary(await getJson(`${ESPN}/summary?event=${g.id}`), g, base.season, week, match);
      if (g.state === 'post') finalCache.set(g.id, p);
      return p;
    } catch (e) {
      notes.push(`ESPN box score for ${g.away} @ ${g.home} failed (${(e as Error).message}) — retrying next refresh`);
      return { stats: [], tds: [], notes: [] } as LiveParse;
    }
  }));
  const input: EngineInput = {
    season: base.season, seasonType: 'REG', rules: base.rules, ...sheet, stats: [], tds: [], games: [],
    live: { [week]: {
      stats: parsed.flatMap(p => p.stats), tds: parsed.flatMap(p => p.tds), games: liveGameResults(games, base.season, week),
      espnGames: games, fetchedAt: new Date().toISOString(), notes: [...notes, ...parsed.flatMap(p => p.notes)],
    } },
  };
  const w = runSeason(input, [week]).weeks[0];
  for (const t of Object.keys(w.weekTotals) as (keyof typeof w.weekTotals)[]) {
    w.previousTotals[t] = previousTotals[t] ?? 0;
    w.newTotals[t] = Math.round(((previousTotals[t] ?? 0) + w.weekTotals[t]) * 100) / 100;
  }
  return { week: weekJson(w), games, anyInProgress: games.some(g => g.state === 'in'), notes };
}
