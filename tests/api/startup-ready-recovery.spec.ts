import { test, expect } from '@playwright/test';
import { db } from '../../api/src/config/database';
import { getIntegration } from '../../api/src/integrations/registry';
import { releaseStrandedReadyMatches } from '../../api/src/services/matchRecoveryService';

/**
 * A match left `ready` with a server_id by a crash mid-allocation is released
 * at startup: its server is told to drop the match and the match can be
 * allocated again. Matches already loaded keep their server.
 *
 * @tag api
 */
const stamp = Date.now();
const SERVER = `ready-recovery-server-${stamp}`;
const READY = `ready-recovery-a-${stamp}`;
const LOADED = `ready-recovery-b-${stamp}`;

const serverOf = async (slug: string) =>
  (
    await db.queryOneAsync<{ server_id: string | null }>(
      'SELECT server_id FROM matches WHERE slug = ?',
      [slug]
    )
  )?.server_id ?? null;

const addMatch = (slug: string, status: string) =>
  db.insertAsync('matches', {
    slug,
    tournament_id: null,
    round: 0,
    match_number: 0,
    config: '{}',
    status,
    server_id: SERVER,
  });

test.beforeAll(async () => {
  await db.insertAsync('cs2_servers', {
    id: SERVER,
    name: SERVER,
    host: '127.0.0.1',
    port: 27015,
    password: 'x',
  });
});

test.afterAll(async () => {
  await db.runAsync('DELETE FROM matches WHERE slug IN (?, ?)', [READY, LOADED]);
  await db.runAsync('DELETE FROM cs2_servers WHERE id = ?', [SERVER]);
});

test(
  'a ready match left on a server is released and its server told to drop it',
  { tag: ['@api'] },
  async () => {
    await addMatch(READY, 'ready');
    await addMatch(LOADED, 'loaded');
    const integration = getIntegration('cs2');
    const original = integration.cancel;
    const cancelled: Array<{ slug: string; resourceId?: string | null }> = [];
    integration.cancel = async (ctx) => {
      cancelled.push({ slug: ctx.slug, resourceId: ctx.resourceId });
    };
    try {
      await releaseStrandedReadyMatches();
    } finally {
      integration.cancel = original;
    }
    expect(await serverOf(READY)).toBeNull();
    expect(await serverOf(LOADED)).toBe(SERVER);
    expect(cancelled).toContainEqual({ slug: READY, resourceId: SERVER });
    expect(cancelled.map((c) => c.slug)).not.toContain(LOADED);
  }
);

test('a server that cannot be told still releases the match', { tag: ['@api'] }, async () => {
  await db.runAsync('UPDATE matches SET status = ?, server_id = ? WHERE slug = ?', [
    'ready',
    SERVER,
    READY,
  ]);
  const integration = getIntegration('cs2');
  const original = integration.cancel;
  integration.cancel = async () => {
    throw new Error('server offline');
  };
  try {
    await releaseStrandedReadyMatches();
  } finally {
    integration.cancel = original;
  }
  expect(await serverOf(READY)).toBeNull();
});
