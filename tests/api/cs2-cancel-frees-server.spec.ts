import { test, expect } from '@playwright/test';
import { cs2Integration } from '../../api/src/integrations/cs2';
import { cs2ServerPool } from '../../api/src/integrations/cs2/allocation';
import { serverAllocationTracker } from '../../api/src/integrations/cs2/services/serverAllocationTracker';
import type { MatchContext } from '../../api/src/integrations/types';

/**
 * Ending a match on its server (tournament restart, reset, delete,
 * force-cancel) frees the server for the allocator. No API, no database: the
 * server commands are stubbed.
 *
 * @tag api
 */

const ctx = (resourceId: string) => ({ slug: 'r1m1', resourceId }) as unknown as MatchContext;

test.describe('CS2 cancel frees the server', () => {
  const original = {
    restart: cs2ServerPool.restartServerToEndMatch,
    end: cs2ServerPool.endMatchOnServer,
  };
  test.afterEach(() => {
    cs2ServerPool.restartServerToEndMatch = original.restart;
    cs2ServerPool.endMatchOnServer = original.end;
  });

  test('delete and force-cancel mark the server idle', async () => {
    cs2ServerPool.restartServerToEndMatch = async () => {};
    cs2ServerPool.endMatchOnServer = async () => {};

    serverAllocationTracker.markAllocated('srv-delete', 'r1m1');
    await cs2Integration.cancel!(ctx('srv-delete'), 'tournament-delete');
    expect(serverAllocationTracker.isBusy('srv-delete')).toBe(false);

    serverAllocationTracker.markAllocated('srv-force', 'r1m1');
    await cs2Integration.cancel!(ctx('srv-force'), 'force-cancel');
    expect(serverAllocationTracker.isBusy('srv-force')).toBe(false);
  });

  test('a server that could not be told stays busy', async () => {
    cs2ServerPool.restartServerToEndMatch = async () => {
      throw new Error('unreachable');
    };

    serverAllocationTracker.markAllocated('srv-down', 'r1m1');
    await expect(cs2Integration.cancel!(ctx('srv-down'), 'tournament-delete')).rejects.toThrow(
      'unreachable'
    );
    expect(serverAllocationTracker.isBusy('srv-down')).toBe(true);
  });
});
