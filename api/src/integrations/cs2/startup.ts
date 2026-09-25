/**
 * CS2 startup work and background jobs, run through `cs2Integration.start()`
 * and `stop()`.
 *
 * Moved from `index.ts` unchanged: configure the Auto Tournament CS2 webhook on every
 * enabled server that needs it, then fetch the latest plugin version and start
 * the server health monitor (which also runs the CS2 fleet/update checks).
 */

import { log } from '../../utils/logger';
import { settingsService } from '../../services/settingsService';
import { serverService } from './services/serverService';
import { rconService } from './services/rconService';
import { serverInitializationService } from './services/serverInitializationService';
import { initPluginVersionService } from './services/pluginVersionService';
import { healthMonitoringService } from './services/healthMonitoringService';
import { startMapAutoSync, stopMapAutoSync } from './maps/autoSync';

export async function startCs2(): Promise<void> {
  await bootstrapServerWebhooks().catch((error) => {
    log.warn('Failed to auto-configure server webhooks on startup', { error });
  });

  // Fetch latest Auto Tournament CS2 version (fire-and-forget, cached for 1 hour)
  initPluginVersionService();

  // Start health monitoring for server tracking
  // Checks every minute to mark inactive servers as offline
  healthMonitoringService.start();

  // New maps and Active Duty changes from maps.json: now in the background, then daily.
  startMapAutoSync();
}

export function stopCs2(): void {
  healthMonitoringService.stop();
  stopMapAutoSync();
}

async function bootstrapServerWebhooks(): Promise<void> {
  const serverToken = process.env.SERVER_TOKEN;
  if (!serverToken) {
    log.warn('SERVER_TOKEN is not set. Skipping automatic webhook bootstrap.');
    return;
  }

  // Resolve webhook base URL from settings.
  // Priority: 1) DB, 2) API_BASE_URL, 3) FRONTEND_BASE_URL, 4) http://localhost:{PORT}
  const apiPort = parseInt(process.env.PORT || '3000', 10);
  const localhostDefault = `http://localhost:${apiPort}`;
  let baseUrl = await settingsService.getWebhookUrl();

  const fromApi = process.env.API_BASE_URL?.trim();
  const fromFrontend = process.env.FRONTEND_BASE_URL?.trim();

  // If DB has localhost:PORT but FRONTEND_BASE_URL is set, treat as "wrong default" and fix it.
  if (
    baseUrl &&
    (baseUrl === localhostDefault || baseUrl === 'http://localhost:3000') &&
    fromFrontend &&
    !fromApi
  ) {
    try {
      await settingsService.setSetting('webhook_url', fromFrontend);
      baseUrl = await settingsService.getWebhookUrl();
      log.success(`Webhook URL updated from localhost default to FRONTEND_BASE_URL: ${baseUrl}`);
    } catch (e) {
      log.warn('Failed to update webhook URL from FRONTEND_BASE_URL', { error: e });
    }
  }

  if (!baseUrl) {
    const fallback = fromApi || fromFrontend || localhostDefault;
    const source = fromApi ? 'API_BASE_URL' : fromFrontend ? 'FRONTEND_BASE_URL' : 'auto-detect (PORT)';
    try {
      await settingsService.setSetting('webhook_url', fallback);
      baseUrl = await settingsService.getWebhookUrl();
      log.success(`Webhook URL initialized from ${source}: ${baseUrl}`);
      if (source === 'auto-detect (PORT)') {
        log.warn(
          'Webhook URL was not configured; auto-detected from PORT. ' +
            'Set API_BASE_URL or FRONTEND_BASE_URL in .env, or update in Settings, if your API is elsewhere.'
        );
      }
    } catch (error) {
      log.warn(
        'Failed to set webhook URL; skipping automatic webhook bootstrap. ' +
          'Set API_BASE_URL or FRONTEND_BASE_URL in .env or configure in Settings.',
        { error }
      );
      return;
    }
  }

  const enabledServers = await serverService.getAllServers(true);
  if (enabledServers.length === 0) {
    log.info('No enabled servers found for webhook bootstrap.');
    return;
  }

  log.info(`[STARTUP] Checking ${enabledServers.length} enabled server(s)...`);

  // Process all servers concurrently for faster startup
  await Promise.allSettled(
    enabledServers.map(async (serverInfo) => {
      try {
        // Quick RCON ping to check if server is reachable
        const statusResult = await rconService.sendCommand(serverInfo.id, 'status');
        if (!statusResult.success) {
          log.warn(`[STARTUP] ${serverInfo.id}: Unreachable (${statusResult.error})`);
          return;
        }

        const needsInit = !serverInfo.persistentConfigSent;
        const needsRetry = !!serverInfo.persistentConfigSent && !serverInfo.lastSeen;

        if (needsInit || needsRetry) {
          // Server needs (re)configuration
          await serverInitializationService.initializeServer(serverInfo.id, baseUrl, {
            force: needsRetry,
          });
          log.success(
            `[STARTUP] ${serverInfo.id}: ${needsInit ? 'Configured' : 'Retry sent'} – waiting for Auto Tournament CS2 events`
          );
        } else {
          // Server is already configured and has sent events - just log status
          const timeSinceLastSeen = serverInfo.lastSeen
            ? Math.floor(Date.now() / 1000) - serverInfo.lastSeen
            : null;
          
          if (timeSinceLastSeen !== null && timeSinceLastSeen < 300) {
            log.info(`[STARTUP] ${serverInfo.id}: Online (last event ${timeSinceLastSeen}s ago)`);
          } else {
            log.info(`[STARTUP] ${serverInfo.id}: Configured but inactive (${timeSinceLastSeen ? `${timeSinceLastSeen}s` : 'never'} since last event)`);
          }
        }
      } catch (error) {
        log.warn(`[STARTUP] ${serverInfo.id}: Check failed`, { error });
      }
    })
  );

  log.success(`[STARTUP] Server initialization complete`);
}
