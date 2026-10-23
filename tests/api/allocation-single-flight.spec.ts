import { test, expect } from '@playwright/test';
import { db } from '../../api/src/config/database';
import { scheduler } from '../../api/src/core/scheduler';
import { getIntegration } from '../../api/src/integrations/registry';

/**
 * Concurrent allocateSingleMatch callers for one match (availability trigger,
 * waiting sweep, polling tick) must share one allocation, not reserve one
 * server each.
 *
 * @tag api
 * @tag allocation
 */
const SLUG = `single-flight-${Date.now()}`;

test.afterAll(async () => {
  await db.runAsync('DELETE FROM matches WHERE slug = ?', [SLUG]);
});

test('two concurrent allocations of one match allocate once', { tag: ['@api'] }, async () => {
  await db.insertAsync('matches', {
    slug: SLUG,
    tournament_id: null,
    round: 0,
    match_number: 0,
    config: '{}',
    status: 'ready',
  });

  const integration = getIntegration('cs2');
  const original = { capacity: integration.capacity, allocate: integration.allocate };
  const allocated: string[] = [];
  integration.capacity = async () => 2;
  integration.allocate = async () => {
    const server = `fake-server-${allocated.length + 1}`;
    allocated.push(server);
    await new Promise((resolve) => setTimeout(resolve, 300));
    return { status: 'assigned', resourceId: server };
  };

  try {
    const [a, b] = await Promise.all([
      scheduler.allocateSingleMatch(SLUG, ''),
      scheduler.allocateSingleMatch(SLUG, ''),
    ]);
    expect(allocated).toHaveLength(1);
    expect(a.success).toBe(true);
    expect(b).toEqual(a);

    // The slot is free again once the allocation settled.
    const again = await scheduler.allocateSingleMatch(SLUG, '');
    expect(again.success).toBe(true);
    expect(allocated).toHaveLength(2);
  } finally {
    integration.capacity = original.capacity;
    integration.allocate = original.allocate;
  }
});

test(
  'a batch allocation and a single allocation of one match load it once',
  { tag: ['@api'] },
  async () => {
    const slug = `${SLUG}-batch`;
    const tournament = await db.insertAsync('tournament', {
      name: slug,
      type: 'single_elimination',
      format: 'bo1',
      status: 'setup',
      team_ids: '[]',
    });
    const tournamentId = Number(tournament.lastInsertRowid);
    await db.insertAsync('matches', {
      slug,
      tournament_id: tournamentId,
      round: 0,
      match_number: 0,
      config: '{}',
      status: 'ready',
    });

    const integration = getIntegration('cs2');
    const original = {
      capacity: integration.capacity,
      allocate: integration.allocate,
      allocateBatch: integration.allocateBatch,
      poolStatus: integration.poolStatus,
    };
    const loads: string[] = [];
    const load = async () => {
      loads.push(`fake-server-${loads.length + 1}`);
      await new Promise((resolve) => setTimeout(resolve, 300));
      return { status: 'assigned' as const, resourceId: loads[loads.length - 1] };
    };
    integration.capacity = async () => 2;
    integration.allocate = load;
    integration.poolStatus = undefined;
    integration.allocateBatch = async (ctxs) => Promise.all(ctxs.map(load));

    try {
      await Promise.all([
        scheduler.allocateSpecificMatches(tournamentId, [slug], ''),
        scheduler.allocateSingleMatch(slug, ''),
      ]);
      expect(loads).toHaveLength(1);
    } finally {
      integration.capacity = original.capacity;
      integration.allocate = original.allocate;
      integration.allocateBatch = original.allocateBatch;
      integration.poolStatus = original.poolStatus;
      await db.runAsync('DELETE FROM matches WHERE slug = ?', [slug]);
      await db.runAsync('DELETE FROM tournament WHERE id = ?', [tournamentId]);
    }
  }
);

test(
  'a single allocation joining a running batch allocation of one match loads it once',
  { tag: ['@api'] },
  async () => {
    const slug = `${SLUG}-batch-first`;
    const tournament = await db.insertAsync('tournament', {
      name: slug,
      type: 'single_elimination',
      format: 'bo1',
      status: 'setup',
      team_ids: '[]',
    });
    const tournamentId = Number(tournament.lastInsertRowid);
    await db.insertAsync('matches', {
      slug,
      tournament_id: tournamentId,
      round: 0,
      match_number: 0,
      config: '{}',
      status: 'ready',
    });

    const integration = getIntegration('cs2');
    const original = {
      capacity: integration.capacity,
      allocate: integration.allocate,
      allocateBatch: integration.allocateBatch,
      poolStatus: integration.poolStatus,
    };
    const loads: string[] = [];
    const load = async () => {
      loads.push(`fake-server-${loads.length + 1}`);
      await new Promise((resolve) => setTimeout(resolve, 300));
      return { status: 'assigned' as const, resourceId: loads[loads.length - 1] };
    };
    integration.capacity = async () => 2;
    integration.allocate = load;
    integration.poolStatus = undefined;
    integration.allocateBatch = async (ctxs) => Promise.all(ctxs.map(load));

    try {
      const batch = scheduler.allocateSpecificMatches(tournamentId, [slug], '');
      await new Promise((resolve) => setTimeout(resolve, 150));
      const single = await scheduler.allocateSingleMatch(slug, '');
      await batch;
      expect(single.success).toBe(true);
      expect(loads).toHaveLength(1);
    } finally {
      integration.capacity = original.capacity;
      integration.allocate = original.allocate;
      integration.allocateBatch = original.allocateBatch;
      integration.poolStatus = original.poolStatus;
      await db.runAsync('DELETE FROM matches WHERE slug = ?', [slug]);
      await db.runAsync('DELETE FROM tournament WHERE id = ?', [tournamentId]);
    }
  }
);
