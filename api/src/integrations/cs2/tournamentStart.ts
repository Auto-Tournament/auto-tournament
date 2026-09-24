/**
 * CS2 checks and preparation before a tournament starts, behind `checkStart()`
 * and `prepareStart()` on the CS2 integration. Moved as they were from
 * routes/tournament.ts: the start route runs the preflight first (a failure
 * blocks the start with `cs2_outdated_servers`), then the webhook bootstrap.
 */

import { db } from '../../config/database';
import { log } from '../../utils/logger';
import { settingsService } from '../../services/settingsService';
import { extractCs2StatusVersionLine, parseCs2BuildId } from '../../utils/cs2Version';
import { rconService } from './services/rconService';
import { serverService } from './services/serverService';
import { serverInitializationService } from './services/serverInitializationService';
import { cs2UpdateService } from './services/cs2UpdateService';


/**
 * Ensure Auto Tournament CS2 webhooks are configured for all enabled servers at the moment
 * a tournament is started. This mirrors the behaviour of the Servers page
 * (which configures webhooks when testing server status) so that admins don't
 * have to visit the Servers view before allocations begin.
 */
export async function bootstrapServerWebhooksForTournamentStart(): Promise<void> {
  const serverToken = process.env.SERVER_TOKEN;
  if (!serverToken) {
    log.warn(
      'SERVER_TOKEN is not set. Skipping automatic webhook bootstrap during tournament start.'
    );
    return;
  }

  const baseUrl = await settingsService.getWebhookUrl();
  if (!baseUrl) {
    log.warn(
      'Webhook URL is not configured. Skipping automatic webhook bootstrap during tournament start.'
    );
    return;
  }

  const enabledServers = await serverService.getAllServers(true);
  if (enabledServers.length === 0) {
    return;
  }

  log.info(
    `[WEBHOOK] Ensuring persistent config for ${enabledServers.length} server(s) before allocation...`
  );

  // Initialize servers with persistent configuration (idempotent - only sends if not already initialized)
  for (const server of enabledServers) {
    try {
      await serverInitializationService.initializeServer(server.id, baseUrl);
      log.success(`Initialized persistent config for ${server.id}`);
    } catch (error) {
      // Don't fail the start flow if a single server init fails.
      log.warn(
        `Failed to initialize server ${server.id} during tournament start`,
        { error }
      );
    }
  }
}

export async function preflightServersUpToDateForTournamentStart(): Promise<
  | { ok: true }
  | {
      ok: false;
      servers: Array<{
        id: string;
        name: string;
        installedBuildId: number | null;
        requiredVersion: number | null;
        reason: string;
      }>;
    }
> {
  const enabledServers = await serverService.getAllServers(true);
  if (enabledServers.length === 0) {
    return { ok: true };
  }

  const now = Math.floor(Date.now() / 1000);
  const problems: Array<{
    id: string;
    name: string;
    installedBuildId: number | null;
    requiredVersion: number | null;
    reason: string;
  }> = [];

  for (const server of enabledServers) {
    // Fake servers for screenshots/testing should not block tournament start.
    if (server.host === '0.0.0.0') {
      continue;
    }

    try {
      const versionResult = await rconService.sendCommand(server.id, 'version');
      if (!versionResult.success || typeof versionResult.response !== 'string') {
        problems.push({
          id: server.id,
          name: server.name,
          installedBuildId: server.cs2BuildId ?? null,
          requiredVersion: null,
          reason: `Could not fetch CS2 version via RCON: ${versionResult.error ?? 'no details'}`,
        });
        continue;
      }

      let installedBuildId = parseCs2BuildId(versionResult.response);
      let cs2VersionString: string | null = versionResult.response;

      if (!installedBuildId) {
        // Fallback: some servers do not include BuildID in `version` output, but `status` includes
        // `version  : 1.41.3.4/14134 ...` where the trailing number matches Steam required_version.
        const statusResult = await rconService.sendCommand(server.id, 'status');
        if (statusResult.success && typeof statusResult.response === 'string') {
          installedBuildId = parseCs2BuildId(statusResult.response);
          cs2VersionString = extractCs2StatusVersionLine(statusResult.response) ?? statusResult.response;
        }
      }

      if (!installedBuildId) {
        log.warn('[TOURNAMENT] Could not verify CS2 version via RCON for server', {
          serverId: server.id,
          versionExcerpt: String(versionResult.response).slice(0, 200),
        });
        problems.push({
          id: server.id,
          name: server.name,
          installedBuildId: null,
          requiredVersion: null,
          reason: 'Could not verify CS2 version via RCON (`version`/`status` parsing failed)',
        });
        continue;
      }

      const check = await cs2UpdateService.upToDateCheck(installedBuildId);

      // Persist latest known version output + build id (best-effort) and the UpToDateCheck outcome.
      if (check.upToDate) {
        await db.updateAsync(
          'cs2_servers',
          {
            cs2_build_id: installedBuildId,
            cs2_version_string: cs2VersionString,
            cs2_version_fetched_at: now,
            cs2_required_version: null,
            cs2_update_phase: null,
            cs2_update_required_at: null,
            cs2_update_checked_at: now,
            updated_at: now,
          },
          'id = ?',
          [server.id]
        );
      } else {
        await db.updateAsync(
          'cs2_servers',
          {
            cs2_build_id: installedBuildId,
            cs2_version_string: cs2VersionString,
            cs2_version_fetched_at: now,
            cs2_required_version: check.requiredVersion ?? null,
            cs2_update_phase: 'available',
            cs2_update_required_at: now,
            cs2_update_checked_at: now,
            updated_at: now,
          },
          'id = ?',
          [server.id]
        );

        problems.push({
          id: server.id,
          name: server.name,
          installedBuildId,
          requiredVersion: check.requiredVersion ?? null,
          reason: 'Server is out of date according to Steam UpToDateCheck',
        });
      }
    } catch (error) {
      problems.push({
        id: server.id,
        name: server.name,
        installedBuildId: server.cs2BuildId ?? null,
        requiredVersion: server.cs2RequiredVersion ?? null,
        reason: `Failed to verify CS2 build against Steam: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  if (problems.length > 0) {
    return { ok: false, servers: problems };
  }

  return { ok: true };
}
