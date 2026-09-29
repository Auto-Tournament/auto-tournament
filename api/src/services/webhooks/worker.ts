/**
 * The delivery queue: sends what is due, retries with backoff, gives up,
 * and switches off an endpoint that keeps failing.
 *
 * The queue is the `webhook_deliveries` table, so it survives a restart: a
 * row is `pending` with a `next_attempt_at` until it is `succeeded`, `failed`
 * (every attempt spent) or `cancelled` (its endpoint was switched off or
 * removed). A row a crashed process left `delivering` goes back to `pending`
 * when its lock runs out.
 *
 * Auto-disable: when a delivery spends every attempt (~16 hours of retries)
 * and the endpoint has not answered 2xx to anything since that delivery was
 * created, the endpoint is switched off, its queued deliveries are
 * cancelled, and the admins are told (log, admin socket room, and the notice
 * on Settings → Webhooks). Test deliveries never switch an endpoint off.
 */

import { log } from '../../utils/logger';
import { settingsService } from '../settingsService';
import { getIO, ADMIN_ROOM } from '../socketService';
import { attemptDelivery, type AttemptResult } from './deliver';
import { isSuccessStatus, MAX_ATTEMPTS, nextRetryDelayMs, parseRetryAfter } from './retry';
import { scrubSecrets, truncateResponseBody } from './redact';
import {
  DELIVERY_HEADER,
  EVENT_HEADER,
  EVENT_ID_HEADER,
  SIGNATURE_HEADER,
  signatureHeaderValue,
} from './signing';
import {
  claimDue,
  disableEndpoint,
  getEndpoint,
  markEndpointResult,
  nextDueAt,
  pruneDeliveries,
  recordAttempt,
  releaseStaleLocks,
  sql,
  type Delivery,
  type WebhookEndpointWithSecrets,
} from './store';

const LOCK_MS = 60_000;
const BATCH = 10;
/** The longest the worker sleeps with nothing due (it is also woken on enqueue). */
const IDLE_POLL_MS = 15_000;
const PRUNE_EVERY_MS = 6 * 60 * 60_000;
/** Finished deliveries stay in the log this long. */
export const DELIVERY_RETENTION_MS = 30 * 24 * 60 * 60_000;
const USER_AGENT = 'AutoTournament-Webhooks/1';

/** Test knobs (POST /api/test/webhooks/timing). */
export const webhookTiming = {
  /** Multiplies every retry delay. */
  retryScale: 1,
  /** Min time between two match.score_updated of one match. */
  scoreThrottleMs: 5_000,
  /** Per-attempt timeout. */
  attemptTimeoutMs: 10_000,
};

let timer: NodeJS.Timeout | null = null;
let running = false;
let stopped = true;
let rerun = false;
let lastPrune = 0;

export function startWorker(): void {
  if (!stopped) return;
  stopped = false;
  void releaseStaleLocks()
    .then((n) => {
      if (n > 0) log.info(`[Webhooks] ${n} interrupted deliver${n === 1 ? 'y' : 'ies'} back in the queue`);
    })
    .catch(() => undefined)
    .finally(() => wakeWorker());
}

export function stopWorker(): void {
  stopped = true;
  if (timer) clearTimeout(timer);
  timer = null;
}

/** Look at the queue now (something was enqueued). */
export function wakeWorker(): void {
  if (stopped) return;
  if (running) {
    rerun = true;
    return;
  }
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void tick(), 0);
}

function schedule(ms: number): void {
  if (stopped) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void tick(), Math.max(0, Math.min(ms, IDLE_POLL_MS)));
}

async function tick(): Promise<void> {
  if (stopped || running) return;
  running = true;
  rerun = false;
  try {
    for (;;) {
      const due = await claimDue(BATCH, LOCK_MS);
      if (due.length === 0) break;
      // One endpoint's deliveries go in order; different endpoints in parallel.
      const byEndpoint = new Map<string, Delivery[]>();
      for (const d of due) byEndpoint.set(d.endpointId, [...(byEndpoint.get(d.endpointId) ?? []), d]);
      await Promise.all(
        [...byEndpoint.values()].map(async (list) => {
          for (const d of list) await deliverOne(d);
        })
      );
      if (stopped) break;
    }
    if (Date.now() - lastPrune > PRUNE_EVERY_MS) {
      lastPrune = Date.now();
      await pruneDeliveries(DELIVERY_RETENTION_MS).catch(() => 0);
    }
  } catch (error) {
    log.warn('[Webhooks] Delivery queue pass failed', { error: error instanceof Error ? error.message : String(error) });
  } finally {
    running = false;
  }
  if (rerun) return wakeWorker();
  const next = await nextDueAt().catch(() => null);
  schedule(next === null ? IDLE_POLL_MS : next - Date.now());
}

