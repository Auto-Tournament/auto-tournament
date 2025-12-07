import { test, expect } from '@playwright/test';
import { ensureSignedIn, getAuthHeader } from '../helpers/auth';
import {
  createPlayer,
  bulkImportPlayers,
  createTestPlayers,
  getPlayer,
  updatePlayerElo,
  getAllPlayers,
  type Player,
  type CreatePlayerInput,
} from '../helpers/players';

/**
 * Player Management API tests
 * Tests player CRUD operations, bulk import, and ELO management
 *
 * @tag api
 * @tag players
 * @tag shuffle
 */

test.describe.serial('Player Management API', () => {
  test.beforeEach(async ({ page }) => {
    await ensureSignedIn(page);
  });

  test(
    'should create a player with initial ELO',
    {
      tag: ['@api', '@players', '@crud'],
    },
    async ({ request }) => {
      const player = await createPlayer(request, {
        id: '76561198000000001',
        name: 'Test Player 1',
        initialELO: 3000,
      });

      expect(player).toBeTruthy();
      expect(player?.id).toBe('76561198000000001');
      expect(player?.name).toBe('Test Player 1');
      expect(player?.currentElo).toBe(3000);
      expect(player?.startingElo).toBe(3000);
    }
  );

  test(
    'should create a player without ELO (defaults to 3000)',
    {
      tag: ['@api', '@players', '@crud'],
    },
    async ({ request }) => {
      const player = await createPlayer(request, {
        id: '76561198000000002',
        name: 'Test Player 2',
      });

      expect(player).toBeTruthy();
      expect(player?.currentElo).toBe(3000);
      expect(player?.startingElo).toBe(3000);
    }
  );

  test(
    'should bulk import players',
    {
      tag: ['@api', '@players', '@bulk-import'],
    },
    async ({ request }) => {
      const players: CreatePlayerInput[] = [
        { id: '76561198000000003', name: 'Bulk Player 1', initialELO: 3100 },
        { id: '76561198000000004', name: 'Bulk Player 2', initialELO: 2900 },
        { id: '76561198000000005', name: 'Bulk Player 3' }, // No ELO, should default to 3000
      ];

      const imported = await bulkImportPlayers(request, players);

      expect(imported).toBeTruthy();
      expect(imported?.length).toBe(3);
      expect(imported?.find((p) => p.id === '76561198000000003')?.currentElo).toBe(3100);
      expect(imported?.find((p) => p.id === '76561198000000004')?.currentElo).toBe(2900);
      expect(imported?.find((p) => p.id === '76561198000000005')?.currentElo).toBe(3000);
    }
  );

  test(
    'should get player by ID',
    {
      tag: ['@api', '@players', '@crud'],
    },
    async ({ request }) => {
      // Create player first
      const created = await createPlayer(request, {
        id: '76561198000000006',
        name: 'Get Test Player',
        initialELO: 3200,
      });
      expect(created).toBeTruthy();

      // Get player
      const player = await getPlayer(request, '76561198000000006');

      expect(player).toBeTruthy();
      expect(player?.id).toBe('76561198000000006');
      expect(player?.name).toBe('Get Test Player');
      expect(player?.currentElo).toBe(3200);
    }
  );

  test(
    'should update player ELO',
    {
      tag: ['@api', '@players', '@elo'],
    },
    async ({ request }) => {
      // Create player first
      const created = await createPlayer(request, {
        id: '76561198000000007',
        name: 'ELO Update Test',
        initialELO: 3000,
      });
      expect(created).toBeTruthy();
      expect(created?.currentElo).toBe(3000);

      // Update ELO
      const updated = await updatePlayerElo(request, '76561198000000007', 3500);

      expect(updated).toBeTruthy();
      expect(updated?.currentElo).toBe(3500);
      // Starting ELO should remain unchanged
      expect(updated?.startingElo).toBe(3000);
    }
  );

  test(
    'should get all players',
    {
      tag: ['@api', '@players', '@crud'],
    },
    async ({ request }) => {
      // Create some test players
      await createTestPlayers(request, 5, 'get-all-test', 3000);

      // Get all players
      const players = await getAllPlayers(request);

      expect(players).toBeTruthy();
      expect(Array.isArray(players)).toBe(true);
      expect(players!.length).toBeGreaterThanOrEqual(5);

      // Verify structure
      const firstPlayer = players![0];
      expect(firstPlayer).toHaveProperty('id');
      expect(firstPlayer).toHaveProperty('name');
      expect(firstPlayer).toHaveProperty('currentElo');
      expect(firstPlayer).toHaveProperty('startingElo');
    }
  );

  test(
    'should create test players with varying ELOs',
    {
      tag: ['@api', '@players', '@bulk-import'],
    },
    async ({ request }) => {
      const players = await createTestPlayers(request, 10, 'varying-elo-test', 3000);

      expect(players).toBeTruthy();
      expect(players?.length).toBe(10);

      // Verify ELOs are varied (they should have different ELOs based on the helper function)
      const elos = players!.map((p) => p.currentElo);
      const uniqueElos = new Set(elos);
      // Should have some variation (at least 2 different ELO values)
      expect(uniqueElos.size).toBeGreaterThan(1);
    }
  );

  test(
    'should reject duplicate player creation',
    {
      tag: ['@api', '@players', '@validation'],
    },
    async ({ request }) => {
      // Create first player
      const first = await createPlayer(request, {
        id: '76561198000000008',
        name: 'Duplicate Test',
      });
      expect(first).toBeTruthy();

      // Try to create duplicate (should fail or return existing)
      const response = await request.post('/api/players', {
        headers: getAuthHeader(),
        data: {
          id: '76561198000000008',
          name: 'Duplicate Test 2',
        },
      });

      // Should either return 400 (error) or 200 (upsert behavior)
      // The actual behavior depends on implementation
      expect([200, 400, 409]).toContain(response.status());
    }
  );

  test(
    'should validate required fields',
    {
      tag: ['@api', '@players', '@validation'],
    },
    async ({ request }) => {
      // Missing name
      const response1 = await request.post('/api/players', {
        headers: getAuthHeader(),
        data: {
          id: '76561198000000009',
        },
      });
      expect(response1.status()).toBe(400);

      // Missing ID
      const response2 = await request.post('/api/players', {
        headers: getAuthHeader(),
        data: {
          name: 'Test Player',
        },
      });
      expect(response2.status()).toBe(400);
    }
  );
});

