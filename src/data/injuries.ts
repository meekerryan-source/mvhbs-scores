// Official NFL Injured Reserve list from ESPN's league-wide injuries feed (~9 MB, so it's fetched at
// build time — the daily GitHub build — and only the IR entries ship with the site). Same source and
// same rule as the sheet's IR tab: only status "Injured Reserve" counts; Out / Doubtful /
// Questionable don't qualify for an IR swap and aren't flagged.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { DST_TEAM_TO_CODE, normTeam } from '../engine/normalize.js';
import { espnTeam } from '../engine/espn.js';

const URL = 'https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/injuries';
export const IR_CACHE = '.cache/espn/ir.json';

export interface IrEntry { name: string; team: string; pos: string; date: string; note: string }
export interface IrList { fetchedAt: string; players: IrEntry[] }

export function parseIr(js: any): IrEntry[] {
  const out: IrEntry[] = [];
  for (const t of js?.injuries ?? []) {
    for (const i of t.injuries ?? []) {
      if (String(i.status ?? '') !== 'Injured Reserve') continue;
      const a = i.athlete ?? {};
      if (!a.displayName) continue;
      const team = a.team?.abbreviation ? espnTeam(a.team.abbreviation) : normTeam(DST_TEAM_TO_CODE[t.displayName] ?? '');
      out.push({
        name: a.displayName, team, pos: a.position?.abbreviation ?? '', date: String(i.date ?? '').slice(0, 10),
        note: String(i.shortComment || i.longComment || i.type?.description || '').trim(),
      });
    }
  }
  return out;
}

export async function fetchIr(): Promise<IrList> {
  const res = await fetch(URL, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
  if (!res.ok) throw new Error(`ESPN injuries HTTP ${res.status}`);
  const list: IrList = { fetchedAt: new Date().toISOString(), players: parseIr(await res.json()) };
  mkdirSync('.cache/espn', { recursive: true });
  writeFileSync(IR_CACHE, JSON.stringify(list));
  return list;
}

export function loadIr(): IrList | null {
  return existsSync(IR_CACHE) ? (JSON.parse(readFileSync(IR_CACHE, 'utf8')) as IrList) : null;
}
