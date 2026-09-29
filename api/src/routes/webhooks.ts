/**
 * /api/webhooks — integrator webhook endpoints (admin).
 *
 * Register a URL, pick the event types, get a signing secret (shown once, on
 * create and on rotate), send a test event, read the delivery log (connect
 * details redacted) and resend a delivery. docs/WEBHOOKS.md is the
 * integrator's side of it.
 */

import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { log } from '../utils/logger';
import { settingsService } from '../services/settingsService';
import {
  createEndpoint,
  deleteEndpoint,
  deliveryView,
  endpointView,
  resendDelivery,
  rotateEndpointSecret,
  sendTestEvent,
  store,
  updateEndpoint,
  WebhookInputError,
} from '../services/webhooks';
import { WEBHOOK_API_VERSION, WEBHOOK_EVENT_CATALOG } from '../services/webhooks/events';
import { MAX_ATTEMPTS, RETRY_DELAYS_MS } from '../services/webhooks/retry';
import type { DeliveryStatus } from '../services/webhooks/store';

const router = Router();

router.use(requireAuth);

function fail(res: Response, error: unknown, what: string): Response {
  if (error instanceof WebhookInputError) {
    return res.status(error.status).json({ success: false, error: error.message });
  }
  log.error(`[Webhooks] ${what}`, error);
  return res.status(500).json({ success: false, error: what });
}

/**
 * GET /api/webhooks
 * Every endpoint (without its secret) with delivery counts, the event types,
 * and whether private / local targets are allowed.
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const endpoints = await store.listEndpoints();
    return res.json({
      success: true,
      apiVersion: WEBHOOK_API_VERSION,
      allowPrivateTargets: await settingsService.areWebhookPrivateTargetsAllowed(),
      eventTypes: WEBHOOK_EVENT_CATALOG,
      retrySchedule: { maxAttempts: MAX_ATTEMPTS, delaysMs: RETRY_DELAYS_MS },
      endpoints: await Promise.all(endpoints.map(endpointView)),
    });
  } catch (error) {
    return fail(res, error, 'Failed to list webhook endpoints');
  }
});

/**
 * GET /api/webhooks/event-types
 * The event type ids and when each fires.
 */
router.get('/event-types', (_req: Request, res: Response) => {
  return res.json({ success: true, apiVersion: WEBHOOK_API_VERSION, eventTypes: WEBHOOK_EVENT_CATALOG });
});

/**
 * POST /api/webhooks
 * Body `{ url, eventTypes?: string[] (default ["*"]), description?, active?, source? }`.
 * The response holds the signing `secret`: it is shown this once.
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { endpoint, secret } = await createEndpoint((req.body ?? {}) as Record<string, unknown>);
    return res.status(201).json({ success: true, endpoint, secret });
  } catch (error) {
    return fail(res, error, 'Failed to create webhook endpoint');
  }
});

/**
 * GET /api/webhooks/deliveries/:deliveryId
 * One delivery with its attempts; the payload has connect details redacted.
 */
router.get('/deliveries/:deliveryId', async (req: Request, res: Response) => {
  try {
    const delivery = await store.getDelivery(req.params.deliveryId);
    if (!delivery) return res.status(404).json({ success: false, error: 'Delivery not found' });
    return res.json({
      success: true,
      delivery: { ...deliveryView(delivery), attemptLog: await store.listAttempts(delivery.id) },
    });
  } catch (error) {
    return fail(res, error, 'Failed to read delivery');
  }
});

/**
 * POST /api/webhooks/deliveries/:deliveryId/resend
 * Queue the same event again as a new delivery (new X-AT-Delivery; same event id and body).
 */
router.post('/deliveries/:deliveryId/resend', async (req: Request, res: Response) => {
  try {
    const delivery = await resendDelivery(req.params.deliveryId);
    return res.status(202).json({ success: true, delivery: deliveryView(delivery) });
  } catch (error) {
    return fail(res, error, 'Failed to resend delivery');
  }
});

/**
 * GET /api/webhooks/:id
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const endpoint = await store.getEndpoint(req.params.id);
    if (!endpoint) return res.status(404).json({ success: false, error: 'Webhook endpoint not found' });
    return res.json({ success: true, endpoint: await endpointView(endpoint) });
  } catch (error) {
    return fail(res, error, 'Failed to read webhook endpoint');
  }
});

/**
 * PATCH /api/webhooks/:id
 * Any of `{ url, eventTypes, description, active, source }`. Switching an
 * endpoint off cancels what it has queued; switching it on clears an
 * automatic disable.
 */
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const endpoint = await updateEndpoint(req.params.id, (req.body ?? {}) as Record<string, unknown>);
    return res.json({ success: true, endpoint });
  } catch (error) {
    return fail(res, error, 'Failed to update webhook endpoint');
  }
});

/**
 * DELETE /api/webhooks/:id
 * Removes the endpoint and its delivery log.
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const deleted = await deleteEndpoint(req.params.id);
    if (!deleted) return res.status(404).json({ success: false, error: 'Webhook endpoint not found' });
    return res.json({ success: true });
  } catch (error) {
    return fail(res, error, 'Failed to delete webhook endpoint');
  }
});

/**
 * POST /api/webhooks/:id/rotate-secret
 * Body `{ graceHours?: number }` (default 24, 0-168): how long the old secret
 * still signs deliveries alongside the new one. The new `secret` is shown once.
 */
router.post('/:id/rotate-secret', async (req: Request, res: Response) => {
  try {
    const { endpoint, secret } = await rotateEndpointSecret(
      req.params.id,
      (req.body as { graceHours?: unknown } | undefined)?.graceHours
    );
    return res.json({ success: true, endpoint, secret });
  } catch (error) {
    return fail(res, error, 'Failed to rotate webhook secret');
  }
});

/**
 * POST /api/webhooks/:id/test
 * Body `{ type?: event type (default "match.ready"), matchSlug?: string }`.
 * Queues a signed test delivery shaped like the real event (`test: true`,
 * made-up connect details); with `matchSlug`, built from that match.
 */
router.post('/:id/test', async (req: Request, res: Response) => {
  try {
    const delivery = await sendTestEvent(req.params.id, (req.body ?? {}) as Record<string, unknown>);
    return res.status(202).json({ success: true, delivery: deliveryView(delivery) });
  } catch (error) {
    return fail(res, error, 'Failed to send test event');
  }
});

/**
 * GET /api/webhooks/:id/deliveries
 * The delivery log, newest first. Query: `status`, `limit` (1-200, default
 * 50), `before` (epoch ms, for the next page). Payloads have connect
 * details redacted.
 */
router.get('/:id/deliveries', async (req: Request, res: Response) => {
  try {
    const endpoint = await store.getEndpoint(req.params.id);
    if (!endpoint) return res.status(404).json({ success: false, error: 'Webhook endpoint not found' });
    const statuses: DeliveryStatus[] = ['pending', 'delivering', 'succeeded', 'failed', 'cancelled'];
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    if (status !== undefined && !statuses.includes(status as DeliveryStatus)) {
      return res.status(400).json({ success: false, error: `status must be one of ${statuses.join(', ')}` });
    }
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const before = Number(req.query.before) || undefined;
    const deliveries = await store.listDeliveries({
      endpointId: endpoint.id,
      status: status as DeliveryStatus | undefined,
      limit,
      before,
    });
    return res.json({ success: true, deliveries: deliveries.map(deliveryView) });
  } catch (error) {
    return fail(res, error, 'Failed to list deliveries');
  }
});

export default router;
