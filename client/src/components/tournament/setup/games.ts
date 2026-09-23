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
 * Icons come from the catalogue (IGDB or Wikidata, via `gameCatalogService`),
 * so adding a game adds no files here. Counter-Strike 2 keeps the bundled
 * Steam client icon it has always had, and a game with neither shows a short
 * text mark.
 */

import { useEffect, useState } from 'react';
import { api } from '../../../utils/api';

export interface SetupGame {
  /** What `tournament.game` is set to: a catalogue slug, or a module id. */
  id: string;
  name: string;
  /** Short mark shown when there is no icon. */
  mark: string;
  /** Square icon: bundled for CS2, else the catalogue's cover or logo. */
  icon?: string;
  /** The module that runs it ('cs2', 'manual-report'). */
  integrationId: string;
}

/** Icons that ship with the client, by catalogue slug. */
const BUNDLED_ICONS: Record<string, string> = {
  'counter-strike-2': '/games/cs2.png',
};

/**
 * Counter-Strike 2, the game every instance has had. Shown while the
 * catalogue loads, and kept as the whole list if the request fails — a wizard
 * that cannot reach the API is still a wizard that creates the tournament
 * this instance has always created.
 */
export const DEFAULT_SETUP_GAME: SetupGame = {
  id: 'cs2',
  name: 'Counter-Strike 2',
  mark: 'CS',
  icon: BUNDLED_ICONS['counter-strike-2'],
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
  imageUrl: string | null;
  integrationId: string | null;
  /** What to store as `tournament.game`; the API decides the spelling. */
  gameRef?: string;
}

function toSetupGame(game: PlayableGame): SetupGame | null {
  if (!game.integrationId) return null;
  const icon = BUNDLED_ICONS[game.slug] ?? game.imageUrl ?? undefined;
  return {
    id: game.gameRef || game.slug,
    name: game.name,
    mark: gameMark(game.name),
    ...(icon ? { icon } : {}),
    integrationId: game.integrationId,
  };
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
