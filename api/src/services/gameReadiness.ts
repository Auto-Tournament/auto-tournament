/**
 * Is a player set up to play a game here: the game on their profile
 * (player_games) and the account the game needs (the integration's
 * `accountProvider`, CS2: Steam). Matchmaking checks it before a party
 * searches and before an invite; who may invite whom is the player's own
 * setting (players.party_invites_from).
 */
import { db } from '../config/database';
import { builtinGames } from './gameCatalogService';
import { getIntegration, hasIntegration } from '../integrations/registry';

export type Missing = 'game' | 'account';
export type InvitePolicy = 'everyone' | 'friends' | 'nobody';
export const INVITE_POLICIES: InvitePolicy[] = ['everyone', 'friends', 'nobody'];

/** The `games` row id of a game (an integration id or a slug), or null when the catalogue has none. */
export async function gameRowId(game: string | null | undefined): Promise<number | null> {
  const ref = game || 'cs2';
  const builtin = builtinGames().find((g) => g.integrationId === ref || g.slug === ref);
  const slug = builtin?.slug ?? ref;
  const row = await db.queryOneAsync<{ id: number }>('SELECT id FROM games WHERE slug = ?', [slug]);
  return row?.id ?? null;
}

export function gameName(game: string): string {
  try {
    return hasIntegration(game) ? getIntegration(game).displayName : game;
  } catch {
    return game;
  }
}

/** What each of these players still lacks for `game` (absent = ready). */
export async function missingForGame(
  playerIds: string[],
  game: string
): Promise<Map<string, Missing>> {
  const out = new Map<string, Missing>();
  if (playerIds.length === 0) return out;
  const marks = playerIds.map(() => '?').join(', ');
  const gameId = await gameRowId(game);
  if (gameId !== null) {
    const rows = await db.queryAsync<{ id: string; has_game: boolean }>(
      `SELECT p.id, (pg.player_uid IS NOT NULL) AS has_game FROM players p
         LEFT JOIN player_games pg ON pg.player_uid = p.uid AND pg.game_id = ?
        WHERE p.id IN (${marks})`,
      [gameId, ...playerIds]
    );
    for (const r of rows) if (!r.has_game) out.set(r.id, 'game');
  }
  let provider: string | undefined;
  try {
    provider = hasIntegration(game) ? getIntegration(game).accountProvider : undefined;
  } catch {
    provider = undefined;
  }
  if (provider) {
    const linked = new Set(
      (
        await db.queryAsync<{ player_id: string }>(
          `SELECT player_id FROM linked_accounts WHERE provider = ? AND verified AND player_id IN (${marks})`,
          [provider, ...playerIds]
        )
      ).map((r) => r.player_id)
    );
    for (const id of playerIds) {
      // A player's id is their Steam ID: signing in with Steam made the account.
      const viaSteamId = provider === 'steam' && /^7656\d{13}$/.test(id);
      if (!linked.has(id) && !viaSteamId && !out.has(id)) out.set(id, 'account');
    }
  }
  return out;
}

export async function invitePolicy(playerId: string): Promise<InvitePolicy> {
  const row = await db.queryOneAsync<{ party_invites_from: string | null }>(
    'SELECT party_invites_from FROM players WHERE id = ?',
    [playerId]
  );
  const value = row?.party_invites_from;
  return value === 'friends' || value === 'nobody' ? value : 'everyone';
}

/**
 * Whether `fromId` may invite `toId` to a party for `game`: true, or why not
 * ('nobody', 'friends' = friends only, 'no_game' = the game is not on their profile).
 */
export async function canInvite(
  fromId: string,
  toId: string,
  game: string
): Promise<true | 'nobody' | 'friends' | 'no_game'> {
  const policy = await invitePolicy(toId);
  if (policy === 'nobody') return 'nobody';
  if (policy === 'friends') {
    const friend = await db.queryOneAsync(
      'SELECT 1 FROM friendships WHERE player_id = ? AND friend_id = ?',
      [toId, fromId]
    );
    if (!friend) return 'friends';
  }
  const missing = await missingForGame([toId], game);
  return missing.get(toId) === 'game' ? 'no_game' : true;
}

/**
 * Players who played `game` (a match, an imported demo) play it: it goes on
 * the profile of each who has no games yet, so "What do you play?" is
 * answered for them. A player who picked their games keeps their pick.
 */
export async function addPlayedGame(steamIds: string[], game: string): Promise<number> {
  const ids = [...new Set(steamIds.filter(Boolean))];
  if (ids.length === 0) return 0;
  const gameId = await gameRowId(game);
  if (gameId === null) return 0;
  const rows = await db.queryAsync<{ player_uid: string }>(
    `INSERT INTO player_games (player_uid, game_id, created_at)
     SELECT p.uid, ?, ? FROM players p
      WHERE p.id = ANY(?::text[]) AND p.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM player_games x WHERE x.player_uid = p.uid)
     ON CONFLICT DO NOTHING
     RETURNING player_uid`,
    [gameId, Math.floor(Date.now() / 1000), ids]
  );
  return rows.length;
}

/** Once at start: everyone with a played match and no games gets that match's game. */
export async function backfillPlayedGames(): Promise<number> {
  const rows = await db.queryAsync<{ player_id: string; game: string }>(
    `SELECT DISTINCT s.player_id, m.game
       FROM player_match_stats s
       JOIN matches m ON m.slug = s.match_slug
       JOIN players p ON p.id = s.player_id
      WHERE NOT EXISTS (SELECT 1 FROM player_games x WHERE x.player_uid = p.uid)`
  );
  const byGame = new Map<string, string[]>();
  for (const r of rows) byGame.set(r.game, [...(byGame.get(r.game) ?? []), r.player_id]);
  let added = 0;
  for (const [game, ids] of byGame) added += await addPlayedGame(ids, game);
  return added;
}
