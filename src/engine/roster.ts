import type { AuditEntry, RosterEntry, Transaction, TransactionRow } from './types.js';
import { DISPLAY_TO_ROSTER, matchShortName, normTeam } from './normalize.js';

/**
 * Transactions tab rows (one row per ADD or DROP) → paired transactions, as the sheet's
 * readTransactions_ does: group by (Week, Team, Kind); pair DROP↔ADD with the same position first,
 * then zip the rest in order; leftovers become half-transactions (pure drop / pure add).
 * Team is the display name and is translated to the roster key.
 */
export function pairTransactions(rows: TransactionRow[], audit: AuditEntry[] = []): Transaction[] {
  type G = { week: number; fantasy_team: string; type: string; adds: { player: string; position: string }[]; drops: { player: string; position: string }[] };
  const groups = new Map<string, G>();
  for (const r of rows) {
    const wk = Number(r.Week) || 0;
    const teamRaw = String(r.Team ?? '').trim();
    const kind = String(r.Kind ?? '').toUpperCase().trim();
    const action = String(r.Action ?? '').toUpperCase().trim();
    const player = String(r.Player ?? '').trim();
    const position = String(r.Position ?? '').toUpperCase().trim();
    if (!wk || !teamRaw || !action || !player) continue;
    const team = DISPLAY_TO_ROSTER[teamRaw] ?? teamRaw;
    const type = kind === 'IR_SWAP' ? 'IR' : kind || 'ADD_DROP';
    const key = `${wk}|${team}|${type}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { week: wk, fantasy_team: team, type, adds: [], drops: [] }));
    if (action === 'ADD') g.adds.push({ player, position });
    else if (action === 'DROP') g.drops.push({ player, position });
  }

  const mk = (g: G, add: { player: string; position: string } | null, drop: { player: string; position: string } | null): Transaction => ({
    week: g.week,
    fantasy_team: g.fantasy_team,
    type: g.type,
    player_out: drop ? drop.player : '',
    player_in: add ? add.player : '',
    nfl_team_in: '',
    position_in: add?.position || drop?.position || '',
  });

  const out: Transaction[] = [];
  for (const g of groups.values()) {
    const usedA = g.adds.map(() => false);
    const usedD = g.drops.map(() => false);
    for (let di = 0; di < g.drops.length; di++) {
      for (let ai = 0; ai < g.adds.length; ai++) {
        if (usedA[ai]) continue;
        if (g.drops[di].position && g.drops[di].position === g.adds[ai].position) {
          out.push(mk(g, g.adds[ai], g.drops[di]));
          usedA[ai] = usedD[di] = true;
          break;
        }
      }
    }
    for (let di = 0; di < g.drops.length; di++) {
      if (usedD[di]) continue;
      const ai = usedA.indexOf(false);
      if (ai >= 0) { out.push(mk(g, g.adds[ai], g.drops[di])); usedA[ai] = true; }
      else {
        out.push(mk(g, null, g.drops[di]));
        audit.push({ type: 'tx_unpaired', msg: `W${g.week} ${g.fantasy_team} ${g.type}: DROP ${g.drops[di].player} has no matching ADD` });
      }
      usedD[di] = true;
    }
    g.adds.forEach((a, ai) => {
      if (usedA[ai]) return;
      out.push(mk(g, a, null));
      audit.push({ type: 'tx_unpaired', msg: `W${g.week} ${g.fantasy_team} ${g.type}: ADD ${a.player} has no matching DROP` });
    });
  }
  return out.sort((a, b) => a.week - b.week);
}

/** Find the departing player on a team: exact → case-insensitive → short-name / normName. */
function findOnTeam(roster: RosterEntry[], team: string, name: string): number {
  const idxs = roster.map((r, i) => (r.fantasy_team === team ? i : -1)).filter(i => i >= 0);
  let hit = idxs.find(i => String(roster[i].player).trim() === name);
  if (hit != null) return hit;
  hit = idxs.find(i => String(roster[i].player).trim().toLowerCase() === name.toLowerCase());
  if (hit != null) return hit;
  const m = matchShortName(name, idxs.map(i => roster[i].player));
  if (m) {
    hit = idxs.find(i => roster[i].player === m);
    if (hit != null) return hit;
  }
  return -1;
}

function mkRow(tx: Transaction, orig: RosterEntry | null): RosterEntry {
  return {
    round: orig ? orig.round : '',
    pick: orig ? orig.pick : '',
    fantasy_team: orig ? orig.fantasy_team : tx.fantasy_team,
    player: tx.player_in,
    nfl_team: tx.nfl_team_in || (orig ? orig.nfl_team : ''),
    // IR swaps keep the outgoing player's position; ADD_DROP uses the given position.
    position: tx.type === 'IR' && orig ? orig.position : tx.position_in || (orig ? orig.position : ''),
    acquired_week: tx.week,
    acquired_via: tx.type === 'IR' ? 'IR' : 'ADD_DROP',
    replaces: tx.player_out || '',
  };
}

/**
 * Effective roster for `week`: apply every transaction with tx.week ≤ week in order. A swap
 * replaces the dropped player's row in place (keeping round/pick), so sort order is stable.
 * A drop that matches nobody is logged (and the ADD still lands), exactly like the sheet.
 */
export function resolveRosterForWeek(base: RosterEntry[], txs: Transaction[], week: number, audit: AuditEntry[] = []): RosterEntry[] {
  const roster = base.map(r => ({ ...r }));
  for (const tx of txs) {
    if (tx.week > week) continue;
    const hasOut = !!tx.player_out.trim();
    const hasIn = !!tx.player_in.trim();
    const idx = hasOut ? findOnTeam(roster, tx.fantasy_team, tx.player_out) : -1;
    if (hasOut && idx < 0) {
      audit.push({ type: 'tx_player_not_on_roster', msg: `W${tx.week} ${tx.fantasy_team}: drop of "${tx.player_out}" — not on roster at time of transaction` });
    }
    if (hasOut && hasIn) {
      if (idx < 0) roster.push(mkRow(tx, null));
      else roster[idx] = mkRow(tx, roster[idx]);
    } else if (hasIn) {
      roster.push(mkRow(tx, null));
    } else if (hasOut && idx >= 0) {
      roster.splice(idx, 1);
    }
  }
  return roster;
}

/** Cumulative ADD_DROP allowance through a week: after W4 → 1, after W8 → 3, after W12 → 4. */
export const ADD_DROP_BUDGET = [
  { afterWeek: 4, budget: 1 },
  { afterWeek: 8, budget: 3 },
  { afterWeek: 12, budget: 4 },
];
export function addDropAllowedForWeek(week: number): number {
  let allowed = 0;
  for (const b of ADD_DROP_BUDGET) if (week > b.afterWeek) allowed = b.budget;
  return allowed;
}

/**
 * Warnings only — never blocks. IR swaps must be same NFL team + same position (the NFL team of
 * the incoming player is looked up via `teamOf`, e.g. from stats); ADD_DROP budget/timing.
 */
export function validateTransactions(base: RosterEntry[], txs: Transaction[], teamOf: (player: string) => string | undefined, audit: AuditEntry[] = []): void {
  const byTeam = new Map<string, { roster: RosterEntry[]; used: number }>();
  for (const r of base) {
    if (!byTeam.has(r.fantasy_team)) byTeam.set(r.fantasy_team, { roster: [], used: 0 });
    byTeam.get(r.fantasy_team)!.roster.push({ ...r });
  }
  for (const tx of txs) {
    const t = byTeam.get(tx.fantasy_team);
    if (!t) { audit.push({ type: 'tx_unknown_team', msg: `W${tx.week} ${tx.fantasy_team}: unknown fantasy_team` }); continue; }
    const idx = tx.player_out ? findOnTeam(t.roster, tx.fantasy_team, tx.player_out) : -1;
    const out = idx >= 0 ? t.roster[idx] : null;
    if (tx.type === 'IR') {
      const inTeam = normTeam(teamOf(tx.player_in) ?? '');
      if (out && out.nfl_team && inTeam && out.nfl_team !== inTeam) {
        audit.push({ type: 'tx_ir_team_mismatch', msg: `W${tx.week} ${tx.fantasy_team}: IR swap must use same NFL team — ${out.player} (${out.nfl_team}) → ${tx.player_in} (${inTeam})` });
      }
      if (out && out.position && tx.position_in && out.position.toUpperCase() !== tx.position_in) {
        audit.push({ type: 'tx_ir_pos_mismatch', msg: `W${tx.week} ${tx.fantasy_team}: IR swap must use same position — ${out.player} (${out.position}) → ${tx.player_in} (${tx.position_in})` });
      }
    } else if (tx.type === 'ADD_DROP') {
      t.used += 1;
      const allowed = addDropAllowedForWeek(tx.week);
      if (tx.week < 5) audit.push({ type: 'tx_addrop_too_early', msg: `W${tx.week} ${tx.fantasy_team}: ADD_DROP not allowed until after Week 4` });
      else if (t.used > allowed) audit.push({ type: 'tx_addrop_budget', msg: `W${tx.week} ${tx.fantasy_team}: ADD_DROP budget exceeded (#${t.used}, allowed ${allowed} through W${tx.week})` });
    } else {
      audit.push({ type: 'tx_unknown_type', msg: `W${tx.week} ${tx.fantasy_team}: unknown transaction type "${tx.type}"` });
    }
    if (idx >= 0) t.roster.splice(idx, 1);
    if (tx.player_in) t.roster.push({ round: '', pick: '', fantasy_team: tx.fantasy_team, player: tx.player_in, nfl_team: normTeam(teamOf(tx.player_in) ?? ''), position: tx.type === 'IR' && out ? out.position : tx.position_in });
  }
}
