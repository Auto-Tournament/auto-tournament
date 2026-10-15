import { test, expect } from '@playwright/test';
import { withVetoLock } from '../../api/src/integrations/cs2/veto/lock';

/** One veto change at a time per match (veto/lock.ts): a second click waits for the first. */
test.describe('Veto lock', () => {
  test('runs a match in order, other matches alongside', async () => {
    const order: string[] = [];
    const slow = (tag: string, ms: number) => async () => {
      order.push(`${tag} start`);
      await new Promise((r) => setTimeout(r, ms));
      order.push(`${tag} end`);
      return tag;
    };
    const results = await Promise.all([
      withVetoLock('m1', slow('a', 30)),
      withVetoLock('m1', slow('b', 1)),
      withVetoLock('m2', slow('c', 1)),
    ]);
    expect(results).toEqual(['a', 'b', 'c']);
    expect(order.indexOf('b start')).toBeGreaterThan(order.indexOf('a end'));
    expect(order.indexOf('c end')).toBeLessThan(order.indexOf('a end'));
  });

  test('a failed change does not block the next one', async () => {
    await expect(
      withVetoLock('m3', async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    await expect(withVetoLock('m3', async () => 'ok')).resolves.toBe('ok');
  });
});
