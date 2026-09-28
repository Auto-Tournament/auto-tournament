/**
 * How a fleet `event.*` reaches the core: `normalizeFleetEvent` (./normalize)
 * turns it into NormalizedEvents, and `applyNormalizedEvents`
 * (../events/matchEvents) applies the CS2 side effects and hands them to
 * `matchLifecycle.ingest`, the same path a plugin webhook event takes after
 * its own `normalize()`. Called by ./inbound.ts after the event is stored
 * and its patch went through the state store.
 */

import { applyNormalizedEvents } from '../events/matchEvents';
import type { NormalizedEvent } from '../../types';
import { normalizeFleetEvent } from './normalize';
import type { Envelope, MatchState, RoundSummary } from './protocol/v1';

export interface FleetIngestContext {
  /** MatchState after the event's patch (null when the store has none yet). */
  state: MatchState | null;
  /** `event.round_end`: the map's rounds so far, this one included. */
  mapRounds?: RoundSummary[];
}

export async function ingestFleetEvent(
  env: Envelope,
  ctx: FleetIngestContext
): Promise<NormalizedEvent[]> {
  const state = ctx.state;
  const events = normalizeFleetEvent(env, {
    state,
    ...(ctx.mapRounds ? { mapRounds: ctx.mapRounds } : {}),
    includeBots: state?.rules?.simulation !== undefined,
  });
  if (!events.length) return [];
  const data = (env.payload as { data?: { steamid64?: unknown; name?: unknown } }).data;
  const playerName = (steamId: string): string | undefined => {
    if (data && data.steamid64 === steamId && typeof data.name === 'string' && data.name)
      return data.name;
    return (
      state?.teams?.team1?.players?.[steamId]?.name ?? state?.teams?.team2?.players?.[steamId]?.name
    );
  };
  return applyNormalizedEvents(events, { playerName });
}
