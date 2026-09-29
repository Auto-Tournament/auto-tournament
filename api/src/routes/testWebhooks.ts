/**
 * Test-only helpers for the integrator webhooks (ENABLE_TEST_ENDPOINTS).
 *
 * The E2E runner cannot receive webhooks itself (the API runs in a container
 * that cannot reach it), so the API hosts the receiver: a "sink" that records
 * what it is sent and answers as told.
 *
 *   POST   /api/test/webhook-sink/:bin           the receiver (no auth, like a real one)
 *   GET    /api/test/webhook-sink/:bin           what it received: headers and body
 *   DELETE /api/test/webhook-sink/:bin           forget it
 *   POST   /api/test/webhook-sink/:bin/behaviour { status, times, echo } answer `status`
 *                                                for the next `times` requests; `echo`
 *                                                sends the body back in the answer
 *   GET    /api/test/webhook-sink/:bin/url       the URL to register (this process, loopback)
 *   POST   /api/test/webhooks/timing             { retryScale, scoreThrottleMs, attemptTimeoutMs }
 *   POST   /api/test/webhooks/reconcile          { slug } look at a match now
 *
 * The recorded body is the parsed JSON stringified again: the global JSON
 * parser has consumed the stream by the time a router sees it, and our bodies
 * are JSON.stringify output, which stringifies back to the same bytes.
 */

import type { Request, Response, Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { reconcileMatch } from '../services/webhooks';
import { webhookTiming } from '../services/webhooks/worker';

interface SinkEntry {
  headers: Record<string, string | string[] | undefined>;
  body: string;
  receivedAt: number;
}

interface Sink {
  received: SinkEntry[];
  failNext: number;
  failStatus: number;
  echo: boolean;
}

const sinks = new Map<string, Sink>();
const BIN = /^[A-Za-z0-9_-]{1,64}$/;

function sinkFor(bin: string): Sink {
  let sink = sinks.get(bin);
  if (!sink) {
    sink = { received: [], failNext: 0, failStatus: 500, echo: false };
    sinks.set(bin, sink);
  }
  return sink;
}

const DEFAULT_TIMING = { ...webhookTiming };

export function registerWebhookTestRoutes(router: Router, helpersEnabled: (res: Response) => boolean): void {
  router.post('/webhook-sink/:bin', (req: Request, res: Response): void => {
    if (!helpersEnabled(res)) return;
    if (!BIN.test(req.params.bin)) {
      res.status(400).json({ error: 'bad bin' });
      return;
    }
    const sink = sinkFor(req.params.bin);
    const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? null);
    sink.received.push({ headers: { ...req.headers }, body, receivedAt: Date.now() });
    if (sink.received.length > 500) sink.received.shift();
    if (sink.failNext > 0) {
      sink.failNext--;
      res.status(sink.failStatus).type('text/plain').send(sink.echo ? body : 'sink says no');
      return;
    }
    res.status(200).type('text/plain').send(sink.echo ? body : 'ok');
  });

  router.get('/webhook-sink/:bin/url', requireAuth, (req: Request, res: Response): void => {
    if (!helpersEnabled(res)) return;
    const port = process.env.PORT || 3000;
    res.json({ success: true, url: `http://127.0.0.1:${port}/api/test/webhook-sink/${encodeURIComponent(req.params.bin)}` });
  });

  router.post('/webhook-sink/:bin/behaviour', requireAuth, (req: Request, res: Response): void => {
    if (!helpersEnabled(res)) return;
    const sink = sinkFor(req.params.bin);
    const body = (req.body ?? {}) as { status?: unknown; times?: unknown; echo?: unknown };
    sink.failStatus = typeof body.status === 'number' ? body.status : 500;
    sink.failNext = typeof body.times === 'number' ? body.times : 0;
    sink.echo = body.echo === true;
    res.json({ success: true });
  });

  router.get('/webhook-sink/:bin', requireAuth, (req: Request, res: Response): void => {
    if (!helpersEnabled(res)) return;
    res.json({ success: true, received: sinks.get(req.params.bin)?.received ?? [] });
  });

  router.delete('/webhook-sink/:bin', requireAuth, (req: Request, res: Response): void => {
    if (!helpersEnabled(res)) return;
    sinks.delete(req.params.bin);
    res.json({ success: true });
  });

  router.post('/webhooks/timing', requireAuth, (req: Request, res: Response): void => {
    if (!helpersEnabled(res)) return;
    const body = (req.body ?? {}) as Partial<Record<keyof typeof webhookTiming, unknown>> & { reset?: unknown };
    if (body.reset === true) Object.assign(webhookTiming, DEFAULT_TIMING);
    for (const key of Object.keys(DEFAULT_TIMING) as Array<keyof typeof webhookTiming>) {
      const v = body[key];
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) webhookTiming[key] = v;
    }
    res.json({ success: true, timing: webhookTiming });
  });

  router.post('/webhooks/reconcile', requireAuth, async (req: Request, res: Response): Promise<void> => {
    if (!helpersEnabled(res)) return;
    const slug = (req.body as { slug?: unknown } | undefined)?.slug;
    if (typeof slug !== 'string' || !slug) {
      res.status(400).json({ success: false, error: 'slug is required' });
      return;
    }
    await reconcileMatch(slug);
    res.json({ success: true });
  });
}
