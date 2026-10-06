/**
 * Webhook endpoints and deliveries in the database.
 *
 * Every query goes through a raw pooled client rather than the `db` helpers:
 * those print parameters and rows to the verbose DB log, and a delivery body
 * carries connect details (server address, join password) that must not reach
 * any log.
 */

import crypto from 'crypto';
import type { QueryResultRow } from 'pg';
import { db } from '../../config/database';
import { isWebhookEventType, type WebhookEventType } from './events';

export async function sql<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  return db.withClient(async (client) => (await client.query<T>(text, params)).rows);
}

/** `whk_…`, `dlv_…`, `evt_…`: time-ordered, 26 characters after the prefix. */
export function newId(prefix: 'whk' | 'dlv' | 'evt'): string {
  const time = Date.now().toString(36).padStart(10, '0');
  const rand = crypto.randomBytes(10).toString('hex').slice(0, 16);
  return `${prefix}_${time}${rand}`;
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

export const WEBHOOK_FORMATS = ['signed', 'discord'] as const;
export type WebhookFormat = (typeof WEBHOOK_FORMATS)[number];

interface EndpointRow {
  id: string;
  url: string;
  description: string;
  event_types: string;
  active: boolean;
  source: string | null;
  format: string | null;
  secret: string;
  previous_secret: string | null;
  previous_secret_expires_at: string | null;
  disabled_reason: string | null;
  disabled_at: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WebhookEndpoint {
  id: string;
  url: string;
  description: string;
  /** Subscribed types; `['*']` = every type, including ones added later. */
  eventTypes: string[];
  active: boolean;
  source: string | null;
  /** 'signed': the signed JSON envelope. 'discord': a Discord webhook, sent an embed message. */
  format: WebhookFormat;
  disabledReason: string | null;
  disabledAt: number | null;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  /** True while the previous secret is still signed with (after a rotation). */
  previousSecretActive: boolean;
  previousSecretExpiresAt: number | null;
  createdAt: number;
  updatedAt: number;
}

/** With the secrets: for the worker only, never a response. */
export interface WebhookEndpointWithSecrets extends WebhookEndpoint {
  secret: string;
  previousSecret: string | null;
}

function parseEventTypes(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : ['*'];
  } catch {
    return ['*'];
  }
}

function toEndpoint(row: EndpointRow): WebhookEndpointWithSecrets {
  const prevExpires = num(row.previous_secret_expires_at);
  const previousActive = !!row.previous_secret && prevExpires !== null && prevExpires > Date.now();
  return {
    id: row.id,
    url: row.url,
    description: row.description,
    eventTypes: parseEventTypes(row.event_types),
    active: row.active,
    source: row.source,
    format: row.format === 'discord' ? 'discord' : 'signed',
    disabledReason: row.disabled_reason,
    disabledAt: num(row.disabled_at),
    lastSuccessAt: num(row.last_success_at),
    lastFailureAt: num(row.last_failure_at),
    previousSecretActive: previousActive,
    previousSecretExpiresAt: previousActive ? prevExpires : null,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    secret: row.secret,
    previousSecret: previousActive ? row.previous_secret : null,
  };
}

export function publicEndpoint(e: WebhookEndpointWithSecrets): WebhookEndpoint {
  return {
    id: e.id,
    url: e.url,
    description: e.description,
    eventTypes: e.eventTypes,
    active: e.active,
    source: e.source,
    format: e.format,
    disabledReason: e.disabledReason,
    disabledAt: e.disabledAt,
    lastSuccessAt: e.lastSuccessAt,
    lastFailureAt: e.lastFailureAt,
    previousSecretActive: e.previousSecretActive,
    previousSecretExpiresAt: e.previousSecretExpiresAt,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

export function subscribes(endpoint: Pick<WebhookEndpoint, 'eventTypes'>, type: WebhookEventType): boolean {
  return endpoint.eventTypes.includes('*') || endpoint.eventTypes.includes(type);
}

/** Validate a subscription list: `['*']` or known type ids. */
export function normalizeEventTypes(input: unknown): { ok: true; types: string[] } | { ok: false; error: string } {
  if (input === undefined) return { ok: true, types: ['*'] };
  if (!Array.isArray(input) || input.length === 0) {
    return { ok: false, error: 'eventTypes must be a non-empty array of event type ids, or ["*"]' };
  }
  const types = [...new Set(input.map((t) => (typeof t === 'string' ? t.trim() : t)))];
  if (types.includes('*')) return { ok: true, types: ['*'] };
  const unknown = types.filter((t) => !isWebhookEventType(t));
  if (unknown.length > 0) return { ok: false, error: `Unknown event type(s): ${unknown.join(', ')}` };
  return { ok: true, types: types as string[] };
}

export async function listEndpoints(): Promise<WebhookEndpointWithSecrets[]> {
  const rows = await sql<EndpointRow>('SELECT * FROM webhook_endpoints ORDER BY created_at, id');
  return rows.map(toEndpoint);
}

export async function listActiveEndpoints(): Promise<WebhookEndpointWithSecrets[]> {
  const rows = await sql<EndpointRow>('SELECT * FROM webhook_endpoints WHERE active = TRUE ORDER BY created_at, id');
  return rows.map(toEndpoint);
}

export async function getEndpoint(id: string): Promise<WebhookEndpointWithSecrets | null> {
  const [row] = await sql<EndpointRow>('SELECT * FROM webhook_endpoints WHERE id = $1', [id]);
  return row ? toEndpoint(row) : null;
}

export async function insertEndpoint(input: {
  url: string;
  description: string;
  eventTypes: string[];
  active: boolean;
  source: string | null;
  format: WebhookFormat;
  secret: string;
}): Promise<WebhookEndpointWithSecrets> {
  const id = newId('whk');
  const now = Date.now();
  await sql(
    `INSERT INTO webhook_endpoints (id, url, description, event_types, active, source, format, secret, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`,
    [id, input.url, input.description, JSON.stringify(input.eventTypes), input.active, input.source, input.format, input.secret, now]
  );
  const created = await getEndpoint(id);
  if (!created) throw new Error('Failed to read back the webhook endpoint');
  return created;
}

export async function updateEndpoint(
  id: string,
  patch: Partial<{ url: string; description: string; eventTypes: string[]; active: boolean; source: string | null; format: WebhookFormat }>
): Promise<WebhookEndpointWithSecrets | null> {
  const sets: string[] = [];
  const params: unknown[] = [];
  const add = (column: string, value: unknown) => {
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  };
  if (patch.url !== undefined) add('url', patch.url);
  if (patch.description !== undefined) add('description', patch.description);
  if (patch.eventTypes !== undefined) add('event_types', JSON.stringify(patch.eventTypes));
  if (patch.source !== undefined) add('source', patch.source);
  if (patch.format !== undefined) add('format', patch.format);
  if (patch.active !== undefined) {
    add('active', patch.active);
    // Switching it on again is the admin's answer to "disabled after failures".
    if (patch.active) {
      sets.push('disabled_reason = NULL', 'disabled_at = NULL');
    }
  }
  add('updated_at', Date.now());
  params.push(id);
  await sql(`UPDATE webhook_endpoints SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
  return getEndpoint(id);
}

export async function deleteEndpoint(id: string): Promise<boolean> {
  const rows = await sql('DELETE FROM webhook_endpoints WHERE id = $1 RETURNING id', [id]);
  return rows.length > 0;
}

/** New secret; the old one keeps signing (a second `v1=`) until `graceMs` from now. */
export async function rotateSecret(id: string, secret: string, graceMs: number): Promise<WebhookEndpointWithSecrets | null> {
  const now = Date.now();
  if (graceMs > 0) {
    await sql(
      `UPDATE webhook_endpoints
          SET previous_secret = secret, previous_secret_expires_at = $2, secret = $3, updated_at = $4
        WHERE id = $1`,
      [id, now + graceMs, secret, now]
    );
  } else {
    await sql(
      `UPDATE webhook_endpoints
          SET previous_secret = NULL, previous_secret_expires_at = NULL, secret = $2, updated_at = $3
        WHERE id = $1`,
      [id, secret, now]
    );
  }
  return getEndpoint(id);
}

export async function markEndpointResult(id: string, ok: boolean): Promise<void> {
  await sql(`UPDATE webhook_endpoints SET ${ok ? 'last_success_at' : 'last_failure_at'} = $2 WHERE id = $1`, [
    id,
    Date.now(),
  ]);
}

/** Switch an endpoint off because it keeps failing; cancels what it had queued. */
export async function disableEndpoint(id: string, reason: string): Promise<void> {
  const now = Date.now();
  await sql(
    `UPDATE webhook_endpoints SET active = FALSE, disabled_reason = $2, disabled_at = $3, updated_at = $3 WHERE id = $1`,
    [id, reason, now]
  );
  await cancelPendingFor(id, 'endpoint disabled');
}

export async function cancelPendingFor(endpointId: string, why: string): Promise<number> {
  const rows = await sql(
    `UPDATE webhook_deliveries
        SET status = 'cancelled', next_attempt_at = NULL, locked_until = NULL, completed_at = $2,
            last_error = COALESCE(last_error, $3)
      WHERE endpoint_id = $1 AND status IN ('pending', 'delivering')
      RETURNING id`,
    [endpointId, Date.now(), why]
  );
  return rows.length;
}

// ---------------------------------------------------------------------------
// Deliveries
// ---------------------------------------------------------------------------

export type DeliveryStatus = 'pending' | 'delivering' | 'succeeded' | 'failed' | 'cancelled';

interface DeliveryRow {
  id: string;
  endpoint_id: string;
  event_id: string;
  event_type: string;
  match_slug: string | null;
  body: string;
  test: boolean;
  resend_of: string | null;
  status: DeliveryStatus;
  attempts: number;
  next_attempt_at: string | null;
  locked_until: string | null;
  last_status_code: number | null;
  last_error: string | null;
  last_response: string | null;
  last_duration_ms: number | null;
  created_at: string;
  completed_at: string | null;
}

export interface Delivery {
  id: string;
  endpointId: string;
  eventId: string;
  eventType: string;
  matchSlug: string | null;
  /** Unredacted. Only the worker sends it; responses go through redactDeliveryBody. */
  body: string;
  test: boolean;
  resendOf: string | null;
  status: DeliveryStatus;
  attempts: number;
  nextAttemptAt: number | null;
  lastStatusCode: number | null;
  lastError: string | null;
  lastResponse: string | null;
  lastDurationMs: number | null;
  createdAt: number;
  completedAt: number | null;
}

function toDelivery(row: DeliveryRow): Delivery {
  return {
    id: row.id,
    endpointId: row.endpoint_id,
    eventId: row.event_id,
    eventType: row.event_type,
    matchSlug: row.match_slug,
    body: row.body,
    test: row.test,
    resendOf: row.resend_of,
    status: row.status,
    attempts: row.attempts,
    nextAttemptAt: num(row.next_attempt_at),
    lastStatusCode: row.last_status_code,
    lastError: row.last_error,
    lastResponse: row.last_response,
    lastDurationMs: row.last_duration_ms,
    createdAt: Number(row.created_at),
    completedAt: num(row.completed_at),
  };
}

export async function insertDelivery(input: {
  endpointId: string;
  eventId: string;
  eventType: string;
  matchSlug: string | null;
  body: string;
  test: boolean;
  resendOf?: string | null;
}): Promise<Delivery> {
  const id = newId('dlv');
  const now = Date.now();
  const [row] = await sql<DeliveryRow>(
    `INSERT INTO webhook_deliveries
       (id, endpoint_id, event_id, event_type, match_slug, body, test, resend_of, status, attempts, next_attempt_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', 0, $9, $9)
     RETURNING *`,
    [id, input.endpointId, input.eventId, input.eventType, input.matchSlug, input.body, input.test, input.resendOf ?? null, now]
  );
  return toDelivery(row);
}

export async function getDelivery(id: string): Promise<Delivery | null> {
  const [row] = await sql<DeliveryRow>('SELECT * FROM webhook_deliveries WHERE id = $1', [id]);
  return row ? toDelivery(row) : null;
}

export async function listDeliveries(opts: {
  endpointId: string;
  status?: DeliveryStatus;
  limit: number;
  before?: number;
}): Promise<Delivery[]> {
  const params: unknown[] = [opts.endpointId];
  let where = 'endpoint_id = $1';
  if (opts.status) {
    params.push(opts.status);
    where += ` AND status = $${params.length}`;
  }
  if (opts.before) {
    params.push(opts.before);
    where += ` AND created_at < $${params.length}`;
  }
  params.push(opts.limit);
  const rows = await sql<DeliveryRow>(
    `SELECT * FROM webhook_deliveries WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT $${params.length}`,
    params
  );
  return rows.map(toDelivery);
}

export interface AttemptRow {
  attempt: number;
  attemptedAt: number;
  statusCode: number | null;
  error: string | null;
  durationMs: number | null;
}

export async function listAttempts(deliveryId: string): Promise<AttemptRow[]> {
  const rows = await sql<{
    attempt: number;
    attempted_at: string;
    status_code: number | null;
    error: string | null;
    duration_ms: number | null;
  }>('SELECT * FROM webhook_delivery_attempts WHERE delivery_id = $1 ORDER BY attempt', [deliveryId]);
  return rows.map((r) => ({
    attempt: r.attempt,
    attemptedAt: Number(r.attempted_at),
    statusCode: r.status_code,
    error: r.error,
    durationMs: r.duration_ms,
  }));
}

/**
 * Claim up to `limit` due deliveries (FOR UPDATE SKIP LOCKED, so two claims
 * never take the same row) for `lockMs`.
 */
export async function claimDue(limit: number, lockMs: number): Promise<Delivery[]> {
  const now = Date.now();
  const rows = await sql<DeliveryRow>(
    `UPDATE webhook_deliveries d
        SET status = 'delivering', locked_until = $2
      WHERE d.id IN (
        SELECT w.id FROM webhook_deliveries w
          JOIN webhook_endpoints e ON e.id = w.endpoint_id AND e.active = TRUE
         WHERE w.status = 'pending' AND w.next_attempt_at <= $1
         ORDER BY w.next_attempt_at, w.created_at
         LIMIT $3
         FOR UPDATE OF w SKIP LOCKED)
      RETURNING d.*`,
    [now, now + lockMs, limit]
  );
  return rows.map(toDelivery).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

/** Deliveries left 'delivering' by a process that died go back to the queue. */
export async function releaseStaleLocks(): Promise<number> {
  const rows = await sql(
    `UPDATE webhook_deliveries SET status = 'pending', locked_until = NULL, next_attempt_at = COALESCE(next_attempt_at, $1)
      WHERE status = 'delivering' AND (locked_until IS NULL OR locked_until < $1)
      RETURNING id`,
    [Date.now()]
  );
  return rows.length;
}

export async function nextDueAt(): Promise<number | null> {
  const [row] = await sql<{ at: string | null }>(
    `SELECT MIN(w.next_attempt_at) AS at FROM webhook_deliveries w
       JOIN webhook_endpoints e ON e.id = w.endpoint_id AND e.active = TRUE
      WHERE w.status = 'pending'`
  );
  return num(row?.at ?? null);
}

export async function recordAttempt(input: {
  deliveryId: string;
  attempt: number;
  statusCode: number | null;
  error: string | null;
  durationMs: number;
  response: string | null;
  outcome: { status: 'succeeded' | 'failed' | 'pending'; nextAttemptAt: number | null };
}): Promise<void> {
  const now = Date.now();
  await db.withClient(async (client) => {
    await client.query('BEGIN');
    try {
      await client.query(
        `INSERT INTO webhook_delivery_attempts (delivery_id, attempt, attempted_at, status_code, error, duration_ms)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [input.deliveryId, input.attempt, now, input.statusCode, input.error, input.durationMs]
      );
      await client.query(
        `UPDATE webhook_deliveries
            SET attempts = $2, status = $3, next_attempt_at = $4, locked_until = NULL,
                last_status_code = $5, last_error = $6, last_response = $7, last_duration_ms = $8,
                completed_at = CASE WHEN $3 IN ('succeeded', 'failed') THEN $9::BIGINT ELSE NULL END
          WHERE id = $1 AND status = 'delivering'`,
        [
          input.deliveryId,
          input.attempt,
          input.outcome.status,
          input.outcome.nextAttemptAt,
          input.statusCode,
          input.error,
          input.response,
          input.durationMs,
          now,
        ]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

/** Keep the log bounded: deliveries finished more than `maxAgeMs` ago go. */
export async function pruneDeliveries(maxAgeMs: number): Promise<number> {
  const rows = await sql(
    `DELETE FROM webhook_deliveries WHERE status IN ('succeeded', 'failed', 'cancelled') AND completed_at < $1 RETURNING id`,
    [Date.now() - maxAgeMs]
  );
  return rows.length;
}

export async function deliveryCounts(endpointId: string): Promise<Record<DeliveryStatus, number>> {
  const rows = await sql<{ status: DeliveryStatus; n: string }>(
    `SELECT status, COUNT(*) AS n FROM webhook_deliveries WHERE endpoint_id = $1 GROUP BY status`,
    [endpointId]
  );
  const out: Record<DeliveryStatus, number> = { pending: 0, delivering: 0, succeeded: 0, failed: 0, cancelled: 0 };
  for (const r of rows) out[r.status] = Number(r.n);
  return out;
}
