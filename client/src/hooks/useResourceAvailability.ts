/**
 * What this tournament's game has free for its waiting matches (3.0 phase E).
 *
 * The bracket, the match list and the Manage console all show a queue — how
 * many matches are waiting, how long one is likely to wait, whether anything
 * is free at all — and all three used to get it by asking
 * `/api/tournament/server-availability` themselves. That route is CS2's, about
 * CS2 servers, and core code naming it is core code assuming every game has a
 * fleet.
 *
 * Now the module says where to ask (`resourceAvailabilityEndpoint`) or says
 * nothing, and a module that says nothing is never asked: the answer stays
 * null, and every surface that reads it already knows how to show no queue.
 * That is the honest answer for a manually reported tournament, whose matches
 * are open the moment the round is.
 *
 * The countdown to the next allocation pass ticks here too, because both pages
 * that show it want the same seconds and the same behaviour: seeded by each
 * answer, counted down locally in between so the display keeps moving.
 */

import { useCallback, useEffect, useState } from 'react';
import { api } from '../utils/api';
import type { ClientGameIntegration, ResourceAvailability } from '../integrations/types';

/**
 * The module's own answer. Core reads `nextAllocationInSeconds` from it and
 * nothing else; anything else it shows, it asks the module's
 * `summarizeAvailability` / `manageNeedsYou` to read out of it.
 */
type AvailabilityAnswer = ResourceAvailability & { success?: boolean };

/** One ask, or null when it failed or the endpoint answered with no data. */
async function askOnce(endpoint: string): Promise<AvailabilityAnswer | null> {
  try {
    const data = await api.get<AvailabilityAnswer>(endpoint);
    return data.success ? data : null;
  } catch (err) {
    console.error('Failed to load resource availability:', err);
    return null;
  }
}

interface UseResourceAvailabilityResult {
  availability: ResourceAvailability | null;
  /** Seconds until the next allocation pass, or null when there is none. */
  nextInSeconds: number | null;
  refresh: () => Promise<void>;
}

export function useResourceAvailability(
  /** The tournament's integration, or null while it is still unknown. */
  integration: ClientGameIntegration | null,
  /** How often to ask again, keeping each caller's own cadence. */
  intervalMs: number
): UseResourceAvailabilityResult {
  const [answer, setAnswer] = useState<AvailabilityAnswer | null>(null);
  const [seconds, setSeconds] = useState<number | null>(null);
  const endpoint = integration?.resourceAvailabilityEndpoint;

  // A game with nothing to wait for has no queue, not an empty one — and the
  // last answer from a game this instance has stopped running is not an answer
  // about this one, so it is read as none rather than cleared after the fact.
  const availability: ResourceAvailability | null = endpoint ? answer : null;
  const nextInSeconds = endpoint ? seconds : null;

  const apply = useCallback((data: AvailabilityAnswer | null) => {
    if (!data) return;
    setAnswer(data);
    setSeconds(
      typeof data.nextAllocationInSeconds === 'number' ? data.nextAllocationInSeconds : null
    );
  }, []);

  /** Ask again now, for a page with its own refresh button. */
  const refresh = useCallback(async () => {
    if (!endpoint) return;
    apply(await askOnce(endpoint));
  }, [endpoint, apply]);

  useEffect(() => {
    if (!endpoint) return;
    let cancelled = false;

    const load = async () => {
      const data = await askOnce(endpoint);
      if (!cancelled) apply(data);
    };

    void load();
    const interval = setInterval(() => void load(), intervalMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [endpoint, intervalMs, apply]);

  // Local per-second tick, so the countdown moves between answers.
  useEffect(() => {
    if (nextInSeconds === null || nextInSeconds <= 0) return;
    const timer = setInterval(
      () => setSeconds((prev) => (prev !== null && prev > 0 ? prev - 1 : 0)),
      1000
    );
    return () => clearInterval(timer);
  }, [nextInSeconds]);

  return { availability, nextInSeconds, refresh };
}
