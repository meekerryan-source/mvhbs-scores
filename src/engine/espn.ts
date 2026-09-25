// ESPN live parsing — a port of LiveScoring.gs parseGame_ / resolveAthlete_ / rosterMatch_ / inferPos_.
// Pure: ESPN JSON in, PlayerWeekStats + TdRows out. Live numbers are provisional; nflverse is official.

import type { GameResult, PlayerWeekStats, RosterEntry, TdRow } from './types.js';
import { normName, normTeam } from './normalize.js';

const ESPN_TO_NFLVERSE: Record<string, string> = { WSH: 'WAS', LAR: 'LA', JAC: 'JAX' };
export const espnTeam = (ab: unknown) => {
  const s = String(ab ?? '').toUpperCase();
  return normTeam(ESPN_TO_NFLVERSE[s] ?? s);
};
const num = (v: unknown) => {
  if (v === '' || v == null) return 0;
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
};
const SUFFIX = /\s+(Jr|Sr|II|III|IV|V)\.?$/i;

export interface EspnGame {
  id: string;
  home: string;
  away: string;
  hs: number;
  as: number;
  state: 'pre' | 'in' | 'post' | string;
  detail: string;
  started: boolean;
}

/** Scoreboard JSON → games with current scores and state. */
export function parseScoreboard(sb: any): EspnGame[] {
  const out: EspnGame[] = [];
  for (const ev of sb?.events ?? []) {
    const comp = ev.competitions?.[0];
    if (!comp) continue;
    const home = comp.competitors?.find((c: any) => c.homeAway === 'home');
    const away = comp.competitors?.find((c: any) => c.homeAway === 'away');
    if (!home || !away) continue;
    const st = comp.status?.type ?? ev.status?.type ?? {};
    const state = st.state ?? '';
    out.push({
      id: String(ev.id), home: espnTeam(home.team?.abbreviation), away: espnTeam(away.team?.abbreviation),
      hs: num(home.score), as: num(away.score), state, detail: st.shortDetail ?? st.detail ?? '', started: state !== 'pre' && state !== '',
    });
  }
  return out;
}

/** Started games → GameResult rows at their CURRENT score (so live D/ST win/MOV/shutout move with the game). */
export function liveGameResults(games: EspnGame[], season: number, week: number): GameResult[] {
  return games.filter(g => g.started).map(g => ({ season, week, game_id: g.id, home_team: g.home, away_team: g.away, home_score: g.hs, away_score: g.as }));
}

interface Acc {
  player_id: string; name: string; team: string; opp: string; cats: Record<string, boolean>;
  passing_yards: number; passing_tds: number; passing_interceptions: number; passing_2pt: number;
  rushing_yards: number; rushing_tds: number; rushing_2pt: number; rush_att: number;
  receptions: number; receiving_yards: number; receiving_tds: number; receiving_2pt: number;
  st_tds: number; fg_made: number; fg_att: number; fg_made_list: number[]; fg_missed_list: number[]; fgFromPlays: boolean;
  pat_made: number; pat_missed: number; def_sacks: number; def_interceptions: number; def_tds: number;
}

/** Roster lookups used to give ESPN athletes the roster spelling + position (so the grid's name|team key hits). */
export function rosterIndex(roster: RosterEntry[]) {
  const exact = new Map<string, { name: string; pos: string }>();
  const byName = new Map<string, { name: string; pos: string }>();
  const byLast = new Map<string, { name: string; pos: string }[]>();
  for (const r of roster) {
    if (String(r.position).toUpperCase() === 'DST') continue;
    const rec = { name: r.player, pos: String(r.position || '').toUpperCase() };
    const nm = normName(r.player);
    const tm = normTeam(r.nfl_team);
    exact.set(`${nm}|${tm}`, rec);
    if (!byName.has(nm)) byName.set(nm, rec);
    const parts = r.player.replace(SUFFIX, '').trim().split(/\s+/);
    const lk = `${normName(parts[parts.length - 1])}|${tm}`;
    if (!byLast.has(lk)) byLast.set(lk, []);
    byLast.get(lk)!.push(rec);
  }
  return (name: string, team: string) => {
    const nm = normName(name);
    const hit = exact.get(`${nm}|${team}`) ?? byName.get(nm);
    if (hit) return hit;
    const parts = name.replace(SUFFIX, '').trim().split(/\s+/);
    const c = byLast.get(`${normName(parts[parts.length - 1])}|${team}`);
    // Unique same-team last name whose first name is a prefix of the other (Cam/Camryn Bynum, Foye/Foyesade
    // Oluokun). The sheet only compares first initials, which maps ATL's Brian Robinson Jr. onto Bijan Robinson.
    if (c && c.length === 1) {
      const f1 = normName(c[0].name.split(/\s+/)[0]);
      const f2 = normName(parts[0]);
      if (f1 && f2 && (f1.startsWith(f2) || f2.startsWith(f1))) return c[0];
    }
    return null;
  };
}

