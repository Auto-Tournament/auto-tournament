import { test, expect } from '@playwright/test';
import { db } from '../../api/src/config/database';

/**
 * A deleted player is a tombstone ("Deleted player") kept for the match rows
 * (services/playerModeration.ts): GET /api/leaderboard leaves them out.
 *
 * @tag api
 */

test('the leaderboard leaves deleted players out', { tag: ['@api'] }, async ({ request }) => {
  const stamp = `${Date.now()}`.slice(-9);
  const game = `lbtest${stamp}`;
  const live = `7656119${stamp}01`.slice(0, 17);
  const gone = `7656119${stamp}02`.slice(0, 17);
  for (const [id, name] of [
    [live, 'Still here'],
    [gone, 'Deleted player'],
  ]) {
    await db.runAsync('INSERT INTO players (id, name) VALUES (?, ?)', [id, name]);
    await db.runAsync(
      `INSERT INTO player_game_ratings (player_id, game, current_elo, openskill_mu, openskill_sigma, match_count, updated_at)
       VALUES (?, ?, ?, 25, 8, 3, EXTRACT(EPOCH FROM NOW())::INTEGER)`,
      [id, game, id === gone ? 3000 : 1600]
    );
  }
  await db.runAsync(
    'UPDATE players SET deleted_at = EXTRACT(EPOCH FROM NOW())::INTEGER WHERE id = ?',
    [gone]
  );
  try {
    const res = await request.get(`/api/leaderboard?game=${game}`);
    expect(res.ok()).toBe(true);
    const body = (await res.json()) as {
      players: Array<{ id: string }>;
      games: Array<{ id: string; players: number }>;
    };
    expect(body.players.map((p) => p.id)).toEqual([live]);
    expect(body.games.find((g) => g.id === game)?.players).toBe(1);
  } finally {
    await db.runAsync('DELETE FROM players WHERE id IN (?, ?)', [live, gone]);
  }
});
