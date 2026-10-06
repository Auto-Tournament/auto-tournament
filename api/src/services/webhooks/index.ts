/**
 * Integrator webhooks: signed HTTP callbacks for match events.
 *
 * - ./events      the event type ids and the payload contract
 * - ./diff        which events a match change means (pure)
 * - ./reconciler  watches matches (core/matchChangeBus) and queues events
 * - ./worker      the persisted delivery queue: signing, retries, auto-disable
 * - ./deliver     one HTTP attempt, SSRF-checked (./ssrf)
 * - ./store       the tables
 *
 * This file is what routes/webhooks.ts and index.ts use.
 */

import { log } from '../../utils/logger';
import { settingsService } from '../settingsService';
import { WEBHOOK_API_VERSION, isWebhookEventType, type WebhookEnvelope, type WebhookEventType } from './events';
import { redactDeliveryBody } from './redact';
import { invalidateEndpointCache, enqueueEnvelope, reconcileMatch, startReconciler, stopReconciler } from './reconciler';
import { sampleEnvelope, sampleMatch } from './samples';
import { generateWebhookSecret } from './signing';
import { checkWebhookUrlSyntax, resolveWebhookTarget, WebhookTargetError } from './ssrf';
import { buildMatchPayload, readMatchFacts, readMatchRow } from './matchPayload';
import * as store from './store';
import { startWorker, stopWorker, wakeWorker } from './worker';
import { SOURCE_PATTERN } from '../teamExternalIds';
import { isDiscordWebhookUrl } from './discord';
import { matchPageUrl, platformOrigin } from './links';

export { reconcileMatch };

/**
 * `admin.called`: a player typed .admin in a match. One delivery per endpoint
 * subscribed to it, with the match (connect details included while the match
 * is on a server) and the call. A call outside a match sends nothing.
 */
export async function emitAdminCalledWebhook(call: AdminCallForWebhook): Promise<void> {
  await emitAdminCallEvent('admin.called', call);
}

/**
 * `admin.call_resolved`: an admin answered a call. Same shape as admin.called
 * plus who answered and their note; no connect details (nothing to join).
 */
export async function emitAdminCallResolvedWebhook(
  call: AdminCallForWebhook,
  resolution: { by: string | null; note: string | null }
): Promise<void> {
  await emitAdminCallEvent('admin.call_resolved', call, resolution);
}

interface AdminCallForWebhook {
  callId: string;
  matchSlug: string | null;
  mapNumber: number | null;
  serverId: string | null;
  serverName: string | null;
  player: { steamId: string | null; name: string | null; team: string | null; teamName: string | null };
  message: string;
  calledAt: string;
}

async function emitAdminCallEvent(
  type: 'admin.called' | 'admin.call_resolved',
  call: AdminCallForWebhook,
  resolution?: { by: string | null; note: string | null }
): Promise<void> {
  if (!call.matchSlug) return;
  const endpoints = (await store.listActiveEndpoints()).filter((e) => store.subscribes(e, type));
  if (endpoints.length === 0) return;
  const row = await readMatchRow({ slug: call.matchSlug });
  if (!row) return;
  const match = await buildMatchPayload(await readMatchFacts(row));
  if (type === 'admin.call_resolved') match.connect = null;
  const origin = await platformOrigin();
  const team = call.player.team === 'team1' || call.player.team === 'team2' ? call.player.team : null;
  const envelope: WebhookEnvelope = {
    id: store.newId('evt'),
    type,
    created_at: new Date().toISOString(),
    api_version: WEBHOOK_API_VERSION,
    test: false,
    data: {
      match,
      admin_call: {
        id: call.callId,
        player: { steam_id64: call.player.steamId, name: call.player.name, team, team_name: call.player.teamName },
        message: call.message,
        map_number: call.mapNumber,
        server: { id: call.serverId, name: call.serverName },
        match_url: matchPageUrl(origin, call.matchSlug),
        called_at: call.calledAt,
      },
      ...(resolution ? { resolved_by: resolution.by, resolution_note: resolution.note } : {}),
      sequence: 0,
    },
  };
  const queued = await enqueueEnvelope(endpoints, envelope, call.matchSlug);
  if (queued.length > 0) wakeWorker();
}

export function startWebhooks(): void {
  startWorker();
  startReconciler();
}

export function stopWebhooks(): void {
  stopReconciler();
  stopWorker();
}

export class WebhookInputError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
    this.name = 'WebhookInputError';
  }
}

