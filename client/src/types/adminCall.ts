/**
 * An admin call as `/api/admin-calls` and the `admin:call` socket event send
 * it (api/src/types/adminCall.types.ts). Times are ISO 8601, UTC.
 */
export interface AdminCall {
  id: number;
  callId: string;
  game: string;
  serverId: string | null;
  serverName: string | null;
  matchId: number | null;
  matchSlug: string | null;
  mapNumber: number | null;
  team1Name: string | null;
  team2Name: string | null;
  player: {
    steamId: string | null;
    name: string | null;
    team: 'team1' | 'team2' | 'spectator' | null;
    teamName: string | null;
    side: string | null;
  };
  message: string;
  calledAt: string;
  receivedAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolvedByName: string | null;
  resolutionNote: string | null;
}

/** `admin:call:resolved` payload. */
export interface AdminCallResolvedEvent {
  ids: number[];
  resolvedAt: string;
  resolvedBy: string | null;
}
