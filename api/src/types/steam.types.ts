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

export type SteamWebApiHealthErrorType = 'not_configured' | 'invalid_key' | 'unreachable' | 'unknown';

export type SteamWebApiHealth =
  | {
      configured: false;
      ok: false;
      errorType: 'not_configured';
      error: string;
    }
  | {
      configured: true;
      ok: true;
    }
  | {
      configured: true;
      ok: false;
      errorType: Exclude<SteamWebApiHealthErrorType, 'not_configured'>;
      error: string;
      statusCode?: number;
    };
