/**
 * Match Recovery Service
 * Recovers match state on application startup by syncing with game servers
 * Ensures the system can catch up after a restart during live tournaments
 */

import { db } from '../config/database';
import { log } from '../utils/logger';
import { rconService } from './rconService';
import { refreshConnectionsFromServer, fetchMatchReport, applyMatchReport } from './connectionSnapshotService';
import {
  getMatchZyWebhookCommands,
  getMatchZyDemoUploadCommand,
  getMatchZyDemoUploadCommands,
} from '../utils/matchzyRconCommands';
import { settingsService } from './settingsService';
import type { DbMatchRow } from '../types/database.types';

export interface RecoveryResult {
  matchSlug: string;
  success: boolean;
  stateSynced: boolean;
  webhookReconfigured: boolean;
  demoReconfigured: boolean;
  error?: string;
}

/**
 * Recover all active matches on startup
 * Syncs match state from servers and reconfigures webhooks/demos
 */
export async function recoverActiveMatches(): Promise<RecoveryResult[]> {
  log.info('[Recovery] Starting match recovery on startup...');

  try {
    // Find all matches that are loaded or live
    const activeMatches = await db.queryAsync<DbMatchRow>(
      `SELECT * FROM matches 
       WHERE status IN ('loaded', 'live') 
       AND server_id IS NOT NULL
       ORDER BY loaded_at DESC`
    );

    if (activeMatches.length === 0) {
      log.info('[Recovery] No active matches found to recover');
      return [];
    }

    log.info(`[Recovery] Found ${activeMatches.length} active match(es) to recover`);

    const results: RecoveryResult[] = [];

    // Get webhook base URL for reconfiguration
    const baseUrl = await settingsService.getSetting('webhook_url');
    const serverToken = process.env.SERVER_TOKEN || '';

    for (const match of activeMatches) {
      const result = await recoverMatch(match, baseUrl, serverToken);
      results.push(result);
    }

    const successful = results.filter((r) => r.success).length;
    log.success(
      `[Recovery] Recovery complete: ${successful}/${results.length} matches recovered successfully`
    );

    return results;
  } catch (error) {
    log.error('[Recovery] Failed to recover active matches', error as Error);
    return [];
  }
}

/**
 * Recover a single match
 */