/** Longest grace the previous secret can be given on rotation (7 days). */
export const MAX_ROTATION_GRACE_HOURS = 168;
export const DEFAULT_ROTATION_GRACE_HOURS = 24;

async function checkUrl(raw: unknown): Promise<string> {
  const allowPrivate = await settingsService.areWebhookPrivateTargetsAllowed();
  try {
    const url = checkWebhookUrlSyntax(raw, allowPrivate);
    try {
      await resolveWebhookTarget(url, allowPrivate);
    } catch (error) {
      // A name that does not resolve yet is allowed (DNS may come later);
      // one that resolves somewhere forbidden is not.
      if (!(error instanceof WebhookTargetError) || error.code !== 'dns_failed') throw error;
    }
    return url.toString();
  } catch (error) {
    if (error instanceof WebhookTargetError) throw new WebhookInputError(error.message);
    throw error;
  }
}

function cleanDescription(raw: unknown): string {
  if (raw === undefined || raw === null) return '';
  if (typeof raw !== 'string') throw new WebhookInputError('description must be a string');
  const trimmed = raw.trim();
  if (trimmed.length > 500) throw new WebhookInputError('description must be at most 500 characters');
  return trimmed;
}

function cleanSource(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string' || !SOURCE_PATTERN.test(raw.trim())) {
    throw new WebhookInputError('source must be an API token label: 1-32 letters, digits, _ or -');
  }
  return raw.trim();
}

function cleanEventTypes(raw: unknown): string[] {
  const result = store.normalizeEventTypes(raw);
  if (!result.ok) throw new WebhookInputError(result.error);
  return result.types;
}

/** 'signed' (default) or 'discord'. */
function cleanFormat(raw: unknown): store.WebhookFormat {
  if (raw === undefined || raw === null || raw === '') return 'signed';
  if (typeof raw !== 'string' || !(store.WEBHOOK_FORMATS as readonly string[]).includes(raw)) {
    throw new WebhookInputError(`format must be one of: ${store.WEBHOOK_FORMATS.join(', ')}`);
  }
  return raw as store.WebhookFormat;
}

/** A Discord endpoint must be a Discord webhook URL (it gets Discord's message format). */
function checkFormatUrl(format: store.WebhookFormat, url: string): void {
  if (format === 'discord' && !isDiscordWebhookUrl(url)) {
    throw new WebhookInputError('A Discord endpoint needs a Discord webhook URL (https://discord.com/api/webhooks/...)');
  }
}

export async function createEndpoint(body: Record<string, unknown>): Promise<{ endpoint: store.WebhookEndpoint; secret: string }> {
  const url = await checkUrl(body.url);
  const format = cleanFormat(body.format);
  checkFormatUrl(format, url);
  if (body.active !== undefined && typeof body.active !== 'boolean') throw new WebhookInputError('active must be a boolean');
  const secret = generateWebhookSecret();
  const created = await store.insertEndpoint({
    url,
    description: cleanDescription(body.description),
    eventTypes: cleanEventTypes(body.eventTypes),
    active: body.active !== false,
    source: cleanSource(body.source),
    format,
    secret,
  });
  invalidateEndpointCache();
  log.success(`[Webhooks] Endpoint ${created.id} added for ${url}`);
  return { endpoint: store.publicEndpoint(created), secret };
}

export async function updateEndpoint(id: string, body: Record<string, unknown>): Promise<store.WebhookEndpoint> {
  const existing = await store.getEndpoint(id);
  if (!existing) throw new WebhookInputError(`Webhook endpoint '${id}' not found`, 404);
  const patch: Parameters<typeof store.updateEndpoint>[1] = {};
  if (body.url !== undefined) patch.url = await checkUrl(body.url);
  if (body.description !== undefined) patch.description = cleanDescription(body.description);
  if (body.eventTypes !== undefined) patch.eventTypes = cleanEventTypes(body.eventTypes);
  if (body.source !== undefined) patch.source = cleanSource(body.source);
  if (body.format !== undefined) patch.format = cleanFormat(body.format);
  checkFormatUrl(patch.format ?? existing.format, patch.url ?? existing.url);
  if (body.active !== undefined) {
    if (typeof body.active !== 'boolean') throw new WebhookInputError('active must be a boolean');
    patch.active = body.active;
  }
  const updated = await store.updateEndpoint(id, patch);
  if (!updated) throw new WebhookInputError(`Webhook endpoint '${id}' not found`, 404);
  if (patch.active === false && existing.active) {
    await store.cancelPendingFor(id, 'endpoint switched off');
  }
  invalidateEndpointCache();
  wakeWorker();
  return store.publicEndpoint(updated);
}

