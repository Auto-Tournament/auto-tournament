import { effectiveBusyReason } from './busyReason';
import { heldFleetSpares } from './failover';
import { matchDisabledServerIds } from './push/pluginSets';
import type { BusyReason } from './protocol/v1/types';

/** Each fleet server with the busy reason to show: match off, what it reported, or held as the failover spare. */
export async function withBusyReasons<T extends { id: string; availabilityReason: BusyReason | null }>(
  servers: T[]
): Promise<T[]> {
  const [matchOff, spares] = await Promise.all([matchDisabledServerIds(), heldFleetSpares()]);
  const spareIds = new Set(spares.map((c) => c.fleetServerId));
  return servers.map((s) => ({
    ...s,
    availabilityReason: effectiveBusyReason(s.availabilityReason, {
      matchDisabled: matchOff.has(s.id),
      reserved: spareIds.has(s.id),
    }),
  }));
}
