/**
 * The games a tournament can be created for, for the setup wizard's first step
 * (3.0 phase D, PR D9).
 *
 * The list is the API's, not the client's: `GET /api/games/playable` is every
 * built-in catalogue game an installed module runs, and each entry says which
 * module (`integrationId`). That matters because the wizard's later steps are
 * the module's — Counter-Strike 2 asks for servers, a map pool and a veto, a
 * manually reported game asks who confirms a result — and the client resolves
 * them through `integrations/registry` from the `game` value stored here.
 *
 * It is not everything that can be run: manual reporting answers for any
 * catalogue game, including one found through game search. It is the list an
 * organizer picks from without searching, which is what a wizard step is.
 *
 * Icons are the module's own (`GameCatalogEntry.icon` -> `moduleIcon`), served
 * from `client/public/games`: square tiles in one palette, with their own
 * background. They are not the catalogue's IGDB or Wikidata artwork, which is
 * every shape and every colour and was unreadable dropped onto a dark card —
 * that art belongs to the player-facing "What do you play?" surfaces, where
 * someone is recognising their own game and the list covers every game rather
 * than the handful a module runs. A title no module ships a tile for shows a
 * short text mark; nothing is stretched or borrowed to fill the box.
 */

import { useEffect, useState } from 'react';
import { getIntegration } from '../../../integrations/registry';
import { api } from '../../../utils/api';

export interface SetupGame {
  /** What `tournament.game` is set to: a catalogue slug, or a module id. */
  id: string;
  name: string;
  /** Short mark shown when there is no icon. */
  mark: string;
  /** The module's own square tile, when it ships one for this game. */
  icon?: string;
  /** The module that runs it ('cs2', 'manual-report'). */
  integrationId: string;
}

/**
 * Counter-Strike 2, the game every instance has had. Shown while the
 * catalogue loads, and kept as the whole list if the request fails — a wizard
 * that cannot reach the API is still a wizard that creates the tournament
 * this instance has always created.
 *
 * Its tile comes from the CS2 client integration's own declaration
 * (`catalogIcon`) rather than a path written here, so the module still owns
 * its art on the one card the API never answered for.
 */
const CS2_TILE = getIntegration('cs2').catalogIcon;

export const DEFAULT_SETUP_GAME: SetupGame = {
  id: 'cs2',
  name: 'Counter-Strike 2',
  mark: 'CS',
  ...(CS2_TILE ? { icon: CS2_TILE } : {}),
  integrationId: 'cs2',
};

/**
 * Up to two initials for a game with no icon: "Rocket League" → "RL",
 * "osu!" → "OS", "Chess" → "CH".
 */
export function gameMark(name: string): string {
  const words = name.replace(/[^\p{L}\p{N} ]+/gu, ' ').split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

interface PlayableGame {
  slug: string;
  name: string;
  integrationId: string | null;
  /** The module's own square tile, or null when it ships none. */
  moduleIcon?: string | null;
  /** What to store as `tournament.game`; the API decides the spelling. */
  gameRef?: string;
}

function toSetupGame(game: PlayableGame): SetupGame | null {
  if (!game.integrationId) return null;
  return {
    id: game.gameRef || game.slug,
    name: game.name,
    mark: gameMark(game.name),
    ...(game.moduleIcon ? { icon: game.moduleIcon } : {}),
    integrationId: game.integrationId,
  };
}

/** The games one module runs, in the order the API listed them. */
export interface SetupGameGroup {
  integrationId: string;
  games: SetupGame[];
}

/**
 * The games grouped by the module that runs them, first appearance first.
 *
 * How a game runs — on your own servers, or played by the teams with a
 * captain typing in the result — is a fact about the module, not about the
 * game, so the step says it once above each group instead of repeating the
 * same sentence on all sixteen cards.
 */
export function groupSetupGames(games: SetupGame[]): SetupGameGroup[] {
  const groups: SetupGameGroup[] = [];
  const byId = new Map<string, SetupGameGroup>();
  for (const game of games) {
    let group = byId.get(game.integrationId);
    if (!group) {
      group = { integrationId: game.integrationId, games: [] };
      byId.set(game.integrationId, group);
      groups.push(group);
    }
    group.games.push(game);
  }
  return groups;
}

/**
 * The playable games, with Counter-Strike 2 alone until the API answers.
 *
 * `loading` is for the step to say so rather than to hide the list: the
 * fallback is a real, pickable entry, so a slow request never leaves the
 * organizer with nothing to click.
 */
export function useSetupGames(): { games: SetupGame[]; loading: boolean } {
  const [games, setGames] = useState<SetupGame[]>([DEFAULT_SETUP_GAME]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ success: boolean; games: PlayableGame[] }>('/api/games/playable')
      .then((response) => {
        if (cancelled) return;
        const list = (response.games ?? [])
          .map(toSetupGame)
          .filter((game): game is SetupGame => game !== null);
        if (list.length > 0) setGames(list);
      })
      .catch((error) => console.error('Failed to load the game catalogue:', error))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { games, loading };
}
