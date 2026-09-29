import crypto from 'crypto';
import { expect, type APIRequestContext } from '@playwright/test';
import { verifySignature } from '../../api/src/services/webhooks/signing';
import type { WebhookEnvelope } from '../../api/src/services/webhooks/events';

/**
 * Helpers for the integrator webhook specs. The receiver is the API's own
 * test sink (routes/testWebhooks.ts): the E2E runner cannot be reached from
 * the API's container, so the API receives its own webhooks on loopback,
 * which needs "Allow webhooks to private and local addresses" on.
 */

/** Integrator tokens configured in CI (API_TOKENS_INTEGRATOR). */
export const INTEGRATOR = { label: 'ci-ntlan', token: 'ci-integrator-token-0123456789abcdef' };
export const OTHER_INTEGRATOR = { label: 'ci-other', token: 'ci-integrator2-token-0123456789abcdef' };
export const ADMIN_TOKEN = { label: 'ci-admin', token: 'ci-admin-token-0123456789abcdef' };
export const READONLY_TOKEN = { label: 'ci-readonly', token: 'ci-readonly-token-0123456789abcdef' };

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

export function newBin(prefix = 'bin'): string {
  return `${prefix}-${crypto.randomBytes(5).toString('hex')}`;
}

export async function sinkUrl(request: APIRequestContext, bin: string): Promise<string> {
  const res = await request.get(`/api/test/webhook-sink/${bin}/url`);
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()).url as string;
}

export interface Received {
  headers: Record<string, string>;
  body: string;
  envelope: WebhookEnvelope;
}

export async function received(request: APIRequestContext, bin: string): Promise<Received[]> {
  const res = await request.get(`/api/test/webhook-sink/${bin}`);
  expect(res.ok(), await res.text()).toBe(true);
  const list = (await res.json()).received as Array<{ headers: Record<string, string>; body: string }>;
  return list.map((r) => ({ ...r, envelope: JSON.parse(r.body) as WebhookEnvelope }));
}

export async function sinkBehaviour(
  request: APIRequestContext,
  bin: string,
  behaviour: { status?: number; times?: number; echo?: boolean }
): Promise<void> {
  const res = await request.post(`/api/test/webhook-sink/${bin}/behaviour`, { data: behaviour });
  expect(res.ok(), await res.text()).toBe(true);
}

export async function setAllowPrivate(request: APIRequestContext, value: boolean): Promise<void> {
  const res = await request.put('/api/settings', { data: { webhooksAllowPrivateTargets: value } });
  expect(res.ok(), await res.text()).toBe(true);
}

export async function setTiming(
  request: APIRequestContext,
  timing: { retryScale?: number; scoreThrottleMs?: number; attemptTimeoutMs?: number; reset?: boolean }
): Promise<void> {
  const res = await request.post('/api/test/webhooks/timing', { data: timing });
  expect(res.ok(), await res.text()).toBe(true);
}

export async function reconcile(request: APIRequestContext, slug: string): Promise<void> {
  const res = await request.post('/api/test/webhooks/reconcile', { data: { slug } });
  expect(res.ok(), await res.text()).toBe(true);
}

export interface CreatedEndpoint {
  id: string;
  secret: string;
}

export async function createEndpoint(
  request: APIRequestContext,
  data: { url: string; eventTypes?: string[]; source?: string | null; description?: string }
): Promise<CreatedEndpoint> {
  const res = await request.post('/api/webhooks', { data });
  expect(res.status(), await res.text()).toBe(201);
  const body = await res.json();
  expect(body.secret).toMatch(/^whsec_/);
  return { id: body.endpoint.id as string, secret: body.secret as string };
}

export async function deleteAllEndpoints(request: APIRequestContext): Promise<void> {
  const res = await request.get('/api/webhooks');
  if (!res.ok()) return;
  for (const e of (await res.json()).endpoints as Array<{ id: string }>) {
    await request.delete(`/api/webhooks/${e.id}`);
  }
}

/** Every signature header verifies with `secret`, and the headers match the body. */
export function expectSigned(r: Received, secret: string): void {
  expect(verifySignature(secret, r.headers['x-at-signature'], r.body)).toEqual({ ok: true });
  expect(r.headers['x-at-event']).toBe(r.envelope.type);
  expect(r.headers['x-at-event-id']).toBe(r.envelope.id);
  expect(r.headers['x-at-delivery']).toMatch(/^dlv_/);
  expect(r.headers['content-type']).toContain('application/json');
}

/** Wait until the sink has received events of these types (in any order) that pass `filter`, and return those. */
export async function waitForTypes(
  request: APIRequestContext,
  bin: string,
  types: string[],
  timeout = 30_000,
  filter: (r: Received) => boolean = () => true
): Promise<Received[]> {
  let last: Received[] = [];
  await expect
    .poll(
      async () => {
        last = (await received(request, bin)).filter(filter);
        const got = last.map((r) => r.envelope.type);
        return types.every((t) => (got as string[]).includes(t));
      },
      { timeout, message: `waiting for ${types.join(', ')}` }
    )
    .toBe(true);
  return last;
}

export function ofType(list: Received[], type: string): Received[] {
  return list.filter((r) => r.envelope.type === type);
}