/**
 * "J.Williams" / "Bi.Robinson" / "Javonte Williams" / "CeeDee Lamb" → the athlete on that team.
 * ESPN play text uses one- or two-letter initials; ties prefer an athlete with a line in `prefCat`.
 */
function resolveAthlete(token: string | undefined, onTeam: { id: string; name: string }[], players: Record<string, Acc>, prefCat?: string): Acc | null {
  if (!token) return null;
  const t = String(token).trim().replace(SUFFIX, '');
  const full = normName(t);
  let cands = onTeam.filter(a => normName(a.name) === full);
  if (!cands.length) {
    let initials: string;
    let last: string;
    const m = t.match(/^([A-Z][a-z]?)\.\s*(.+)$/);
    if (m) { initials = m[1].toLowerCase(); last = normName(m[2]); }
    else { const parts = t.split(/\s+/); initials = parts[0].charAt(0).toLowerCase(); last = normName(parts.slice(1).join(' ')); }
    cands = onTeam.filter(a => {
      const parts = a.name.replace(SUFFIX, '').split(/\s+/);
      return parts[0].toLowerCase().startsWith(initials) && normName(parts.slice(1).join(' ')) === last;
    });
  }
  if (!cands.length) return null;
  if (cands.length > 1 && prefCat) {
    const pref = cands.filter(a => players[a.id]?.cats[prefCat]);
    if (pref.length) cands = pref;
  }
  return players[cands[0].id];
}

export interface LiveParse { stats: PlayerWeekStats[]; tds: TdRow[]; notes: string[] }

