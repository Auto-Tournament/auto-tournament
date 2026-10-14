/**
 * Matches that are gone (their tournament was deleted or reset) leave nothing
 * keyed by their slug behind. Slugs come back: a reset regenerates t5-r1m1,
 * and a deleted tournament's id goes to the next one. Without this the new
 * t5-r1m1 showed the old one's highlights, map scores and live state.
 *
 * Tables with a foreign key to `matches` (events, map results, stats,
 * reports) go with the match rows; this clears the rest, and each game
 * clears its own (`GameIntegration.forgetMatches`). Logs about the servers
 * and webhook deliveries stay.
 */

import { db } from '../config/database';
import { listIntegrations } from '../integrations/registry';
import { log } from '../utils/logger';
import { matchLiveStatsService } from './matchLiveStatsService';

const CORE_TABLES = ['commends', 'admin_calls', 'webhook_match_state'];

export async function forgetMatches(slugs: string[]): Promise<void> {
  if (slugs.length === 0) return;
  for (const slug of slugs) matchLiveStatsService.clear(slug);
  const list = slugs.map(() => '?').join(', ');
  for (const table of CORE_TABLES) {
    await db.runAsync(`DELETE FROM ${table} WHERE match_slug IN (${list})`, slugs);
  }
  for (const integration of listIntegrations()) {
    if (!integration.forgetMatches) continue;
    try {
      await integration.forgetMatches(slugs);
    } catch (error) {
      log.warn('[MATCHES] A game could not forget gone matches', {
        game: integration.id,
        error: (error as Error).message,
      });
    }
  }
}
