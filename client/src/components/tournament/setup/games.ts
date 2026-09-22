/**
 * Games a tournament can be created for: one entry per installed game module
 * (api/src/integrations/registry.ts). The tournament API has no game field
 * yet and every tournament runs on Counter-Strike 2, so the first entry is
 * the one used. Add a module here when the API can create tournaments for it.
 */
export interface SetupGame {
  id: string;
  name: string;
  /** Short mark shown in place of a logo. */
  mark: string;
}

export const SETUP_GAMES: SetupGame[] = [{ id: 'cs2', name: 'Counter-Strike 2', mark: 'CS' }];

export const DEFAULT_SETUP_GAME = SETUP_GAMES[0];
