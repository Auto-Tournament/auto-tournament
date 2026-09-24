/**
 * What the standalone match dialog reads and posts, in the shapes it uses.
 *
 * The dialog is this module's (`standaloneMatch`, client API 0.2.0): core
 * opens it and hears back a match slug. It asks the platform's own routes
 * for teams, players and matches, so these describe only the fields it
 * reads from their answers.
 */

/** One player on a team roster (`GET /api/teams`). */
export interface RosterPlayer {
  steamId: string;
  name: string;
  avatar?: string;
}

/** A team to pick for a side (`GET /api/teams`). */
export interface Team {
  id: string;
  name: string;
  tag?: string;
  players?: RosterPlayer[];
}

export interface TeamsResponse {
  success: boolean;
  teams: Team[];
}

/** A player to put on an ad-hoc side (`GET /api/players`). */
export interface PlayerDetail {
  /** Steam ID. */
  id: string;
  name: string;
  avatar?: string;
  isAdmin?: boolean;
}

export interface PlayersResponse {
  success: boolean;
  players: PlayerDetail[];
}

/** An existing match, to tell which players and teams are busy (`GET /api/matches`). */
export interface ActiveMatch {
  status: string;
  team1?: { id?: string | null } | null;
  team2?: { id?: string | null } | null;
  config?: {
    team1?: { players?: Array<{ steamid: string }> } | null;
    team2?: { players?: Array<{ steamid: string }> } | null;
  } | null;
}

export interface MatchesResponse {
  success: boolean;
  matches: ActiveMatch[];
}

export type StartingSide = 'knife' | 'team1_ct' | 'team2_ct';

/** One side of the config the dialog posts. */
export interface StandaloneMatchTeam {
  id?: string;
  name: string;
  tag?: string;
  players?: Array<{ steamid: string; name: string }>;
}

/**
 * The match config the dialog builds, shows on its review step and posts to
 * `POST /api/matches`. The golden spec `standalone (manual) match` pins the
 * same payload on the API side.
 */
export interface StandaloneMatchConfig {
  vetoDisabled: boolean;
  maplist: string[];
  num_maps: number;
  players_per_team: number;
  expected_players_total: number;
  expected_players_team1: number;
  expected_players_team2: number;
  team1: StandaloneMatchTeam;
  team2: StandaloneMatchTeam;
  map_sides?: StartingSide[];
  cvars?: Record<string, string | number>;
}

/** `POST /api/matches`. */
export interface MatchResponse {
  success: boolean;
  error?: string;
  match?: { id: number; slug: string };
}
