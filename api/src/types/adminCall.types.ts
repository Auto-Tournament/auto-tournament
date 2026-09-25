/**
 * Admin calls: a player asking for an admin from inside a game server
 * (CS2: `.admin [message]` in Ready Up). Core's concept; a game integration
 * turns its own event into an `AdminCallInput` and hands it to
 * `services/adminCallService`.
 */

/** Longest message stored; the game server already caps what a player can type. */
export const ADMIN_CALL_MESSAGE_MAX = 200;

/** Which team the caller is on, in the platform's terms. */
export type AdminCallTeam = 'team1' | 'team2' | 'spectator';

/** What a game integration hands the core for one call. */
export interface AdminCallInput {
  /** The game server's own id for the call; a repeat of it is ignored. */
  callId: string;
  /** Integration id, e.g. 'cs2'. */
  game: string;
  serverId: string | null;
  serverName: string | null;
  matchId: number | null;
  matchSlug: string | null;
  mapNumber: number | null;
  player: {
    steamId: string | null;
    name: string | null;
    team: AdminCallTeam | null;
    /** The game's side name, e.g. 'ct' or 't'. */
    side: string | null;
  };
  /** What the player typed. May be empty. */
  message: string;
  /** Epoch seconds, as the game server reported it. */
  calledAt: number;
}

/** One call, as the API and the socket send it. Times are ISO 8601 (UTC). */
export interface AdminCall {
  id: number;
  callId: string;
  game: string;
  serverId: string | null;
  serverName: string | null;
  matchId: number | null;
  matchSlug: string | null;
  mapNumber: number | null;
  /** The two teams of the match, when it is still there. */
  team1Name: string | null;
  team2Name: string | null;
  player: {
    steamId: string | null;
    name: string | null;
    team: AdminCallTeam | null;
    /** Name of the team the player is on, when known. */
    teamName: string | null;
    side: string | null;
  };
  message: string;
  calledAt: string;
  receivedAt: string;
  resolvedAt: string | null;
  /** Steam ID of the admin who resolved it, or `token:<label>`. */
  resolvedBy: string | null;
  /** That admin's player name, when known. */
  resolvedByName: string | null;
  resolutionNote: string | null;
}

/** Socket.IO `admin:call:resolved` payload. */
export interface AdminCallResolvedEvent {
  ids: number[];
  resolvedAt: string;
  resolvedBy: string | null;
}