function headersFor(endpoint: WebhookEndpointWithSecrets, delivery: Delivery): Record<string, string> {
  const t = Math.floor(Date.now() / 1000);
  const secrets = [endpoint.secret, ...(endpoint.previousSecret ? [endpoint.previousSecret] : [])];
  return {
    'User-Agent': USER_AGENT,
    [SIGNATURE_HEADER]: signatureHeaderValue(secrets, t, delivery.body),
    [EVENT_HEADER]: delivery.eventType,
    [EVENT_ID_HEADER]: delivery.eventId,
    [DELIVERY_HEADER]: delivery.id,
  };
}

async function deliverOne(delivery: Delivery): Promise<void> {
  const endpoint = await getEndpoint(delivery.endpointId);
  if (!endpoint || !endpoint.active) {
    // Switched off between the claim and now: back to the queue, where the
    // cancel of a switched-off endpoint finds it.
    await sql(`UPDATE webhook_deliveries SET status = 'pending', locked_until = NULL WHERE id = $1 AND status = 'delivering'`, [
      delivery.id,
    ]).catch(() => undefined);
    return;
  }

  const attempt = delivery.attempts + 1;
  const allowPrivate = await settingsService.areWebhookPrivateTargetsAllowed().catch(() => false);
  let result: AttemptResult;
  try {
    result = await attemptDelivery({
      url: endpoint.url,
      body: delivery.body,
      headers: headersFor(endpoint, delivery),
      allowPrivate,
      timeoutMs: webhookTiming.attemptTimeoutMs,
    });
  } catch (error) {
    result = {
      statusCode: null,
      error: error instanceof Error ? error.message : String(error),
      responseText: '',
      retryAfter: null,
      durationMs: 0,
      blocked: false,
    };
  }

  const ok = result.statusCode !== null && isSuccessStatus(result.statusCode);
  const error =
    result.error ??
    (ok ? null : result.statusCode !== null && result.statusCode >= 300 && result.statusCode < 400 ? `HTTP ${result.statusCode} (redirects are not followed)` : result.statusCode !== null ? `HTTP ${result.statusCode}` : 'no response');
  const delay = ok
    ? null
    : nextRetryDelayMs(attempt, {
        scale: webhookTiming.retryScale,
        retryAfterSeconds: parseRetryAfter(result.retryAfter),
      });
  const status = ok ? 'succeeded' : delay === null ? 'failed' : 'pending';

  await recordAttempt({
    deliveryId: delivery.id,
    attempt,
    statusCode: result.statusCode,
    error,
    durationMs: result.durationMs,
    response: result.responseText ? truncateResponseBody(scrubSecrets(result.responseText, delivery.body)) : null,
    outcome: { status, nextAttemptAt: delay === null ? null : Date.now() + delay },
  });
  await markEndpointResult(endpoint.id, ok);

  // Never the body: it holds connect details.
  const logMeta = {
    endpointId: endpoint.id,
    deliveryId: delivery.id,
    eventType: delivery.eventType,
    attempt,
    statusCode: result.statusCode,
  };
  if (ok) {
    log.debug('[Webhooks] Delivered', logMeta);
    return;
  }
  if (status === 'pending') {
    log.debug(`[Webhooks] Delivery failed (${error}); retrying`, logMeta);
    return;
  }

  log.warn(`[Webhooks] Delivery gave up after ${MAX_ATTEMPTS} attempts (${error})`, logMeta);
  if (delivery.test) return;
  const fresh = await getEndpoint(endpoint.id);
  if (fresh && fresh.active && (fresh.lastSuccessAt === null || fresh.lastSuccessAt < delivery.createdAt)) {
    const reason = `Disabled after persistent failures: no delivery succeeded since ${new Date(
      delivery.createdAt
    ).toISOString()} (last error: ${error}). Fix the receiver, then switch the endpoint on again.`;
    await disableEndpoint(endpoint.id, reason);
    log.warn(`[Webhooks] Endpoint ${endpoint.id} (${endpoint.url}) disabled: ${reason}`);
    try {
      getIO().to(ADMIN_ROOM).emit('webhook:disabled', { endpointId: endpoint.id, url: endpoint.url, reason });
    } catch {
      // No socket server (tests, early startup): the notice is on the Settings page.
    }
  }
}

