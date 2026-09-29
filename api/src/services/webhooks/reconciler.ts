/**
 * Turns match changes into webhook events (./diff) and queues them.
 *
 * Woken by core/matchChangeBus (every socket match update and live score
 * change), debounced per match so a burst of changes is looked at once, and
 * swept every 20 s for the matches in play (which also catches a change
 * nothing announced, and a deleted match). One match is reconciled at a time.
 *
 * Does nothing while no endpoint is switched on.
 */

import crypto from 'crypto';
import { log } from '../../utils/logger';
import { onMatchChanged, type MatchChangeRef } from '../../core/matchChangeBus';
import { diffMatch, TERMINAL_STATUSES, type AnnouncedState, type DerivedEvent } from './diff';
import { WEBHOOK_API_VERSION, type WebhookEnvelope, type WebhookEventData, type WebhookMatch } from './events';
import { buildMatchPayload, forEndpoint, readMatchFacts, readMatchRow, type MatchFacts } from './matchPayload';
import {
  insertDelivery,
  listActiveEndpoints,
  newId,
  sql,
  subscribes,
  type Delivery,
  type WebhookEndpointWithSecrets,
} from './store';
import { wakeWorker, webhookTiming } from './worker';

const DEBOUNCE_MS = 300;
const SWEEP_MS = 20_000;

interface StoredState extends AnnouncedState {
  /** The last payload (without connect), for the match.cancelled of a deleted match. */
  last?: WebhookMatch | null;
}

let unsubscribe: (() => void) | null = null;
let sweepTimer: NodeJS.Timeout | null = null;
const pending = new Map<string, NodeJS.Timeout>();
const chains = new Map<string, Promise<void>>();

/** Active endpoints, cached briefly: this runs on every live score change. */
let endpointCache: { at: number; list: WebhookEndpointWithSecrets[] } | null = null;
const ENDPOINT_CACHE_MS = 5_000;

export function invalidateEndpointCache(): void {
  endpointCache = null;
}

async function activeEndpoints(): Promise<WebhookEndpointWithSecrets[]> {
  if (endpointCache && Date.now() - endpointCache.at < ENDPOINT_CACHE_MS) return endpointCache.list;
  const list = await listActiveEndpoints();
  endpointCache = { at: Date.now(), list };
  return list;
}

export function startReconciler(): void {
  if (unsubscribe) return;
  unsubscribe = onMatchChanged((ref) => noteMatchChanged(ref));
  sweepTimer = setInterval(() => void sweep(), SWEEP_MS);
  sweepTimer.unref?.();
  void sweep();
}

export function stopReconciler(): void {
  unsubscribe?.();
  unsubscribe = null;
  if (sweepTimer) clearInterval(sweepTimer);
  sweepTimer = null;
  for (const t of pending.values()) clearTimeout(t);
  pending.clear();
}

function noteMatchChanged(ref: MatchChangeRef): void {
  if (!unsubscribe) return;
  if (!ref.slug) {
    // Only an id: look the slug up, then carry on as usual.
    if (typeof ref.id === 'number') {
      void readMatchRow({ id: ref.id })
        .then((row) => row && noteMatchChanged({ slug: row.slug }))
        .catch(() => undefined);
    }
    return;
  }
  schedule(ref.slug, DEBOUNCE_MS);
}

function schedule(slug: string, delayMs: number): void {
  const existing = pending.get(slug);
  if (existing) clearTimeout(existing);
  const t = setTimeout(() => {
    pending.delete(slug);
    void reconcileMatch(slug);
  }, Math.max(0, delayMs));
  t.unref?.();
  pending.set(slug, t);
}

/** Reconcile one match now, after any reconcile of it already running. */
export function reconcileMatch(slug: string): Promise<void> {
  const previous = chains.get(slug) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(() => reconcileNow(slug))
    .catch((error) => {
      log.warn('[Webhooks] Could not work out the events of a match change', {
        matchSlug: slug,
        error: error instanceof Error ? error.message : String(error),
      });
    })
    .finally(() => {
      if (chains.get(slug) === next) chains.delete(slug);
    });
  chains.set(slug, next);
  return next;
}

/** Every match in play, and every match last announced as in play (it may be gone since). */
async function sweep(): Promise<void> {
  try {
    if ((await activeEndpoints()).length === 0) return;
    const rows = await sql<{ slug: string }>(
      `SELECT slug FROM matches WHERE status IN ('loaded', 'live')
       UNION
       SELECT match_slug AS slug FROM webhook_match_state
        WHERE (state::jsonb ->> 'status') IN ('loaded', 'live')`
    );
    for (const { slug } of rows) await reconcileMatch(slug);
    // States of matches that are gone and were not in play owe nothing: forget them.
    await sql(
      `DELETE FROM webhook_match_state s
        WHERE (s.state::jsonb ->> 'status') NOT IN ('loaded', 'live')
          AND NOT EXISTS (SELECT 1 FROM matches m WHERE m.slug = s.match_slug)`
    );
  } catch (error) {
    log.debug('[Webhooks] Sweep failed', { error: error instanceof Error ? error.message : String(error) });
  }
}

