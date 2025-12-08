import { test, expect } from '@playwright/test';
import { ensureSignedIn, getAuthHeader } from '../helpers/auth';
import { setupShuffleTournament, getStandings } from '../helpers/shuffleTournament';
import { createPlayer, getPlayer, type Player } from '../helpers/players';

/**
 * Public Pages API tests
 * Tests public endpoints that don't require authentication
 *
 * @tag api
 * @tag public
 * @tag shuffle
 * @tag leaderboard
 * @tag players
 */

test.describe.serial('Public Pages API', () => {
  let testPlayer: Player | null = null;
  let tournamentId: number = 1;

  test.beforeEach(async ({ page, request }) => {
    await ensureSignedIn(page);
  });

  test(
    'should provide public player page endpoint without authentication',
    {
      tag: ['@api', '@public', '@players'],
    },
    async ({ request }) => {
      // Create a test player
      const player = await createPlayer(request, {
        id: '76561198000000100',
        name: 'Public Player Test',
        initialELO: 3200,
      });
      expect(player).toBeTruthy();
      testPlayer = player!;

      // Get player without auth (public endpoint)
      const response = await request.get(`/api/players/${player!.id}`);
      expect(response.ok()).toBe(true);

      const data = await response.json();
      expect(data.player).toBeDefined();
      expect(data.player.id).toBe(player!.id);
      expect(data.player.name).toBe(player!.name);
      expect(data.player.currentElo).toBe(3200);
    }
  );

  test(
    'should provide player rating history endpoint (public)',
    {
      tag: ['@api', '@public', '@players', '@elo-history'],
    },
    async ({ request }) => {
      // Create a test player
      const player = await createPlayer(request, {
        id: '76561198000000101',
        name: 'History Test Player',
        initialELO: 3000,
      });
      expect(player).toBeTruthy();

      // Get rating history without auth (public endpoint)
      const response = await request.get(`/api/players/${player!.id}/rating-history`);
      expect(response.ok()).toBe(true);

      const data = await response.json();
      expect(data.history).toBeDefined();
      expect(Array.isArray(data.history)).toBe(true);
    }
  );

  test(
    'should provide player match history endpoint (public)',
    {
      tag: ['@api', '@public', '@players', '@match-history'],
    },
    async ({ request }) => {
      // Create a test player
      const player = await createPlayer(request, {
        id: '76561198000000102',
        name: 'Match History Test',
        initialELO: 3000,
      });
      expect(player).toBeTruthy();

      // Get match history without auth (public endpoint)
      const response = await request.get(`/api/players/${player!.id}/matches`);
      expect(response.ok()).toBe(true);

      const data = await response.json();
      expect(data.matches).toBeDefined();
      expect(Array.isArray(data.matches)).toBe(true);
    }
  );

  test(
    'should provide find player endpoint (public)',
    {
      tag: ['@api', '@public', '@players', '@search'],
    },
    async ({ request }) => {
      // Create a test player
      const player = await createPlayer(request, {
        id: '76561198000000103',
        name: 'Find Player Test',
        initialELO: 3000,
      });
      expect(player).toBeTruthy();

      // Find player by Steam ID (public endpoint)
      const response = await request.get(`/api/players/find?steamId=${player!.id}`);
      expect(response.ok()).toBe(true);

      const data = await response.json();
      expect(data.players).toBeDefined();
      expect(Array.isArray(data.players)).toBe(true);
      expect(data.players.length).toBeGreaterThan(0);
      expect(data.players.some((p: Player) => p.id === player!.id)).toBe(true);
    }
  );

  test(
    'should return 404 for non-existent player',
    {
      tag: ['@api', '@public', '@players'],
    },
    async ({ request }) => {
      const response = await request.get('/api/players/76561198999999999');
      expect(response.status()).toBe(404);
    }
  );

});

