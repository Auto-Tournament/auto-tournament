import { test, expect } from '@playwright/test';
import { bridgedModuleNames, installHostBridge } from '../../api/src/modules/hostBridge';
import { HOST_GLOBAL, HOST_MODULES } from '../../api/src/modules/hostModules';
import * as logger from '../../api/src/utils/logger';
import * as database from '../../api/src/config/database';

/**
 * The host bridge (DESIGN-modules §10.3): how a code module's server half,
 * bundled on its own, reaches the platform's live core modules instead of
 * second copies of them. CS2 is built against it (scripts/modules/cs2/build.ts
 * refuses a core import the bridge does not export).
 *
 * In process: the list the build checks against and the modules the bridge
 * actually hands out must be the same, and what it hands out must be the
 * platform's own instances.
 *
 * @tag api
 * @tag modules
 */

interface Bridge {
  serverApi: string;
  module(name: string): Record<string, unknown>;
}

test.describe('Host bridge', () => {
  test('exports exactly the modules the build allows', () => {
    expect(bridgedModuleNames()).toEqual([...HOST_MODULES].sort());
  });

  test("hands out the platform's own instances, as live getters", () => {
    installHostBridge();
    const bridge = (globalThis as unknown as Record<string, Bridge>)[HOST_GLOBAL];
    expect(bridge.serverApi).toMatch(/^\d+\.\d+\.\d+$/);

    const bridgedLogger = bridge.module('utils/logger');
    expect(bridgedLogger.__esModule).toBe(true);
    expect(bridgedLogger.log).toBe(logger.log);
    expect(bridge.module('config/database').db).toBe(database.db);
    // The same view each time, and nobody can change it.
    expect(bridge.module('utils/logger')).toBe(bridgedLogger);
    expect(Object.isFrozen(bridgedLogger)).toBe(true);
  });

  test('refuses a core module it does not share', () => {
    installHostBridge();
    const bridge = (globalThis as unknown as Record<string, Bridge>)[HOST_GLOBAL];
    expect(() => bridge.module('services/steamService')).toThrow(/does not share with modules/);
    expect(() => bridge.module('../../etc/passwd')).toThrow(/does not share with modules/);
  });
});
