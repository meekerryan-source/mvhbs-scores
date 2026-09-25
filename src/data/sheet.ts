// Read-only access to the "2026 Live Scores" Google Sheet. Never writes.
//
// Visible tabs are exported through /export?format=csv&gid=… (exact cell values). Hidden tabs
// (Scored_*, Rules_*, PBP_TDs, Team_Games) have no discoverable gid, so they come through the
// gviz CSV endpoint by name — fine for those tabs because every column is single-typed.
//
// Config is special: it holds the Discord webhook below row 5. We only ever request A1:B5.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const SHEET_ID = '1NRft1rdJwKsWohhKRBlXZ1ew8tUq82a-emxTy04yRzo';
export const SHEET_CACHE = '.cache/sheet';

export const VISIBLE_TABS = ['Week_1', 'Week_2', 'Week_3', 'Standings', 'Points Log', 'Rosters', 'Doublers', 'Transactions'];
export const HIDDEN_TABS = ['Rules_Thresholds', 'Rules_Linear', 'Scored_Player_Game', 'Scored_DST_Game', 'Team_Games', 'PBP_TDs', 'Audit'];

export function cachePath(tab: string): string {
  return join(SHEET_CACHE, tab.replace(/\s+/g, '_') + '.csv');
}

async function get(url: string, expectCsv = true): Promise<string> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.replace(/[?].*/, '')}`);
  const text = await res.text();
  if (expectCsv && /^\s*<!DOCTYPE html|<html/i.test(text)) throw new Error(`Got an HTML page instead of CSV (is the sheet still link-viewable?) — ${url.replace(/[?].*/, '')}`);
  return text;
}

/** Tab name → gid, scraped from the public htmlview page (visible tabs only). */
export async function discoverGids(): Promise<Record<string, string>> {
  const html = await get(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/htmlview`, false);
  const out: Record<string, string> = {};
  for (const m of html.matchAll(/items\.push\(\{name: "([^"]+)",[^}]*?gid: "(\d+)"/g)) out[m[1]] = m[2];
  return out;
}

function gvizUrl(tab: string, range?: string): string {
  const q = new URLSearchParams({ tqx: 'out:csv', sheet: tab });
  if (range) q.set('range', range);
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?${q}`;
}

export async function fetchSheetTabs(log: (s: string) => void = console.log): Promise<void> {
  mkdirSync(SHEET_CACHE, { recursive: true });
  const gids = await discoverGids();
  const weekTabs = Object.keys(gids).filter(n => /^Week_\d+$/.test(n));
  const visible = [...new Set([...weekTabs, ...VISIBLE_TABS.filter(t => !/^Week_/.test(t))])];
  for (const tab of visible) {
    const gid = gids[tab];
    const url = gid != null
      ? `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`
      : gvizUrl(tab);
    const text = await get(url);
    writeFileSync(cachePath(tab), text);
    log(`  sheet ${tab.padEnd(20)} ${text.length.toLocaleString().padStart(9)} bytes${gid == null ? ' (gviz)' : ''}`);
  }
  for (const tab of HIDDEN_TABS) {
    const text = await get(gvizUrl(tab));
    writeFileSync(cachePath(tab), text);
    log(`  sheet ${tab.padEnd(20)} ${text.length.toLocaleString().padStart(9)} bytes (gviz)`);
  }
  // Config: season / test_week / season_type / source / live_week ONLY (rows 1–5). The Discord
  // webhook lives further down and is never requested. (gviz drops mixed-type cells, so use export.)
  const cfg = await get(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gids.Config ?? '0'}&range=A1:B5`);
  if (/discord|https?:\/\//i.test(cfg)) throw new Error('Config range unexpectedly contains a URL — refusing to cache it.');
  writeFileSync(cachePath('Config_A1_B5'), cfg);
  log(`  sheet Config!A1:B5 (webhook rows deliberately not fetched)`);
}

export function readCachedTab(tab: string): string {
  const p = cachePath(tab);
  if (!existsSync(p)) throw new Error(`Missing ${p} — run \`npm run fetch\` first.`);
  return readFileSync(p, 'utf8');
}

export function hasCachedTab(tab: string): boolean {
  return existsSync(cachePath(tab));
}
