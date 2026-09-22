/**
 * The CS2 part of `GET /api/health/fleet` (`cs2Integration.healthContributions`).
 *
 * Moved from the handler in `index.ts`; the fields and their order are the
 * same, and the core adds `status` and `timestamp` in front of them.
 */

import { serverService } from './services/serverService';

export async function cs2FleetHealth(): Promise<Record<string, unknown>> {
  const now = Math.floor(Date.now() / 1000);
  const servers = await serverService.getAllServers(true);

  // NOTE: getAllServers already filters to enabled servers, and ServerResponse
  // exposes `enabled` as a boolean. Comparing it to 1 is always false, which
  // silently made this whole endpoint report an empty fleet.
  const enabled = servers.filter((s) => s.enabled && s.host !== '0.0.0.0');
  const outdated = enabled.filter((s) => typeof s.cs2RequiredVersion === 'number');
  const stale = enabled.filter(
    (s) => !s.cs2UpdateCheckedAt || now - s.cs2UpdateCheckedAt >= 30 * 60
  );
  const neverChecked = enabled.filter((s) => !s.cs2UpdateCheckedAt);

  return {
    cs2Fleet: {
      enabled: enabled.length,
      outdated: outdated.length,
      stale: stale.length,
      neverChecked: neverChecked.length,
    },
    servers: enabled.map((s) => ({
      id: s.id,
      name: s.name,
      status: s.status ?? null,
      lastSeen: s.lastSeen ?? null,
      cs2BuildId: s.cs2BuildId ?? null,
      cs2RequiredVersion: s.cs2RequiredVersion ?? null,
      cs2UpdatePhase: s.cs2UpdatePhase ?? null,
      cs2UpdateRequiredAt: s.cs2UpdateRequiredAt ?? null,
      cs2UpdateCheckedAt: s.cs2UpdateCheckedAt ?? null,
      cs2VersionFetchedAt: s.cs2VersionFetchedAt ?? null,
    })),
  };
}
