/**
 * Retry schedule for webhook deliveries (at-least-once).
 *
 * A delivery that does not get a 2xx is tried again after the delay for the
 * attempt that just failed, then given up ("failed") once every attempt is
 * spent: 10 attempts over roughly 16 hours. Each delay gets ±10 % jitter so a
 * receiver coming back up is not hit by every queued delivery in the same
 * second. A `Retry-After` from the receiver (429 / 503) is honoured when it
 * asks for longer, capped at the next-but-one delay.
 *
 * Pure. `scale` exists for the tests (POST /api/test/webhooks/timing).
 */

/** Delay after attempt N fails (index N-1), in ms. */
export const RETRY_DELAYS_MS: ReadonlyArray<number> = [
  10_000, // 10 s
  30_000, // 30 s
  2 * 60_000, // 2 min
  10 * 60_000, // 10 min
  30 * 60_000, // 30 min
  60 * 60_000, // 1 h
  2 * 60 * 60_000, // 2 h
  4 * 60 * 60_000, // 4 h
  8 * 60 * 60_000, // 8 h
];

/** First attempt plus one per delay. */
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

export interface RetryOptions {
  /** Multiplies every delay (tests: 0.001 turns hours into seconds). */
  scale?: number;
  /** Seconds from a Retry-After header, when the receiver sent one. */
  retryAfterSeconds?: number | null;
  /** 0..1, replaced by a fixed value in tests. Default Math.random. */
  random?: () => number;
}

/**
 * When to try again after `attempt` (1-based) failed, in ms from now; null
 * when that was the last attempt.
 */
export function nextRetryDelayMs(attempt: number, opts: RetryOptions = {}): number | null {
  if (!Number.isInteger(attempt) || attempt < 1 || attempt >= MAX_ATTEMPTS) return null;
  const scale = opts.scale ?? 1;
  const base = RETRY_DELAYS_MS[attempt - 1];
  const random = opts.random ?? Math.random;
  const jitter = 1 + (random() * 2 - 1) * 0.1;
  let delay = base * jitter;
  if (opts.retryAfterSeconds && opts.retryAfterSeconds > 0) {
    const cap = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
    delay = Math.max(delay, Math.min(opts.retryAfterSeconds * 1000, cap));
  }
  return Math.max(0, Math.round(delay * scale));
}

/** Seconds from a Retry-After header (delta-seconds or an HTTP date). */
export function parseRetryAfter(value: string | null | undefined, nowMs = Date.now()): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.round((at - nowMs) / 1000));
}

/** Whether the response counts as delivered. Redirects are not followed and count as failures. */
export function isSuccessStatus(status: number): boolean {
  return status >= 200 && status < 300;
}
