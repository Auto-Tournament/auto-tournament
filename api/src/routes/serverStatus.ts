import { Router, Request, Response } from 'express';
import { serverService } from '../services/serverService';
import { rconService } from '../services/rconService';
import { requireAuth } from '../middleware/auth';
import { log } from '../utils/logger';
import { serverStatusService, ServerStatus } from '../services/serverStatusService';
import { getLastServerTestEvent } from '../services/serverConnectivityService';
import { serverAllocationTracker } from '../services/serverAllocationTracker';
import { db } from '../config/database';

const router = Router();

function parseCs2BuildId(versionOutput: string): number | null {
  // Common patterns we’ve seen across Source engine/CS2:
  // - "BuildID 1234567"
  // - "BuildId: 1234567"
  // - Sometimes embedded in multi-line output.
  const m = versionOutput.match(/\bBuildID\b[:\s]+(\d{4,})/i);
  if (m?.[1]) {
    const n = Number(m[1]);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// Protect all routes
router.use(requireAuth);

/**
 * @openapi
 * /api/servers/{id}/status:
 *   get:
 *     tags:
 *       - Servers
 *     summary: Test server RCON connection
 *     description: Attempts to connect to the server via RCON and returns online/offline status
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Server ID
 *     responses:
 *       200:
 *         description: Server status retrieved
 *       404:
 *         description: Server not found
 */
router.get('/:id/status', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const server = await serverService.getServerById(id);

    if (!server) {
      return res.status(404).json({
        success: false,
        error: `Server '${id}' not found`,
      });
    }

    // Fake server for screenshots/testing - always return online
    // Servers with IP 0.0.0.0 are treated as always online (fake servers)
    if (server.host === '0.0.0.0') {
      return res.json({
        success: true,
        status: 'online',
        serverId: id,
        isAvailable: true,
        currentMatch: null,
      });
    }

    // Prefer detailed status from the MatchZy plugin ConVars (includes current match slug)
    // For lightweight UI checks we allow using a short-lived cache buffer to avoid
    // flapping between online/offline. Manual checks (e.g. "Test Connection") call
    // this route without the ?cached=true flag and therefore always bypass the cache.
    const useCache = req.query.cached === 'true' || req.query.cached === '1';
    // While a server is being configured (persistent convars being set via RCON),
    // status reads can take longer than usual. Don't declare it offline too early.
    const STATUS_READ_TIMEOUT_MS = 10_000;
    const statusInfo = await Promise.race([
      serverStatusService.getServerStatus(id, useCache),
      new Promise<{
        status: null;
        matchSlug: null;
        updatedAt: null;
        online: false;
      }>((resolve) =>
        setTimeout(
          () =>
            resolve({
              status: null,
              matchSlug: null,
              updatedAt: null,
              online: false,
            }),
          STATUS_READ_TIMEOUT_MS
        )
      ),
    ]);

    // Check if server has banned our IP by testing RCON connection
    // This will detect repeated authentication errors
    let ipBanned = false;
    if (!useCache) {
      try {
        const testResult = await rconService.testConnection(id);
        ipBanned = testResult.ipBanned === true;
      } catch {
        // Ignore errors - we'll check from the statusInfo
      }
    }

    const reachableFromApi = statusInfo.online;

    if (!statusInfo.online) {
      log.warn(`Server ${id} is offline or unreachable (status check failed)`);
      // For cached views, we can return immediately with a lightweight payload
      // and avoid running connectivity tests or webhook configuration.
      return res.json({
        success: true,
        status: 'offline',
        serverId: id,
        isAvailable: false,
        currentMatch: null,
        queuedMatch: null,
        reachableFromApi,
        serverCanReachApi: null,
        pluginStatus: null,
        allocationState: null,
        allocationMatchSlug: null,
        ipBanned,
        // Best-effort: last known CS2 version/build from DB
        cs2BuildId: server.cs2BuildId ?? null,
        cs2VersionString: server.cs2VersionString ?? null,
        cs2VersionFetchedAt: server.cs2VersionFetchedAt ?? null,
      });
    }

    // Derive a more accurate status by combining plugin ConVars with our DB view of
    // which matches are actually running on this server. This helps in cases where
    // the MatchZy plugin has not yet updated its custom status ConVars and is still
    // reporting "idle" even though a match is already loaded or live.
    let effectiveStatus = statusInfo.status;
    let effectiveMatchSlug = statusInfo.matchSlug;
    const queuedMatchSlug = statusInfo.nextMatchSlug ?? null;

    if (!effectiveStatus || effectiveStatus === ServerStatus.IDLE || effectiveStatus === ServerStatus.POSTGAME) {
      try {
        // Status column in matches can include runtime values like 'loaded' and 'live'
        // in addition to the narrower compile-time type, so we treat it as a string here.
        const activeMatch = await db.queryOneAsync<{ slug: string; status: string }>(
          'SELECT slug, status FROM matches WHERE server_id = ? AND status IN (?, ?) ORDER BY created_at DESC LIMIT 1',
          [id, 'live', 'loaded']
        );

        if (activeMatch) {
          effectiveMatchSlug = activeMatch.slug;
          if (activeMatch.status === 'live') {
            effectiveStatus = ServerStatus.LIVE;
          } else if (activeMatch.status === 'loaded') {
            // Treat a loaded match with players connecting as "warmup" so the UI
            // doesn't show the server as idle while the match is staged.
            effectiveStatus = ServerStatus.WARMUP;
          }
        }
      } catch (dbError) {
        log.warn(`Failed to derive active match status for server ${id}`, { error: dbError });
      }
    }

    log.debug(`Server ${id} is online`, {
      pluginStatus: statusInfo.status,
      pluginMatchSlug: statusInfo.matchSlug,
      effectiveStatus,
      effectiveMatchSlug,
    });

    const isAvailable =
      !effectiveMatchSlug ||
      effectiveStatus === ServerStatus.IDLE ||
      effectiveStatus === ServerStatus.POSTGAME;

    // Combine plugin status with internal allocation tracker state
    const allocationState = serverAllocationTracker.getState(id);
    const allocationLabel = allocationState?.state ?? 'unknown';

    // For cached views (e.g. dashboard, servers list), skip the expensive
    // bi-directional connectivity test and webhook reconfiguration. These
    // routes can be called frequently and should remain lightweight.
    if (useCache) {
      return res.json({
        success: true,
        status: 'online',
        serverId: id,
        isAvailable,
        currentMatch: effectiveMatchSlug,
        queuedMatch: queuedMatchSlug,
        reachableFromApi,
        serverCanReachApi: null,
        pluginStatus: effectiveStatus,
        allocationState: allocationLabel,
        allocationMatchSlug: allocationState?.matchSlug ?? null,
        ipBanned,
        // Best-effort: last known CS2 version/build from DB
        cs2BuildId: server.cs2BuildId ?? null,
        cs2VersionString: server.cs2VersionString ?? null,
        cs2VersionFetchedAt: server.cs2VersionFetchedAt ?? null,
      });
    }

    // Best-effort: Fetch CS2 version/build via RCON `version` and persist it.
    // This runs only for non-cached (manual/admin) refreshes so the default UI polling stays lightweight.
    let cs2BuildId: number | null = server.cs2BuildId ?? null;
    let cs2VersionString: string | null = server.cs2VersionString ?? null;
    let cs2VersionFetchedAt: number | null = server.cs2VersionFetchedAt ?? null;

    try {
      const now = Math.floor(Date.now() / 1000);
      const STALE_AFTER_SECONDS = 5 * 60; // Avoid spamming `version` when the page polls frequently
      const isStale =
        !cs2VersionFetchedAt || now - cs2VersionFetchedAt >= STALE_AFTER_SECONDS;

      if (isStale) {
        const versionResult = await rconService.sendCommand(id, 'version');
        if (versionResult.success && typeof versionResult.response === 'string') {
          cs2VersionString = versionResult.response;
          cs2BuildId = parseCs2BuildId(versionResult.response);
          cs2VersionFetchedAt = now;

          await db.updateAsync(
            'servers',
            {
              cs2_build_id: cs2BuildId,
              cs2_version_string: cs2VersionString,
              cs2_version_fetched_at: cs2VersionFetchedAt,
              updated_at: now,
            },
            'id = ?',
            [id]
          );
        }
      }
    } catch (error) {
      // Non-fatal: keep the rest of the status response.
      log.debug(`Failed to fetch CS2 version via RCON for server ${id}`, { error });
    }

    // Note: Webhook configuration is now handled by serverInitializationService
    // on first connection. The server stores it persistently in its database,
    // so we don't need to reconfigure it on every status check.

    // Bi-directional connectivity check:
    //  - We already know we can reach the server via RCON (reachableFromApi).
    //  - Now trigger css_te so the server sends a test event back to /api/events.
    const previousTestEventTs = getLastServerTestEvent(id) ?? 0;
    let serverCanReachApi = false;

    try {
      await rconService.sendCommand(id, 'css_te');

      // Give servers a bit more time to emit the test event while busy/configuring.
      const timeoutMs = 10_000;
      const pollIntervalMs = 250;
      const deadline = Date.now() + timeoutMs;

      while (Date.now() < deadline) {
        const lastTs = getLastServerTestEvent(id) ?? 0;
        if (lastTs > previousTestEventTs) {
          serverCanReachApi = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }
    } catch (error) {
      log.warn(`Failed to send css_te connectivity test to server ${id}`, { error });
    }

    return res.json({
      success: true,
      status: 'online',
      serverId: id,
      isAvailable,
      currentMatch: effectiveMatchSlug,
      queuedMatch: queuedMatchSlug,
      reachableFromApi,
      serverCanReachApi,
      pluginStatus: effectiveStatus,
      allocationState: allocationLabel,
      allocationMatchSlug: allocationState?.matchSlug ?? null,
      ipBanned,
      cs2BuildId,
      cs2VersionString,
      cs2VersionFetchedAt,
    });
  } catch (error) {
    log.error('Error checking server status', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to check server status',
    });
  }
});

export default router;
