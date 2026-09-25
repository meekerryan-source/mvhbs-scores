// Shared engine types. The engine is pure: every function takes these in-memory shapes and
// returns new values — no I/O, no clocks, no network.

export type Bucket = 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DST' | 'IDP';
export type Slot = 'starter' | 'bonus' | 'bench';
export type DisplayTeam = 'Jannai' | 'Meeker' | 'Allens' | 'Koo' | 'Guzman' | 'Woo' | 'Hottish' | 'AZN';

/** One row of Rules_Thresholds (tiered "highest only" tables and per-event bands). */
export interface ThresholdRule {
  rule_id: string;
  category: string;
  stat: string;
  pos: string;
  scope: string;
  min: number;
  /** null = open-ended top band ("50+"). */
  max: number | null;
  points: number;
}

/** One row of Rules_Linear (per-event / milestone rules; informational — the engine hard-codes these). */
export interface LinearRule {
  rule_id: string;
  category: string;
  stat: string;
  pos: string;
  scope: string;
  ppu: number;
  unit: string;
  logic: string;
}

export interface Rules {
  threshold: ThresholdRule[];
  linear: LinearRule[];
}

/** The subset of nflverse `stats_player_week` the engine consumes (numbers already coerced). */
export interface PlayerWeekStats {
  season: number;
  week: number;
  season_type: string;
  game_id: string;
  player_id: string;
  player_display_name: string;
  position: string;
  position_group: string;
  team: string; // normTeam()'d
  opponent_team: string; // normTeam()'d
  passing_yards: number;
  passing_tds: number;
  passing_interceptions: number;
  passing_2pt_conversions: number;
  rushing_yards: number;
  rushing_tds: number;
  rushing_2pt_conversions: number;
  receptions: number;
  receiving_yards: number;
  receiving_tds: number;
  receiving_2pt_conversions: number;
  special_teams_tds: number;
  fg_made: number;
  fg_att: number;
  fg_made_list: string;
  fg_missed_list: string;
  pat_made: number;
  pat_att: number;
  pat_missed: number;
  def_sacks: number;
  def_interceptions: number;
  def_tds: number;
  fumble_recovery_opp: number;
  fumble_recovery_tds: number;
}

export type TdType = 'pass' | 'rec' | 'rush' | 'picksix' | 'fumreturn' | 'st';

/** One extracted TD play (the sheet's PBP_TDs tab). */
export interface TdRow {
  season: number;
  week: number;
  season_type: string;
  game_id: string;
  td_type: TdType;
  scorer_id: string;
  team: string;
  yards_gained: number;
}

/** Final game result (the sheet's Team_Games tab, played games only). */
export interface GameResult {
  season: number;
  week: number;
  game_id: string;
  home_team: string;
  away_team: string;
  home_score: number;
  away_score: number;
}

export interface AuditEntry {
  type: string;
  msg: string;
}

export type Component =
  | 'yardage'
  | 'passing'
  | 'receptions'
  | 'td_distance'
  | 'td_milestone'
  | 'int_penalty'
  | 'two_pt'
  | 'kicking'
  | 'idp'
  | 'st_td';

export const COMPONENTS: Component[] = [
  'yardage', 'passing', 'receptions', 'td_distance', 'td_milestone',
  'int_penalty', 'two_pt', 'kicking', 'idp', 'st_td',
];

/** One scoring line — the unit of the audit trail (Points Log row). */
export interface ScoreLine {
  component: Component | 'dst';
  category: string;
  detail: string;
  points: number;
  rule_id?: string;
}

export interface PlayerScore {
  season: number;
  week: number;
  player_id: string;
  player: string;
  position: string;
  position_group: string;
  team: string;
  opp: string;
  game_id: string;
  total: number;
  components: Record<Component, number>;
  lines: ScoreLine[];
  stats: PlayerWeekStats;
}

export interface DstScore {
  season: number;
  week: number;
  team: string;
  opp: string;
  win: number;
  margin: number;
  pf: number;
  pa: number;
  total: number;
  pts_win: number;
  pts_mov: number;
  pts_shutout: number;
  pts_50_burger: number;
  lines: ScoreLine[];
}

export interface RosterEntry {
  round: number | '';
  pick: number | '';
  fantasy_team: string; // roster key, e.g. 'KGSC'
  player: string;
  nfl_team: string; // normTeam()'d
  position: string;
  acquired_week?: number;
  acquired_via?: 'IR' | 'ADD_DROP';
  replaces?: string;
}

/** Raw Transactions tab row (NEW schema: one row per ADD or DROP). */
export interface TransactionRow {
  Week: number;
  Team: string; // display name
  Kind: string; // IR_SWAP | ADD_DROP
  Action: string; // ADD | DROP
  Player: string;
  Position: string;
}

/** A paired transaction (drop + add) as the engine applies it. */
export interface Transaction {
  week: number;
  fantasy_team: string; // roster key
  type: 'IR' | 'ADD_DROP' | string;
  player_out: string;
  player_in: string;
  nfl_team_in: string;
  position_in: string;
}

export interface DoublerRow {
  season: number;
  week: number;
  fantasy_team: string; // roster key
  player: string;
}
