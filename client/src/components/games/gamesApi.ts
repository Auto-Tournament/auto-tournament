/* global AbortSignal */
import { api } from '../../utils/api';

/** A game from the catalogue (`/api/games/*`, `/api/me/games`). */
export interface GameSummary {
  id: number;
  slug: string;
  name: string;
  coverUrl: string | null;
  releaseYear: number | null;
  /** A game module is installed for it: this instance can run its tournaments. */
  supported: boolean;
  /** Where this row's data came from; picks which credit line to show. */
  source: 'igdb' | 'wikidata' | 'builtin';
  /** Up to 3 genre names. */
  genres: string[];
  /** `coverUrl` if present, else `logoUrl`; what the onboarding page's cards render. */
  imageUrl: string | null;
  /**
   * The game's square app icon (the one on a player's phone or launcher), from
   * its module or pack; null when neither ships one. What game pills draw.
   */
  appIconUrl: string | null;
}

export interface GameSearchResponse {
  games: GameSummary[];
  fromIgdb: boolean;
  fromWikidata: boolean;
}

export interface MyGamesResponse {
  games: GameSummary[];
  showPrompt: boolean;
}

export const MAX_PLAYER_GAMES = 30;
export const SEARCH_MIN_LENGTH = 2;

/** Fired on window after the player's games are saved, so other views refresh. */
export const GAMES_UPDATED_EVENT = 'mat:games-updated';

export async function searchGames(q: string, signal?: AbortSignal): Promise<GameSearchResponse> {
  const response = await fetch(`/api/games/search?q=${encodeURIComponent(q)}`, {
    credentials: 'same-origin',
    signal,
  });
  if (!response.ok) throw new Error(`search failed: ${response.status}`);
  return (await response.json()) as GameSearchResponse;
}

export async function fetchSuggestions(): Promise<GameSummary[]> {
  const response = await fetch('/api/games/suggestions', { credentials: 'same-origin' });
  if (!response.ok) return [];
  const body = (await response.json()) as { games?: GameSummary[] };
  return body.games ?? [];
}

/** Every built-in game (installed modules + popular titles), for the onboarding grid. */
export async function fetchPopularGames(): Promise<GameSummary[]> {
  const response = await fetch('/api/games/popular', { credentials: 'same-origin' });
  if (!response.ok) return [];
  const body = (await response.json()) as { games?: GameSummary[] };
  return body.games ?? [];
}

/** The signed-in player's games; null when the API does not answer for this viewer. */
export async function fetchMyGames(): Promise<MyGamesResponse | null> {
  const response = await fetch('/api/me/games', { credentials: 'same-origin' });
  if (!response.ok) return null;
  return (await response.json()) as MyGamesResponse;
}

export async function saveMyGames(games: GameSummary[]): Promise<MyGamesResponse> {
  const saved = await api.put<MyGamesResponse>(
    '/api/me/games',
    games.map((g) => g.id)
  );
  window.dispatchEvent(new CustomEvent(GAMES_UPDATED_EVENT));
  return saved;
}

export async function dismissGamesPrompt(): Promise<void> {
  await api.post('/api/me/games/prompt/dismiss');
}
