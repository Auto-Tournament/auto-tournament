import { test, expect } from '@playwright/test';
import { trustProxyHopsFrom } from '../../api/src/config/trustProxy';

/**
 * TRUST_PROXY_HOPS (config/trustProxy.ts): how many reverse proxies Express's
 * `trust proxy` and the fleet gateway's peer address trust. Default 1.
 *
 * @tag api
 */

test.describe('trust proxy hops (no server)', () => {
  test('unset or blank is 1', () => {
    expect(trustProxyHopsFrom(undefined)).toBe(1);
    expect(trustProxyHopsFrom('')).toBe(1);
    expect(trustProxyHopsFrom('  ')).toBe(1);
  });

  test('a whole number of hops, 0 included', () => {
    expect(trustProxyHopsFrom('0')).toBe(0);
    expect(trustProxyHopsFrom('2')).toBe(2);
    expect(trustProxyHopsFrom(' 3 ')).toBe(3);
  });

  test('anything else falls back to 1', () => {
    for (const bad of ['-1', '1.5', 'two', 'true', '1e3x'])
      expect(trustProxyHopsFrom(bad), bad).toBe(1);
  });
});
