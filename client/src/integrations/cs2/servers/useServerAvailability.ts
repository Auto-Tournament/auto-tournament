import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../../module-sdk';
import { SERVER_AVAILABILITY_ENDPOINT, type ServerAvailability } from '../cs2.types';
import { useTopic } from '../../../module-sdk';

/**
 * What the fleet can take right now, asked by this module itself and asked
 * again when the fleet or a match changes (the `fleet` topic, `match:update`).
 *
 * The panels that show servers used to be handed this answer by the page
 * they sit on, which meant core fetching a CS2 route for them. Now a slot
 * takes ids and the panel asks (client API 0.2.0). The pages that also show
 * a queue still ask the same route through `resourceAvailabilityEndpoint`.
 *
 * `loaded` turns true after the first answer, failed or not, so a panel can
 * tell "not asked yet" from "no servers". `answers` counts them, for a panel
 * that holds back a verdict the first answer cannot give yet.
 */
export function useServerAvailability(): {
  availability: ServerAvailability | null;
  loaded: boolean;
  answers: number;
} {
  const [availability, setAvailability] = useState<ServerAvailability | null>(null);
  const [answers, setAnswers] = useState(0);

  const mounted = useRef(true);
  const load = useCallback(async () => {
    try {
      const data = await api.get<ServerAvailability>(SERVER_AVAILABILITY_ENDPOINT);
      if (mounted.current && data.success) setAvailability(data);
    } catch (err) {
      console.error('Failed to load server availability:', err);
    } finally {
      if (mounted.current) setAnswers((count) => count + 1);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);
  // A server in its grace window becomes free on a clock, not on an event:
  // ask once more when the soonest window ends.
  const next = availability?.nextAllocationInSeconds ?? null;
  useEffect(() => {
    if (next === null || next <= 0) return undefined;
    const timer = setTimeout(() => void load(), (next + 1) * 1000);
    return () => clearTimeout(timer);
  }, [next, load]);

  // Servers come and go, and matches take and free them: re-read on either.
  useTopic('fleet', load, { admin: true, events: ['match:update', 'server:status'] });

  return { availability, loaded: answers > 0, answers };
}
