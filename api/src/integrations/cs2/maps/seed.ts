/**
 * CS2 default data: the map catalogue and the default map pools.
 *
 * Run through `GameIntegration.seed` after the core schema is created or
 * migrated (every API start, and after a database reset). It applies the
 * maps.json copy bundled with the module (./mapCatalog), with no network, so
 * a fresh database has its maps and the Active Duty pool at once and a start
 * never waits on GitHub. The live maps.json follows in the background once the
 * module has started, and daily (./autoSync). ./mapSync adds what is new and
 * keeps the platform's own maps and pools current, never what an admin made
 * or edited.
 */

import { log } from '../../../utils/logger';
import type { SeedClient } from '../../types';
import { bundledMapCatalog } from './mapCatalog';
import { syncCs2Maps } from './mapSync';

export async function seedCs2Maps(client: SeedClient): Promise<void> {
  try {
    await syncCs2Maps(client, bundledMapCatalog(), 'auto', 'bundled');
  } catch (err) {
    // The application still runs without the defaults: maps can be added by
    // hand or synced later from the Maps page.
    log.warn(`[CS2 maps] Could not seed the maps and default pools: ${(err as Error).message}`);
  }
}