/** One ESPN game summary → stat lines + TD rows, like the sheet's live parser. */
export function parseEspnSummary(js: any, g: EspnGame, season: number, week: number, rosterMatch: ReturnType<typeof rosterIndex>): LiveParse {
  const players: Record<string, Acc> = {};
  const byTeam: Record<string, { id: string; name: string }[]> = { [g.home]: [], [g.away]: [] };
  const tds: TdRow[] = [];
  const notes: string[] = [];
  const td = (td_type: TdRow['td_type'], scorer: Acc | null, team: string, yards: number) =>
    tds.push({ season, week, season_type: 'REG', game_id: g.id, td_type, scorer_id: scorer ? scorer.player_id : '', team, yards_gained: yards });

  const get = (id: string, name: string, team: string): Acc => {
    if (!players[id]) {
      players[id] = {
        player_id: id, name, team, opp: team === g.home ? g.away : g.home, cats: {},
        passing_yards: 0, passing_tds: 0, passing_interceptions: 0, passing_2pt: 0, rushing_yards: 0, rushing_tds: 0, rushing_2pt: 0, rush_att: 0,
        receptions: 0, receiving_yards: 0, receiving_tds: 0, receiving_2pt: 0, st_tds: 0, fg_made: 0, fg_att: 0,
        fg_made_list: [], fg_missed_list: [], fgFromPlays: false, pat_made: 0, pat_missed: 0, def_sacks: 0, def_interceptions: 0, def_tds: 0,
      };
      (byTeam[team] ??= []).push({ id, name });
    }
    return players[id];
  };

  // --- Box score ---
  for (const tp of js?.boxscore?.players ?? []) {
    const team = espnTeam(tp.team?.abbreviation);
    for (const cat of tp.statistics ?? []) {
      const L: Record<string, number> = {};
      (cat.labels ?? cat.keys ?? []).forEach((l: string, i: number) => { L[String(l).toUpperCase()] = i; });
      for (const a of cat.athletes ?? []) {
        const ath = a.athlete ?? {};
        if (!ath.id) continue;
        const p = get(String(ath.id), ath.displayName || `${ath.firstName} ${ath.lastName}`, team);
        const s = a.stats ?? [];
        const v = (lab: string) => (lab in L ? s[L[lab]] : undefined);
        p.cats[cat.name] = true;
        switch (cat.name) {
          case 'passing': p.passing_yards += num(v('YDS')); p.passing_tds += num(v('TD')); p.passing_interceptions += num(v('INT')); break;
          case 'rushing': p.rush_att += num(v('CAR')); p.rushing_yards += num(v('YDS')); p.rushing_tds += num(v('TD')); break;
          case 'receiving': p.receptions += num(v('REC')); p.receiving_yards += num(v('YDS')); p.receiving_tds += num(v('TD')); break;
          case 'defensive': p.def_sacks += num(v('SACKS')); p.def_tds = Math.max(p.def_tds, num(v('TD'))); break;
          case 'interceptions': p.def_interceptions += num(v('INT')); p.def_tds = Math.max(p.def_tds, num(v('TD'))); break;
          case 'kickReturns': case 'puntReturns': p.st_tds += num(v('TD')); break;
          case 'kicking': {
            const fg = String(v('FG') ?? '0/0').split('/');
            const xp = String(v('XP') ?? '0/0').split('/');
            p.fg_made += num(fg[0]); p.fg_att += num(fg[1]);
            p.pat_made += num(xp[0]); p.pat_missed += Math.max(0, num(xp[1]) - num(xp[0]));
            break;
          }
        }
      }
    }
  }

  const resolve = (token: string | undefined, team: string, pref?: string) => resolveAthlete(token, byTeam[team] ?? [], players, pref);
  // A 2-pt scorer may have no box-score line (e.g. a TE with 0 catches): create him so the +2 isn't lost.
  const resolveOrCreate = (token: string | undefined, team: string, pref?: string) =>
    resolve(token, team, pref) ?? (token && !/^[A-Z][a-z]?\./.test(token.trim()) ? get(`syn_${normName(token)}_${team}`, token.trim(), team) : null);
  const other = (t: string) => (t === g.home ? g.away : g.home);
  const firstInt = (m: RegExpMatchArray | null) => (m ? num(m[1]) : 0);

  // --- scoringPlays (full names, scoring team given) ---
  const sp = js?.scoringPlays ?? [];
  for (const x of sp) {
    const type = String(x.type?.text ?? '');
    const text = String(x.text ?? '');
    const team = espnTeam(x.team?.abbreviation);
    if (!team) continue;
    const yd = firstInt(text.match(/(\d+)\s*Yd/i));
    if (/Field Goal/i.test(type)) {
      const m = text.match(/^(.*?)\s+(\d+)\s*Yd/i);
      const k = m && resolve(m[1], team, 'kicking');
      if (k && m) { k.fg_made_list.push(num(m[2])); k.fgFromPlays = true; }
      continue;
    }
    if (!/Touchdown/i.test(type)) continue;
    if (/Passing/i.test(type)) {
      const m = text.match(/^(.*?)\s+\d+\s*Yd\s+pass\s+from\s+(.*?)(\s*\(|$)/i);
      td('pass', m ? resolve(m[2], team, 'passing') : null, team, yd);
      td('rec', m ? resolve(m[1], team, 'receiving') : null, team, yd);
    } else if (/Rushing/i.test(type)) {
      const m = text.match(/^(.*?)\s+\d+\s*Yd/i);
      td('rush', m ? resolve(m[1], team, 'rushing') : null, team, yd);
    } else if (/Interception/i.test(type)) td('picksix', null, team, yd);
    else if (/Fumble/i.test(type)) td('fumreturn', null, team, yd);
    else if (/Kickoff|Punt|Blocked/i.test(type)) {
      const m = text.match(/^(.*?)\s+\d+\s*Yd/i);
      td('st', m ? resolve(m[1], team, 'kickReturns') : null, team, yd);
    }
    const c2 = text.match(/\(([^)]*Two-Point[^)]*)\)/i);
    if (c2 && !/Failed|No Good/i.test(c2[1])) {
      const mp = c2[1].match(/^(.*?)\s+Pass\s+to\s+(.*?)\s+for/i);
      const mr = c2[1].match(/^(.*?)\s+Run\s+for/i);
      if (mp) { const q = resolveOrCreate(mp[1], team, 'passing'); const r = resolveOrCreate(mp[2], team, 'receiving'); if (q) q.passing_2pt++; if (r) r.receiving_2pt++; }
      else if (mr) { const r = resolveOrCreate(mr[1], team, 'rushing'); if (r) r.rushing_2pt++; }
    }
  }

  // --- Drive plays: always used for FG misses; TDs / 2-pt only when scoringPlays is absent ---
  const drives = js?.drives ?? {};
  const driveList = [...(drives.previous ?? []), ...(drives.current ? [drives.current] : [])];
  for (const d of driveList) {
    const offense = espnTeam(d.team?.abbreviation);
    for (const pl of d.plays ?? []) {
      const type = String(pl.type?.text ?? '');
      const text = String(pl.text ?? '');
      const fgm = text.match(/([A-Z][a-z]?\.[A-Za-z'\-.]+(?:\s[A-Za-z'\-.]+)?)\s+(\d+)\s+yard field goal is\s+(GOOD|No Good|BLOCKED)/i);
      if (fgm) {
        const k = resolve(fgm[1], offense, 'kicking');
        if (k) {
          if (/GOOD/i.test(fgm[3]) && !/No Good/i.test(fgm[3])) { if (!k.fgFromPlays) k.fg_made_list.push(num(fgm[2])); }
          else if (!/BLOCKED/i.test(fgm[3])) k.fg_missed_list.push(num(fgm[2])); // blocked ≠ missed (nflverse fg_blocked)
        }
        continue;
      }
      if (sp.length || !pl.scoringPlay || !/Touchdown/i.test(type)) continue;
      const before = text.split(/TOUCHDOWN/i)[0];
      const ym = before.match(/for\s+(-?\d+)\s+yards?\.?\s*,?\s*$/i) || before.match(/for\s+(-?\d+)\s+yards?[^0-9]*$/i);
      const yd = ym ? num(ym[1]) : 0;
      if (/Passing/i.test(type)) {
        const m = before.match(/([A-Z][a-z]?\.[^\s]+)\s+pass.*?\bto\s+([A-Z][a-z]?\.[^\s,]+)/i);
        td('pass', m ? resolve(m[1], offense, 'passing') : null, offense, yd);
        td('rec', m ? resolve(m[2], offense, 'receiving') : null, offense, yd);
      } else if (/Rushing/i.test(type)) {
        const m = before.match(/([A-Z][a-z]?\.[^\s]+)\s+(?:left|right|up|middle|rushes|scrambles)/i) ?? before.match(/^([A-Z][a-z]?\.[^\s]+)/);
        td('rush', m ? resolve(m[1], offense, 'rushing') : null, offense, yd);
      } else if (/Interception/i.test(type)) td('picksix', null, other(offense), yd);
      else if (/Fumble/i.test(type)) td('fumreturn', null, other(offense), yd);
      else if (/Kickoff|Punt|Blocked/i.test(type)) {
        const m = before.match(/([A-Z][a-z]?\.[^\s]+)\s+for\s+-?\d+\s+yards?[^A-Z]*$/i);
        td('st', m ? resolve(m[1], other(offense), 'kickReturns') : null, other(offense), yd);
      }
      if (/TWO-POINT CONVERSION ATTEMPT/i.test(text) && /ATTEMPT SUCCEEDS/i.test(text)) {
        const seg = text.split(/TWO-POINT CONVERSION ATTEMPT\./i)[1] ?? '';
        const mp = seg.match(/([A-Z][a-z]?\.[^\s]+)\s+pass.*?\bto\s+([A-Z][a-z]?\.[^\s,.]+)/i);
        const mr = seg.match(/([A-Z][a-z]?\.[^\s]+)\s+(?:rushes|up the middle|left|right)/i);
        if (mp) { const q = resolve(mp[1], offense, 'passing'); const r = resolve(mp[2], offense, 'receiving'); if (q) q.passing_2pt++; if (r) r.receiving_2pt++; }
        else if (mr) { const r = resolve(mr[1], offense, 'rushing'); if (r) r.rushing_2pt++; }
      }
    }
  }

  // --- Emit stat lines. Position: roster when drafted, else inferred from box-score categories. ---
  const stats: PlayerWeekStats[] = Object.values(players).map(p => {
    const rm = rosterMatch(p.name, p.team);
    let pos: string;
    if (rm) { p.name = rm.name; pos = rm.pos; }
    else if (p.cats.kicking) pos = 'K';
    else if (p.cats.passing && p.passing_yards + p.passing_tds > 0) pos = 'QB';
    else if (p.rushing_yards + p.receiving_yards + p.rushing_tds + p.receiving_tds + p.receptions + p.rush_att > 0 || p.cats.rushing || p.cats.receiving) pos = p.rush_att >= p.receptions ? 'RB' : 'WR';
    else if (p.cats.defensive || p.cats.interceptions) pos = 'DB';
    else pos = 'WR';
    while (p.fg_made_list.length < p.fg_made) { p.fg_made_list.push(35); notes.push(`FG distance assumed 35 for ${p.name}`); }
    return {
      season, week, season_type: 'REG', game_id: g.id, player_id: p.player_id, player_display_name: p.name,
      position: pos, position_group: pos === 'K' ? 'SPEC' : pos, team: p.team, opponent_team: p.opp,
      passing_yards: p.passing_yards, passing_tds: p.passing_tds, passing_interceptions: p.passing_interceptions, passing_2pt_conversions: p.passing_2pt,
      rushing_yards: p.rushing_yards, rushing_tds: p.rushing_tds, rushing_2pt_conversions: p.rushing_2pt,
      receptions: p.receptions, receiving_yards: p.receiving_yards, receiving_tds: p.receiving_tds, receiving_2pt_conversions: p.receiving_2pt,
      special_teams_tds: p.st_tds, fg_made: p.fg_made, fg_att: p.fg_att, fg_made_list: p.fg_made_list.join(';'), fg_missed_list: p.fg_missed_list.join(';'),
      pat_made: p.pat_made, pat_att: p.pat_made + p.pat_missed, pat_missed: p.pat_missed,
      def_sacks: p.def_sacks, def_interceptions: p.def_interceptions, def_tds: p.def_tds, fumble_recovery_opp: 0, fumble_recovery_tds: 0,
    };
  });
  return { stats, tds, notes };
}
