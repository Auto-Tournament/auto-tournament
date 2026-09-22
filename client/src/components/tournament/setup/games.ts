/**
 * Games a tournament can be created for: one entry per installed game module
 * (api/src/integrations/registry.ts). The tournament API has no game field
 * yet and every tournament runs on Counter-Strike 2, so the first entry is
 * the one used. Add a module here when the API can create tournaments for it.
 */
export interface SetupGame {
  id: string;
  name: string;
  /** Short mark shown when there is no icon. */
  mark: string;
  /** Square icon under client/public (the game's Steam client icon). */
  icon?: string;
}

export const SETUP_GAMES: SetupGame[] = [
  { id: 'cs2', name: 'Counter-Strike 2', mark: 'CS', icon: '/games/cs2.png' },
];

export const DEFAULT_SETUP_GAME = SETUP_GAMES[0];
