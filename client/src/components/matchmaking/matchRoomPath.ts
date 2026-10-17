/**
 * Where a match is played from. A matchmaking match (`mm-…`) has its room at
 * `/play/<lobbyId>`, not the tournament match page; the lobby comes from the
 * player's own matchmaking state, the same one MatchmakingOverlay uses to open
 * the room after a full reload. Any other match (or a matchmaking match that
 * is not the player's lobby) is `/match/<slug>`.
 */
import { matchPagePath, playLobbyPath } from '../../paths';
import { useMatchmaking } from './matchmakingStore';

type OwnLobby = { id: string; matchSlug: string | null } | null | undefined;

export function matchRoomPath(slug: string, lobby: OwnLobby): string {
  if (slug.startsWith('mm-') && lobby?.matchSlug === slug) return playLobbyPath(lobby.id);
  return matchPagePath(slug);
}

/** `matchRoomPath` with the signed-in player's lobby. */
export function useMatchRoomPath(slug: string): string;
export function useMatchRoomPath(slug: string | null | undefined): string | null;
export function useMatchRoomPath(slug: string | null | undefined): string | null {
  const { me } = useMatchmaking();
  return slug ? matchRoomPath(slug, me?.lobby) : null;
}
