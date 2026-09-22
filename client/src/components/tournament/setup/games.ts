/**
 * Games a tournament can be created for: one entry per installed game module
 * (api/src/integrations/registry.ts). Tournament responses carry `game`, but
 * the create API does not take one yet and every tournament runs on
 * Counter-Strike 2, so the first entry is the one used. Its id picks the
 * client integration (client/src/integrations/registry.ts) for the setup's
 * game-specific steps. Add a module here when the API can create tournaments for it.
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
