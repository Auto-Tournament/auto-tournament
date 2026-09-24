/**
 * Tournament Types
 */

export type TournamentType =
  | 'single_elimination'
  | 'double_elimination'
  | 'round_robin'
  | 'swiss'
  | 'shuffle';

export type TournamentStatus = 'setup' | 'ready' | 'in_progress' | 'completed' | 'cancelled';

export type MatchFormat = 'bo1' | 'bo3' | 'bo5';

export interface VetoStep {
  step: number;
  team: 'team1' | 'team2';
  action: 'ban' | 'pick' | 'side_pick';
}

export interface TournamentSettings {
  matchFormat: MatchFormat;
  thirdPlaceMatch: boolean;
  autoAdvance: boolean;
  checkInRequired: boolean;
  seedingMethod: 'random' | 'manual';
  /**
   * Grand final behaviour for double elimination tournaments.
   * - 'none'   -> Winners bracket final decides champion (no cross‑bracket GF)
   * - 'simple' -> Single grand final between WB winner and LB winner
   * - 'double' -> Intended bracket‑reset style GF (currently treated as 'simple' at generation time)
   */
  grandFinalMode?: 'none' | 'simple' | 'double';
  customVetoOrder?: {
    bo1?: VetoStep[];
    bo3?: VetoStep[];
    bo5?: VetoStep[];
  };
  /**
   * Optional global round/OT hints that can be embedded into templates.
   * For persisted tournaments, the canonical values live on the top-level
   * Tournament fields (maxRounds, overtimeMode, overtimeSegments).
   */
  maxRounds?: number;
  overtimeMode?: 'enabled' | 'disabled';
  overtimeSegments?: number;

  /**
   * Organizer-written event page content (the public "Overview" tab).
   * All optional; the page hides a section when its data is empty. Lengths
   * are enforced server-side in routes/tournament.ts
   * (`validateEventPageSettings`).
   */
  /** Plain text, max 4000 chars. */
  description?: string;
  /** Free-text location line, e.g. "On site, Trondheim". Max 120 chars. */
  location?: string;
  /** Numbered rules, in display order. Max 20 items, 500 chars each. */
  rules?: string[];
  /** Link to a fuller rulebook. Must be an https URL, or empty/omitted. */
  rulebookUrl?: string;
  /** Up to 5 placements, in display order (e.g. 1st/2nd/3rd). */
  prizes?: EventPagePrize[];
  /** Up to 20 schedule rows, in display order. */
  schedule?: EventPageScheduleItem[];
}

export interface EventPagePrize {
  place: string;
  prize: string;
}

export interface EventPageScheduleItem {
  /** ISO 8601 datetime string. */
  at: string;
  label: string;
}

export interface Tournament {
  id: number;
  name: string;
  type: TournamentType;
  format: MatchFormat;
  status: TournamentStatus;
  /** Game integration that owns the tournament (`tournament.game`, default 'cs2'). */
  game: string;
  maps: string[]; // JSON array
  team_ids: string[]; // JSON array
  settings: TournamentSettings; // JSON object
  // Shuffle tournament specific fields (parsed / normalized)
  mapSequence?: string[]; // Maps in order (number of rounds)
  teamSize?: number; // Number of players per team (default: 5)
  maxRounds?: number;
  overtimeMode?: 'enabled' | 'disabled';
  overtimeSegments?: number;
  eloTemplateId?: string | null;
  created_at: number;
  updated_at: number;
  started_at?: number;
  completed_at?: number;
}

export interface TournamentRow {
  id: number;
  name: string;
  type: TournamentType;
  format: MatchFormat;
  status: TournamentStatus;
  game?: string | null;
  maps: string; // JSON string
  team_ids: string; // JSON string
  settings: string; // JSON string
  // Shuffle tournament specific fields (raw DB columns)
  map_sequence?: string | null;
  team_size?: number | null;
  max_rounds?: number | null;
  overtime_mode?: string | null;
  overtime_segments?: number | null;
  elo_template_id?: string | null;
  created_at: number;
  updated_at: number;
  started_at?: number;
  completed_at?: number;
}

export interface CreateTournamentInput {
  name: string;
  /**
   * The game to run: a catalogue slug ('rocket-league') or an installed
   * module's id ('cs2'). Omitted, the row takes the `game` column default
   * (CS2), which is what every tournament created before 3.0 phase D was.
   */
  game?: string;
  type: TournamentType;
  format: MatchFormat;
  maps: string[];
  teamIds: string[];
  settings?: Partial<TournamentSettings>;
  // Optional global round-limit settings (applies to all tournament types).
  // For shuffle, maxRounds/overtime settings are provided via the dedicated shuffle endpoint.
  maxRounds?: number;
  overtimeMode?: 'enabled' | 'disabled';
  /**
   * Optional global overtime policy hint (applies to all tournament types).
   *
   * Semantics are shared with shuffle tournaments and manual matches:
   * - undefined / omitted → Auto Tournament CS2 default behaviour (usually unlimited OT, draws allowed)
   * - 0 with overtimeMode === 'disabled' → "no OT, no draws" (force winner by damage tiebreak)
   * - >0 with overtimeMode === 'enabled' → standard OT, then damage tiebreak after N segments
   */
  overtimeSegments?: number;
}