async function loadState(slug: string): Promise<StoredState | null> {
  const [row] = await sql<{ state: string }>('SELECT state FROM webhook_match_state WHERE match_slug = $1', [slug]);
  if (!row) return null;
  try {
    return JSON.parse(row.state) as StoredState;
  } catch {
    return null;
  }
}

async function saveState(slug: string, state: StoredState): Promise<void> {
  await sql(
    `INSERT INTO webhook_match_state (match_slug, state, updated_at) VALUES ($1, $2, $3)
     ON CONFLICT (match_slug) DO UPDATE SET state = EXCLUDED.state, updated_at = EXCLUDED.updated_at`,
    [slug, JSON.stringify(state), Date.now()]
  );
}

async function deleteState(slug: string): Promise<void> {
  await sql('DELETE FROM webhook_match_state WHERE match_slug = $1', [slug]);
}

/** A digest of how to join, so the stored state holds no password. */
function connectKeyOf(facts: MatchFacts): string | null {
  const c = facts.connect;
  if (!c) return null;
  return crypto.createHash('sha256').update(`${c.host}|${c.port}|${c.password ?? ''}`).digest('hex').slice(0, 16);
}

async function reconcileNow(slug: string): Promise<void> {
  const endpoints = await activeEndpoints();
  if (endpoints.length === 0) return;

  const prev = await loadState(slug);
  const row = await readMatchRow({ slug });

  if (!row) {
    // Deleted. A match that was still on its way owes a match.cancelled.
    if (prev && !TERMINAL_STATUSES.has(prev.status) && prev.last) {
      await fanOut(
        endpoints,
        [{ type: 'match.cancelled', reason: 'deleted', previousStatus: prev.status }],
        { ...prev.last, status: 'cancelled', connect: null },
        slug,
        prev.sequence
      );
    }
    if (prev) await deleteState(slug);
    return;
  }

  const facts = await readMatchFacts(row);
  const result = diffMatch(
    prev,
    {
      status: facts.status,
      connectKey: connectKeyOf(facts),
      mapNumber: facts.mapNumber,
      mapScore: facts.mapScore,
      finishedMaps: facts.results.map((r) => r.mapNumber),
    },
    { now: Date.now(), scoreThrottleMs: webhookTiming.scoreThrottleMs }
  );

  let last = prev?.last ?? null;
  let sequence = result.next.sequence;
  if (result.events.length > 0 || !prev) {
    const match = await buildMatchPayload(facts);
    last = { ...match, connect: null };
    if (result.events.length > 0) {
      sequence = await fanOut(endpoints, result.events, match, slug, sequence);
    }
  }
  await saveState(slug, { ...result.next, sequence, last });
  if (result.recheckAt !== null) schedule(slug, result.recheckAt - Date.now());
}

/** Queue one delivery per event per subscribed endpoint. Returns the last sequence used. */
async function fanOut(
  endpoints: WebhookEndpointWithSecrets[],
  events: DerivedEvent[],
  match: WebhookMatch,
  slug: string,
  sequence: number
): Promise<number> {
  let queued = 0;
  for (const event of events) {
    sequence += 1;
    const data: WebhookEventData = { match, sequence };
    if (event.mapNumber !== undefined && event.type === 'match.map_ended') {
      const map = match.maps.find((m) => m.number === event.mapNumber! + 1);
      if (map) data.map = map;
    }
    if (event.previousStatus !== undefined) data.previous_status = event.previousStatus;
    if (event.reason) data.reason = event.reason;
    // Only the events that say so carry connect details.
    if (event.type === 'match.finished' || event.type === 'match.cancelled' || event.type === 'match.reset') {
      data.match = { ...match, connect: null };
    }
    const envelope: WebhookEnvelope = {
      id: newId('evt'),
      type: event.type,
      created_at: new Date().toISOString(),
      api_version: WEBHOOK_API_VERSION,
      test: false,
      data,
    };
    queued += (await enqueueEnvelope(endpoints, envelope, slug)).length;
  }
  if (queued > 0) wakeWorker();
  return sequence;
}

/** One delivery per subscribed endpoint, with that endpoint's `external_id`. Returns them. */
export async function enqueueEnvelope(
  endpoints: WebhookEndpointWithSecrets[],
  envelope: WebhookEnvelope,
  slug: string | null
): Promise<Delivery[]> {
  const out: Delivery[] = [];
  for (const endpoint of endpoints) {
    if (!subscribes(endpoint, envelope.type)) continue;
    const body = JSON.stringify({
      ...envelope,
      data: { ...envelope.data, match: forEndpoint(envelope.data.match, endpoint.source) },
    });
    out.push(
      await insertDelivery({
        endpointId: endpoint.id,
        eventId: envelope.id,
        eventType: envelope.type,
        matchSlug: slug,
        body,
        test: envelope.test,
      })
    );
  }
  return out;
}
