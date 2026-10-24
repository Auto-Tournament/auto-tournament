import { test, expect } from '@playwright/test';
import { guarded } from '../../api/src/utils/guarded';

/**
 * A timer body that is still running when the next tick fires is skipped,
 * so a slow database does not stack up work.
 *
 * @tag api
 */
test('guarded skips a call while the previous one is running', { tag: ['@api'] }, async () => {
  let runs = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const tick = guarded(async () => {
    runs += 1;
    await gate;
  });
  const first = tick();
  await tick();
  await tick();
  expect(runs).toBe(1);
  release();
  await first;
  await tick();
  expect(runs).toBe(2);
});

test('guarded runs again after a failure', { tag: ['@api'] }, async () => {
  let runs = 0;
  const tick = guarded(async () => {
    runs += 1;
    throw new Error('boom');
  });
  await expect(tick()).rejects.toThrow('boom');
  await expect(tick()).rejects.toThrow('boom');
  expect(runs).toBe(2);
});
