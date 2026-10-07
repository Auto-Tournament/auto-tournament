/**
 * The tournament rating, one per player per game (`player_game_ratings`).
 *
 * A CS2 result never moves a player's rating in another game. A player with
 * no row for a game stands at their seed (`players.starting_elo`, what an
 * admin or an import gave them) with a new player's uncertainty; the row is
 * written by their first rated match in that game, or by an admin setting it.
 */

import { db } from '../config/database';
import { DEFAULT_GAME } from '../integrations/types';
import { eloToOpenSkill } from '../utils/ratingMath';

export interface GameRating {
  /** The rating shown (OpenSkill ordinal, scaled; stat adjustments included). */
  elo: number;
  mu: number;
  sigma: number;
  /** Rated matches in this game. */
  matchCount: number;
  /** False while the player has no rated match or set rating in this game: the seed. */
  rated: boolean;
}

/** The key a game's ratings are stored under: the match's or tournament's `game`, lowercased. */
export function ratingGame(game: string | null | undefined): string {
  const key = (game ?? '').trim().toLowerCase();
  return key || DEFAULT_GAME;
}

function seedRating(startingElo: number): GameRating {
  const skill = eloToOpenSkill(startingElo, 0);
  return { elo: startingElo, mu: skill.mu, sigma: skill.sigma, matchCount: 0, rated: false };
}

/**
 * The SQL for a player's rating in one game, for queries that list players:
 * join `ratingJoin('p')` with the game as its parameter and select
 * `${RATING_ELO} AS current_elo`.
 */
export const ratingJoin = (playerAlias: string) =>
  `LEFT JOIN player_game_ratings pgr ON pgr.player_id = ${playerAlias}.id AND pgr.game = ?`;
export const RATING_ELO = 'COALESCE(pgr.current_elo, p.starting_elo)';

/**
 * For a `SELECT p.*` over players: `main_elo` and `main_game`, the player's
 * rating in the game they have played most (null while they are unrated).
 */
export const MAIN_RATING_SQL = `(SELECT g.current_elo FROM player_game_ratings g WHERE g.player_id = p.id
    ORDER BY g.match_count DESC, g.updated_at DESC LIMIT 1) AS main_elo,
  (SELECT g.game FROM player_game_ratings g WHERE g.player_id = p.id
    ORDER BY g.match_count DESC, g.updated_at DESC LIMIT 1) AS main_game`;

/** Each player's rating in `game` (players that do not exist are left out). */
export async function getGameRatings(playerIds: string[], game: string | null | undefined): Promise<Map<string, GameRating>> {
  const out = new Map<string, GameRating>();
  if (playerIds.length === 0) return out;
  const rows = await db.queryAsync<{
    id: string;
    starting_elo: number;
    current_elo: number | null;
    openskill_mu: number | null;
    openskill_sigma: number | null;
    match_count: number | null;
  }>(
    `SELECT p.id, p.starting_elo, pgr.current_elo, pgr.openskill_mu, pgr.openskill_sigma, pgr.match_count
       FROM players p
       ${ratingJoin('p')}
      WHERE p.id = ANY(?::text[])`,
    [ratingGame(game), playerIds]
  );
  for (const r of rows) {
    out.set(
      r.id,
      r.current_elo == null
        ? seedRating(Number(r.starting_elo))
        : {
            elo: Number(r.current_elo),
            mu: Number(r.openskill_mu),
            sigma: Number(r.openskill_sigma),
            matchCount: Number(r.match_count ?? 0),
            rated: true,
          }
    );
  }
  return out;
}

/** One player's rating in `game`, or null when there is no such player. */
export async function getGameRating(playerId: string, game: string | null | undefined): Promise<GameRating | null> {
  return (await getGameRatings([playerId], game)).get(playerId) ?? null;
}

/** Write a player's rating in `game`. */
export async function setGameRating(
  playerId: string,
  game: string | null | undefined,
  value: { elo: number; mu: number; sigma: number; matchCount: number }
): Promise<void> {
  await db.runAsync(
    `INSERT INTO player_game_ratings (player_id, game, current_elo, openskill_mu, openskill_sigma, match_count, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (player_id, game) DO UPDATE
       SET current_elo = EXCLUDED.current_elo, openskill_mu = EXCLUDED.openskill_mu,
           openskill_sigma = EXCLUDED.openskill_sigma, match_count = EXCLUDED.match_count,
           updated_at = EXCLUDED.updated_at`,
    [playerId, ratingGame(game), Math.round(value.elo), value.mu, value.sigma, Math.max(0, value.matchCount), Math.floor(Date.now() / 1000)]
  );
}

/** Every game a player has a rating in, most-played first. */
export async function getPlayerGameRatings(
  playerId: string
): Promise<Array<{ game: string; elo: number; matchCount: number }>> {
  const rows = await db.queryAsync<{ game: string; current_elo: number; match_count: number }>(
    `SELECT game, current_elo, match_count FROM player_game_ratings
      WHERE player_id = ? ORDER BY match_count DESC, updated_at DESC`,
    [playerId]
  );
  return rows.map((r) => ({ game: r.game, elo: Number(r.current_elo), matchCount: Number(r.match_count) }));
}
