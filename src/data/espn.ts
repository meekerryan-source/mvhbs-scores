// ESPN live data (provisional in-game scoring). Official numbers still come from nflverse.
// site.web.api.espn.com — the site.api.espn.com host 403s scripted clients.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RosterEntry } from '../engine/types.js';
import { liveGameResults, parseEspnSummary, parseScoreboard, rosterIndex, type EspnGame } from '../engine/espn.js';
import type { LiveWeekData } from '../engine/season.js';

const BASE = 'https://site.web.api.espn.com/apis/site/v2/sports/football/nfl';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://www.espn.com/',
};
export const ESPN_CACHE = '.cache/espn';

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`ESPN HTTP ${res.status} for ${url}`);
  return res.json();
}

/** The current regular-season week per ESPN's default scoreboard, or null outside the regular season. */
export async function detectCurrentWeek(season: number): Promise<number | null> {
  const sb = await getJson(`${BASE}/scoreboard`);
  return Number(sb?.season?.year) === season && Number(sb?.season?.type) === 2 ? Number(sb?.week?.number) || null : null;
}

/** Scoreboard + a summary for every started game → parsed live data for the week (raw JSON cached for debugging). */
export async function fetchLiveWeek(season: number, week: number, roster: RosterEntry[]): Promise<LiveWeekData> {
  const dir = join(ESPN_CACHE, `${season}-w${week}`);
  mkdirSync(dir, { recursive: true });
  const sb = await getJson(`${BASE}/scoreboard?dates=${season}&seasontype=2&week=${week}&limit=50`);
  writeFileSync(join(dir, 'scoreboard.json'), JSON.stringify(sb));
  const espnGames: EspnGame[] = parseScoreboard(sb);
  const match = rosterIndex(roster);
  const out: LiveWeekData = { stats: [], tds: [], games: liveGameResults(espnGames, season, week), espnGames, fetchedAt: new Date().toISOString(), notes: [] };
  const started = espnGames.filter(g => g.started);
  const summaries = await Promise.allSettled(started.map(g => getJson(`${BASE}/summary?event=${g.id}`)));
  summaries.forEach((r, i) => {
    const g = started[i];
    if (r.status === 'rejected') { out.notes.push(`summary ${g.away}@${g.home}: ${r.reason}`); return; }
    writeFileSync(join(dir, `summary-${g.id}.json`), JSON.stringify(r.value));
    const p = parseEspnSummary(r.value, g, season, week, match);
    out.stats.push(...p.stats);
    out.tds.push(...p.tds);
    out.notes.push(...p.notes);
  });
  return out;
}
