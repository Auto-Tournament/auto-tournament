import { useEffect, useState } from 'react';
import { api } from '../../../module-sdk';
import { SERVER_AVAILABILITY_ENDPOINT, type ServerAvailability } from '../cs2.types';

/**
 * What the fleet can take right now, asked by this module itself and asked
 * again every `intervalMs`.
 *
 * The panels that show servers used to be handed this answer by the page
 * they sit on, which meant core fetching a CS2 route for them. Now a slot
 * takes ids and the panel asks (client API 0.2.0). The pages that also show
 * a queue still ask the same route through `resourceAvailabilityEndpoint`, on
 * the same 5-second cadence.
 *
 * `loaded` turns true after the first answer, failed or not, so a panel can
 * tell "not asked yet" from "no servers". `answers` counts them, for a panel
 * that holds back a verdict the first answer cannot give yet.
 */
export function useServerAvailability(intervalMs = 5000): {
  availability: ServerAvailability | null;
  loaded: boolean;
  answers: number;
} {
  const [availability, setAvailability] = useState<ServerAvailability | null>(null);
  const [answers, setAnswers] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const data = await api.get<ServerAvailability>(SERVER_AVAILABILITY_ENDPOINT);
        if (!cancelled && data.success) setAvailability(data);
      } catch (err) {
        console.error('Failed to load server availability:', err);
      } finally {
        if (!cancelled) setAnswers((count) => count + 1);
      }
    };
    void load();
    const timer = setInterval(() => void load(), intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [intervalMs]);

  return { availability, loaded: answers > 0, answers };
}
