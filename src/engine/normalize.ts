import type { Bucket, DisplayTeam } from './types.js';

// ---------------------------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------------------------

/** Roster `fantasy_team` → display name used in Week_N / Standings / Transactions / Points Log. */
export const TEAM_DISPLAY: Record<string, DisplayTeam> = {
  KGSC: 'Jannai',
  'Banana Slugs': 'Meeker',
  'Two Allens, One Cup': 'Allens',
  'Good Picks From Ben': 'Koo',
  'Yellow Legal Pad': 'Guzman',
  // legacy 2025 names (kept so old rows still resolve)
  'Ben Koo We Adopted You': 'Koo',
  "JO's ICE DREAM": 'Guzman',
  Woo: 'Woo',
  Hotish: 'Hottish',
  AZN: 'AZN',
};

/** Display name → roster key. Accepts both `Hotish` and `Hottish`. */
export const DISPLAY_TO_ROSTER: Record<string, string> = {
  Jannai: 'KGSC',
  Meeker: 'Banana Slugs',
  Allens: 'Two Allens, One Cup',
  Koo: 'Good Picks From Ben',
  Guzman: 'Yellow Legal Pad',
  Woo: 'Woo',
  Hottish: 'Hotish',
  Hotish: 'Hotish',
  AZN: 'AZN',
};

export const TEAM_ORDER: DisplayTeam[] = ['Jannai', 'Meeker', 'Allens', 'Koo', 'Guzman', 'Woo', 'Hottish', 'AZN'];

/** Roster team codes (old style) → nflverse codes. Everything else passes through upper-cased. */
const TEAM_ALIASES: Record<string, string> = {
  LVR: 'LV', NEP: 'NE', GBP: 'GB', KCC: 'KC', LAR: 'LA', NOS: 'NO', SFO: 'SF', TBB: 'TB', JAC: 'JAX',
};

export function normTeam(t: unknown): string {
  if (t == null || t === '') return '';
  const s = String(t).trim().toUpperCase();
  return TEAM_ALIASES[s] ?? s;
}

/** D/ST roster entries are full team names; map them to nflverse codes. */
export const DST_TEAM_TO_CODE: Record<string, string> = {
  'Arizona Cardinals': 'ARI', 'Atlanta Falcons': 'ATL', 'Baltimore Ravens': 'BAL', 'Buffalo Bills': 'BUF',
  'Carolina Panthers': 'CAR', 'Chicago Bears': 'CHI', 'Cincinnati Bengals': 'CIN', 'Cleveland Browns': 'CLE',
  'Dallas Cowboys': 'DAL', 'Denver Broncos': 'DEN', 'Detroit Lions': 'DET', 'Green Bay Packers': 'GB',
  'Houston Texans': 'HOU', 'Indianapolis Colts': 'IND', 'Jacksonville Jaguars': 'JAX', 'Kansas City Chiefs': 'KC',
  'Las Vegas Raiders': 'LV', 'Los Angeles Chargers': 'LAC', 'Los Angeles Rams': 'LA', 'Miami Dolphins': 'MIA',
  'Minnesota Vikings': 'MIN', 'New England Patriots': 'NE', 'New Orleans Saints': 'NO', 'New York Giants': 'NYG',
  'New York Jets': 'NYJ', 'Philadelphia Eagles': 'PHI', 'Pittsburgh Steelers': 'PIT', 'San Francisco 49ers': 'SF',
  'Seattle Seahawks': 'SEA', 'Tampa Bay Buccaneers': 'TB', 'Tennessee Titans': 'TEN', 'Washington Commanders': 'WAS',
};

// ---------------------------------------------------------------------------------------------
// Positions
// ---------------------------------------------------------------------------------------------

export const IDP_POS = ['DL', 'LB', 'DB', 'DE', 'DT', 'CB', 'S', 'FS', 'SS', 'OLB', 'MLB', 'ILB'];

/** Roster `position` → lineup bucket; null for anything unrecognised (never slotted). */
export function posBucket(rosterPos: unknown): Bucket | null {
  const p = String(rosterPos ?? '').trim().toUpperCase();
  if (p === 'QB' || p === 'RB' || p === 'WR' || p === 'TE' || p === 'K') return p;
  if (p === 'DST' || p === 'D/ST' || p === 'DEF') return 'DST';
  if (IDP_POS.includes(p)) return 'IDP';
  return null;
}

// ---------------------------------------------------------------------------------------------
// Player names
// ---------------------------------------------------------------------------------------------

/**
 * Canonical player-name key. Applied on BOTH sides of every lookup (roster ↔ stats, doublers ↔
 * roster, transactions ↔ roster, Points Log ↔ grid). Strips one trailing Jr/Sr/II/III/IV/V suffix
 * and every non-alphanumeric character.
 */
export function normName(s: unknown): string {
  let n = String(s ?? '').trim();
  n = n.replace(/[.,]/g, ' ');
  n = n.replace(/\s+\b(jr|sr|ii|iii|iv|v)\b\s*$/i, '');
  return n.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Tolerant short-name matcher ("D. Robinson" ↔ "Demarcus Robinson", "Rivers" ↔ "Philip Rivers").
 * Returns the matching candidate, or null unless the match is unique.
 */
export function matchShortName(shortName: string, candidates: string[]): string | null {
  const s = String(shortName ?? '').trim();
  if (!s || !candidates.length) return null;
  const sNorm = normName(s);

  for (const c of candidates) if (normName(c) === sNorm) return c;

  const mI = s.match(/^([A-Za-z])\.?\s+(.+)$/);
  if (mI) {
    const ini = mI[1].toLowerCase();
    const lastNorm = normName(mI[2]);
    const hits = candidates.filter(c => {
      const parts = String(c).trim().split(/\s+/);
      if (parts.length < 2) return false;
      return parts[0].charAt(0).toLowerCase() === ini && normName(parts.slice(1).join(' ')) === lastNorm;
    });
    if (hits.length === 1) return hits[0];
  }

  if (!/\s/.test(s)) {
    const hits = candidates.filter(c => {
      const parts = String(c).trim().split(/\s+/);
      return parts.length >= 2 && normName(parts.slice(1).join(' ')) === sNorm;
    });
    if (hits.length === 1) return hits[0];
  }
  return null;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