export interface UpdateTournamentInput {
  name?: string;
  type?: TournamentType;
  format?: MatchFormat;
  maps?: string[];
  teamIds?: string[];
  settings?: Partial<TournamentSettings>;
  maxRounds?: number;
  overtimeMode?: 'enabled' | 'disabled';
  /**
   * null clears the setting back to the Auto Tournament CS2 default (unlimited overtime,
   * or draws allowed when overtime is disabled). 0 with overtimeMode
   * 'disabled' means "no overtime, no draws" (damage tiebreak).
   */
  overtimeSegments?: number | null;
}

export interface BracketMatch {
  id: number;
  slug: string;
  round: number;
  matchNumber: number;
  team1?: {
    id: string;
    name: string;
    tag?: string;
  } | null;
  team2?: {
    id: string;
    name: string;
    tag?: string;
  } | null;
  winner?: {
    id: string;
    name: string;
    tag?: string;
  } | null;
  serverId?: string | null;
  status: 'pending' | 'ready' | 'loaded' | 'live' | 'completed';
  nextMatchId?: number | null;
  createdAt?: number;
  loadedAt?: number;
  completedAt?: number;
  /** Headline score: maps won when completed, current map rounds while in progress. */
  team1Score?: number;
  team2Score?: number;
  /** Maps won in the series. */
  team1SeriesScore?: number;
  team2SeriesScore?: number;
  /** Rounds on the map being played (0-0 during warmup; last map once completed; null before any map). */
  team1MapScore?: number | null;
  team2MapScore?: number | null;
  mapResults?: Array<{
    mapNumber: number;
    mapName?: string | null;
    team1Score: number;
    team2Score: number;
    winnerTeam: 'team1' | 'team2' | 'none' | null;
    completedAt: number;
  }>;
  team1Players?: Array<{
    name: string;
    steamId: string;
    kills: number;
    deaths: number;
    assists: number;
    damage: number;
    headshots: number;
  }>;
  team2Players?: Array<{
    name: string;
    steamId: string;
    kills: number;
    deaths: number;
    assists: number;
    damage: number;
    headshots: number;
  }>;
  config?: {
    maplist?: string[];
    num_maps?: number;
    team1?: { name: string };
    team2?: { name: string };
  };
}

export interface TournamentResponse extends Omit<Tournament, 'settings' | 'maps' | 'team_ids'> {
  maps: string[];
  teamIds: string[];
  settings: TournamentSettings;
  teams: Array<{
    id: string;
    name: string;
    tag?: string;
  }>;
  // Shuffle tournament specific fields
  mapSequence?: string[];
  teamSize?: number; // Number of players per team (default: 5)
  maxRounds?: number;
  overtimeMode?: 'enabled' | 'disabled';
  overtimeSegments?: number;
  eloTemplateId?: string; // ELO calculation template ID (optional, defaults to "Pure Win/Loss")
  /**
   * Champion once the tournament is completed (null otherwise, for shuffle
   * tournaments, and for round robin when the top spot is shared).
   */
  winner?: { id: string; name: string; tag?: string } | null;
}

/** One row of the Swiss standings, in the order the pairing uses. */
export interface SwissStandingEntry {
  rank: number;
  teamId: string;
  wins: number;
  losses: number;
  /** Sum of the wins of every opponent played. */
  buchholz: number;
  /** Rounds won minus rounds lost over all maps. */
  roundDiff: number;
  byes: number;
}

/** Round robin standings row: wins, head-to-head, round difference, rounds won, seed. */
export interface RoundRobinStandingEntry {
  rank: number;
  teamId: string;
  wins: number;
  losses: number;
  /** Rounds won minus rounds lost over all maps. */
  roundDiff: number;
  roundsWon: number;
}

export interface BracketResponse {
  tournament: TournamentResponse;
  matches: BracketMatch[];
  totalRounds: number;
  /** Swiss tournaments only: server standings, best first. */
  swissStandings?: SwissStandingEntry[];
  roundRobinStandings?: RoundRobinStandingEntry[];
}

export interface TournamentTemplate {
  id: number;
  name: string;
  description?: string;
  type: TournamentType;
  format: MatchFormat;
  mapPoolId?: number | null;
  maps: string[];
  teamIds?: string[];
  settings: TournamentSettings;
  createdAt: number;
  updatedAt: number;
}

export interface TournamentTemplateRow {
  id: number;
  name: string;
  description?: string | null;
  type: TournamentType;
  format: MatchFormat;
  map_pool_id?: number | null;
  maps?: string | null;
  team_ids?: string | null;
  settings: string; // JSON string
  created_at: number;
  updated_at: number;
}

export interface CreateTemplateInput {
  name: string;
  description?: string;
  type: TournamentType;
  format: MatchFormat;
  mapPoolId?: number | null;
  maps?: string[];
  teamIds?: string[];
  settings?: Partial<TournamentSettings>;
}

export interface UpdateTemplateInput {
  name?: string;
  description?: string;
  type?: TournamentType;
  format?: MatchFormat;
  mapPoolId?: number | null;
  maps?: string[];
  teamIds?: string[];
  settings?: Partial<TournamentSettings>;
}
