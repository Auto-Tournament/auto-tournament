/**
 * Steam API types
 */

export interface SteamPlayer {
  steamId: string;
  name: string;
  avatarUrl?: string;
}

export interface SteamAPIResponse {
  response: {
    success: number;
    steamid?: string;
    message?: string;
  };
}

export interface SteamPlayerSummaryResponse {
  response: {
    players: Array<{
      steamid: string;
      personaname: string;
      avatarfull: string;
    }>;
  };
}