async function recoverMatch(
  match: DbMatchRow,
  baseUrl: string | null,
  serverToken: string
): Promise<RecoveryResult> {
  const result: RecoveryResult = {
    matchSlug: match.slug,
    success: false,
    stateSynced: false,
    webhookReconfigured: false,
    demoReconfigured: false,
  };

  try {
    if (!match.server_id) {
      result.error = 'No server assigned';
      log.warn(`[Recovery] Match ${match.slug} has no server assigned`);
      return result;
    }

    log.info(`[Recovery] Recovering match ${match.slug} on server ${match.server_id}`);

    // 1. Sync match state from server (fetch match report)
    try {
      const report = await fetchMatchReport(match.server_id);
      if (report) {
        await applyMatchReport(match.slug, report);
        result.stateSynced = true;
        log.success(`[Recovery] Synced match state for ${match.slug}`, {
          map: report.match?.map?.name,
          phase: report.match?.phase,
          score: report.match?.score,
        });
      } else {
        log.warn(`[Recovery] Could not fetch match report for ${match.slug}`, {
          serverId: match.server_id,
        });
      }
    } catch (syncError) {
      log.warn(`[Recovery] Failed to sync match state for ${match.slug}`, {
        error: syncError instanceof Error ? syncError.message : String(syncError),
      });
    }

    // 2. Reconfigure webhook and demo upload (if baseUrl is configured)
    if (baseUrl && serverToken) {
      try {
        // Reconfigure webhook
        const webhookCommands = getMatchZyWebhookCommands(baseUrl, serverToken, match.slug);
        let webhookSuccess = true;
        for (const cmd of webhookCommands) {
          const cmdResult = await rconService.sendCommand(match.server_id, cmd);
          if (!cmdResult.success) {
            webhookSuccess = false;
            log.warn(`[Recovery] Failed to reconfigure webhook for ${match.slug}`, {
              command: cmd,
              error: cmdResult.error,
            });
          }
        }
        if (webhookSuccess) {
          result.webhookReconfigured = true;
          log.success(`[Recovery] Reconfigured webhook for ${match.slug}`);
        }

        // Reconfigure demo upload (with headers for authentication)
        const demoUploadCommands = getMatchZyDemoUploadCommands(baseUrl, match.slug, serverToken);
        let demoSuccess = true;
        for (const cmd of demoUploadCommands) {
          const cmdResult = await rconService.sendCommand(match.server_id, cmd);
          if (!cmdResult.success) {
            demoSuccess = false;
            log.warn(`[Recovery] Failed to reconfigure demo upload for ${match.slug}`, {
              command: cmd,
              error: cmdResult.error,
            });
          }
        }
        if (demoSuccess) {
          result.demoReconfigured = true;
          log.success(`[Recovery] Reconfigured demo upload for ${match.slug}`);
        }
      } catch (reconfigError) {
        log.warn(`[Recovery] Failed to reconfigure webhook/demo for ${match.slug}`, {
          error: reconfigError instanceof Error ? reconfigError.message : String(reconfigError),
        });
      }
    } else {
      log.warn(`[Recovery] Skipping webhook/demo reconfiguration for ${match.slug}`, {
        reason: !baseUrl ? 'Webhook URL not configured' : 'SERVER_TOKEN not set',
      });
    }

    // 3. Refresh player connections
    try {
      await refreshConnectionsFromServer(match.slug, { force: true });
      log.debug(`[Recovery] Refreshed player connections for ${match.slug}`);
    } catch (connError) {
      log.warn(`[Recovery] Failed to refresh connections for ${match.slug}`, {
        error: connError instanceof Error ? connError.message : String(connError),
      });
    }

    result.success = true;
    log.success(`[Recovery] Successfully recovered match ${match.slug}`, {
      stateSynced: result.stateSynced,
      webhookReconfigured: result.webhookReconfigured,
      demoReconfigured: result.demoReconfigured,
    });
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    log.error(`[Recovery] Failed to recover match ${match.slug}`, error as Error);
  }

  return result;
}

/**
 * Replay recent events from database for a match
 * Useful for catching up on events that occurred during downtime
 */
export async function replayRecentEvents(matchSlug: string, sinceTimestamp?: number): Promise<void> {
  try {
    const since = sinceTimestamp || Math.floor(Date.now() / 1000) - 3600; // Default: last hour

    const events = await db.queryAsync<{
      event_type: string;
      event_data: string;
      received_at: number;
    }>(
      `SELECT event_type, event_data, received_at 
       FROM match_events 
       WHERE match_slug = ? AND received_at >= ?
       ORDER BY received_at ASC`,
      [matchSlug, since]
    );

    if (events.length === 0) {
      log.debug(`[Recovery] No recent events to replay for ${matchSlug}`);
      return;
    }

    log.info(`[Recovery] Replaying ${events.length} recent event(s) for ${matchSlug}`);

    // Import handler dynamically to avoid circular dependencies
    const { handleMatchEvent } = await import('./matchEventHandler');

    for (const eventRow of events) {
      try {
        const event = JSON.parse(eventRow.event_data);
        await handleMatchEvent(event);
        log.debug(`[Recovery] Replayed event: ${eventRow.event_type}`, {
          matchSlug,
          timestamp: eventRow.received_at,
        });
      } catch (parseError) {
        log.warn(`[Recovery] Failed to replay event for ${matchSlug}`, {
          eventType: eventRow.event_type,
          error: parseError instanceof Error ? parseError.message : String(parseError),
        });
      }
    }

    log.success(`[Recovery] Finished replaying events for ${matchSlug}`);
  } catch (error) {
    log.error(`[Recovery] Failed to replay events for ${matchSlug}`, error as Error);
  }
}

