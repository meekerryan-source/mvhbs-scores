import type { DoublerRow, RosterEntry, Rules, TransactionRow } from '../engine/types.js';
import type { EngineInput } from '../engine/season.js';
import { normTeam } from '../engine/normalize.js';
import { parseLinearRules, parseThresholdRules, RULES_SNAPSHOT } from '../engine/rules.js';
import { parseCsvRecords, parseCsvRows, splitCsvLine } from './csv.js';
import { hasCachedTab, readCachedTab } from './sheet.js';
import { loadSchedule, loadStats, loadTdRows } from './nflverse.js';

export interface SheetConfig { season: number; season_type: string; live_week: number; test_week?: number }

/** Config!A1:B5 (key/value). The webhook row is never fetched. */
export function loadConfig(): SheetConfig {
  const cfg: Record<string, string> = {};
  if (hasCachedTab('Config_A1_B5')) {
    for (const r of parseCsvRows(readCachedTab('Config_A1_B5'))) if (r[0]) cfg[r[0].trim()] = (r[1] ?? '').trim();
  }
  return {
    season: Number(cfg.season) || 2026,
    season_type: cfg.season_type || 'REG',
    live_week: Number(cfg.live_week) || 0,
    test_week: Number(cfg.test_week) || undefined,
  };
}

export function loadRoster(): RosterEntry[] {
  return parseCsvRecords(readCachedTab('Rosters'))
    .filter(r => r.player)
    .map(r => ({
      round: Number(r.round) || '', pick: Number(r.pick) || '', fantasy_team: r.fantasy_team.trim(),
      player: r.player.trim(), nfl_team: normTeam(r.nfl_team), position: r.position.trim(),
    }));
}

export function loadTransactions(): TransactionRow[] {
  return parseCsvRecords(readCachedTab('Transactions')).map(r => ({
    Week: Number(r.Week) || 0, Team: r.Team, Kind: r.Kind, Action: r.Action, Player: r.Player, Position: r.Position,
  }));
}

export function loadDoublers(): DoublerRow[] {
  return parseCsvRecords(readCachedTab('Doublers'))
    .filter(r => r.fantasy_team && r.player)
    .map(r => ({ season: Number(r.season) || 0, week: Number(r.week) || 0, fantasy_team: r.fantasy_team.trim(), player: r.player.trim() }));
}

/** Live rules from the sheet's Rules_* tabs, or the checked-in snapshot when not cached. */
export function loadLiveRules(): Rules | null {
  if (!hasCachedTab('Rules_Thresholds') || !hasCachedTab('Rules_Linear')) return null;
  return {
    threshold: parseThresholdRules(parseCsvRecords(readCachedTab('Rules_Thresholds'))),
    linear: parseLinearRules(parseCsvRows(readCachedTab('Rules_Linear')), splitCsvLine),
  };
}

export async function loadEngineInput(season?: number): Promise<{ input: EngineInput; config: SheetConfig; rulesSource: 'live' | 'snapshot' }> {
  const config = loadConfig();
  const s = season ?? config.season;
  const live = loadLiveRules();
  const schedule = loadSchedule(s);
  const input: EngineInput = {
    season: s,
    seasonType: config.season_type,
    rules: live ?? RULES_SNAPSHOT,
    roster: loadRoster(),
    transactions: loadTransactions(),
    doublers: loadDoublers(),
    stats: loadStats(s),
    tds: await loadTdRows(s),
    games: schedule.filter(g => g.played).map(g => g.game),
    schedule: schedule.map(({ season, week, game_id, played }) => ({ season, week, game_id, played })),
  };
  return { input, config, rulesSource: live ? 'live' : 'snapshot' };
}