export async function deleteEndpoint(id: string): Promise<boolean> {
  const deleted = await store.deleteEndpoint(id);
  invalidateEndpointCache();
  return deleted;
}

export async function rotateEndpointSecret(
  id: string,
  graceHoursRaw: unknown
): Promise<{ endpoint: store.WebhookEndpoint; secret: string }> {
  let graceHours = DEFAULT_ROTATION_GRACE_HOURS;
  if (graceHoursRaw !== undefined) {
    if (typeof graceHoursRaw !== 'number' || !Number.isFinite(graceHoursRaw) || graceHoursRaw < 0 || graceHoursRaw > MAX_ROTATION_GRACE_HOURS) {
      throw new WebhookInputError(`graceHours must be a number from 0 to ${MAX_ROTATION_GRACE_HOURS}`);
    }
    graceHours = graceHoursRaw;
  }
  const secret = generateWebhookSecret();
  const updated = await store.rotateSecret(id, secret, Math.round(graceHours * 3_600_000));
  if (!updated) throw new WebhookInputError(`Webhook endpoint '${id}' not found`, 404);
  invalidateEndpointCache();
  log.info(`[Webhooks] Secret of endpoint ${id} rotated (previous secret valid for ${graceHours} h)`);
  return { endpoint: store.publicEndpoint(updated), secret };
}

/**
 * Queue a test event of `type` to one endpoint: the sample payload (./samples),
 * or with `matchSlug` that real match as it is now, with made-up connect
 * details. Always `test: true`, signed and retried like any delivery. A
 * switched-off endpoint is refused (409).
 */
export async function sendTestEvent(id: string, body: Record<string, unknown>): Promise<store.Delivery> {
  const endpoint = await store.getEndpoint(id);
  if (!endpoint) throw new WebhookInputError(`Webhook endpoint '${id}' not found`, 404);
  if (!endpoint.active) throw new WebhookInputError('The endpoint is switched off; switch it on to send it a test event', 409);
  const type = body.type ?? 'match.ready';
  if (!isWebhookEventType(type)) throw new WebhookInputError(`Unknown event type: ${String(type)}`);

  const envelope: WebhookEnvelope = sampleEnvelope(type as WebhookEventType, {
    id: store.newId('evt'),
    createdAt: new Date(),
    test: true,
    source: endpoint.source ?? undefined,
  });
  let slug: string | null = null;
  if (body.matchSlug !== undefined) {
    if (typeof body.matchSlug !== 'string') throw new WebhookInputError('matchSlug must be a string');
    const row = await readMatchRow({ slug: body.matchSlug });
    if (!row) throw new WebhookInputError(`Match '${body.matchSlug}' not found`, 404);
    const real = await buildMatchPayload(await readMatchFacts(row));
    const sample = sampleMatch(type as WebhookEventType);
    envelope.data.match = { ...real, connect: sample.connect };
    slug = row.slug;
  }
  envelope.api_version = WEBHOOK_API_VERSION;

  // Sent whether or not the endpoint subscribes to the type: it is what the admin asked for.
  const [delivery] = await enqueueEnvelope([{ ...endpoint, eventTypes: ['*'] }], envelope, slug);
  wakeWorker();
  return delivery;
}

/** Send a delivery's event again as a new delivery (new X-AT-Delivery, same event id and body). */
export async function resendDelivery(deliveryId: string): Promise<store.Delivery> {
  const original = await store.getDelivery(deliveryId);
  if (!original) throw new WebhookInputError(`Delivery '${deliveryId}' not found`, 404);
  const endpoint = await store.getEndpoint(original.endpointId);
  if (!endpoint) throw new WebhookInputError('Its endpoint no longer exists', 404);
  if (!endpoint.active) throw new WebhookInputError('The endpoint is switched off; switch it on to resend', 409);
  const copy = await store.insertDelivery({
    endpointId: original.endpointId,
    eventId: original.eventId,
    eventType: original.eventType,
    matchSlug: original.matchSlug,
    body: original.body,
    test: original.test,
    resendOf: original.id,
  });
  wakeWorker();
  return copy;
}

/** A delivery as the admin API shows it: the body with connect details redacted. */
export function deliveryView(d: store.Delivery): Record<string, unknown> {
  const { body, ...rest } = d;
  return { ...rest, payload: redactDeliveryBody(body) };
}

export async function endpointView(e: store.WebhookEndpointWithSecrets): Promise<Record<string, unknown>> {
  return { ...store.publicEndpoint(e), deliveries: await store.deliveryCounts(e.id) };
}

export { store };
