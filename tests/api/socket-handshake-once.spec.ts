import { test, expect } from '@playwright/test';
import { nextOnce } from '../../api/src/services/socketService';

/**
 * A session store failing after the handshake answered is logged, not passed
 * to engine.io as a second response (which crashed the API).
 *
 * @tag api
 * @tag socket
 */

test('a handshake middleware reaches next once', { tag: ['@api', '@socket'] }, () => {
  const calls: unknown[] = [];
  const next = nextOnce((err) => calls.push(err));
  next();
  next(new Error('store down at commit'));
  expect(calls).toEqual([undefined]);
});
