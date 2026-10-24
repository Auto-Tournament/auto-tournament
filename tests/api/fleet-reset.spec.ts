import { test, expect, type APIRequestContext } from '@playwright/test';
import { getAuthHeader, signInViaRequest } from '../helpers/auth';
import { createFleetKey, resetEnrollRateLimit } from '../helpers/fleet';
import { FakeReadyUp, createMatch, link, matchRow } from '../helpers/fleetFake';

/**
 * Reset a Ready Up server (POST /api/fleet/servers/:id/reset): cmd reset ends
 * whatever it holds, and the platform settles the match it had there.
 *
 * @tag api
 * @tag fleet
 */

const reset = (request: APIRequestContext, id: string) =>
  request.post(`/api/fleet/servers/${id}/reset`, { headers: getAuthHeader() });

test.describe.serial('Fleet reset', () => {
  let key: { id: string; value: string };
  const fakes: FakeReadyUp[] = [];

  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    await resetEnrollRateLimit(request);
    if (!key) key = await createFleetKey(request, { name: 'fleet-reset-tests' });
  });

  test.afterAll(() => {
    for (const f of fakes) f.close();
  });

  const online = async (request: APIRequestContext, over: Record<string, unknown> = {}) => {
    const fake = await FakeReadyUp.enroll(request, key.value);
    fakes.push(fake);
    await fake.hello({ availability: 'busy', ...over });
    return fake;
  };

  test('reset of an offline server is 409 offline', async ({ request }) => {
    const fake = await FakeReadyUp.enroll(request, key.value);
    fakes.push(fake);
    const res = await reset(request, fake.serverId);
    expect(res.status()).toBe(409);
    expect((await res.json()).errorCode).toBe('offline');
  });

  test('reset of an idle server sends cmd reset and ends nothing', async ({ request }) => {
    const fake = await online(request, { availability: 'available' });
    const res = reset(request, fake.serverId);
    const cmd = await fake.next('cmd');
    expect(cmd.payload).toMatchObject({ name: 'reset', args: {} });
    expect(cmd.payload).not.toHaveProperty('match_id');
    expect((cmd.payload as { audit_id?: string }).audit_id).toBeTruthy();
    fake.answer(cmd, 'ok', { result: { ended: 'none', match_id: null } });
    expect(await (await res).json()).toEqual({ ok: true, ended: 'none', settledMatchSlug: null });
  });

  test('reset settles the match the platform had there', async ({ request }) => {
    const fake = await online(request);
    const cs2Id = await link(request, fake.serverId);
    const slug = `reset-${Date.now()}`;
    await createMatch(request, slug);
    const state = await request.post('/api/test/match-state', {
      headers: getAuthHeader(),
      data: { slug, status: 'live', serverId: cs2Id },
    });
    expect(state.ok(), await state.text()).toBe(true);
    const res = reset(request, fake.serverId);
    const cmd = await fake.next('cmd');
    fake.answer(cmd, 'ok', { result: { ended: 'assignment', match_id: slug } });
    expect(await (await res).json()).toEqual({
      ok: true,
      ended: 'assignment',
      settledMatchSlug: slug,
    });
    await expect.poll(async () => (await matchRow(request, slug))?.status).not.toBe('live');
  });

  test('reset of a server running its own match ends it as local', async ({ request }) => {
    const fake = await online(request, { reason: 'local_match', detail: 'cup-final' });
    const res = reset(request, fake.serverId);
    const cmd = await fake.next('cmd');
    fake.answer(cmd, 'ok', { result: { ended: 'local', match_id: 'cup-final' } });
    expect(await (await res).json()).toEqual({ ok: true, ended: 'local', settledMatchSlug: null });
  });

  test('an older Ready Up that does not know reset is 409 unsupported and nothing is settled', async ({
    request,
  }) => {
    const fake = await online(request);
    const cs2Id = await link(request, fake.serverId);
    const slug = `reset-old-${Date.now()}`;
    await createMatch(request, slug);
    await request.post('/api/test/match-state', {
      headers: getAuthHeader(),
      data: { slug, status: 'live', serverId: cs2Id },
    });
    const res = reset(request, fake.serverId);
    const cmd = await fake.next('cmd');
    fake.answer(cmd, 'rejected', {
      error: { code: 'unknown_command', message: 'unknown cmd "reset"' },
    });
    const r = await res;
    expect(r.status()).toBe(409);
    expect((await r.json()).errorCode).toBe('unsupported');
    expect((await matchRow(request, slug))?.status).toBe('live');
  });

  test('a second reset while one is in flight is 409 busy', async ({ request }) => {
    const fake = await online(request, { availability: 'available' });
    const first = reset(request, fake.serverId);
    const cmd = await fake.next('cmd');
    const second = await reset(request, fake.serverId);
    expect(second.status()).toBe(409);
    expect((await second.json()).errorCode).toBe('busy');
    fake.answer(cmd, 'ok', { result: { ended: 'none', match_id: null } });
    expect((await first).ok()).toBe(true);
  });

  test('the allocator leaves a server alone while it is being reset', async ({ request }) => {
    test.setTimeout(90_000);
    // No spare held back: this server is the one the allocator would pick.
    await request.put('/api/fleet/failover/settings', {
      headers: getAuthHeader(),
      data: { reserve: 0 },
    });
    const fake = await online(request, { availability: 'available' });
    await link(request, fake.serverId);
    const res = reset(request, fake.serverId);
    const cmd = await fake.next('cmd');
    const slug = `reset-alloc-${Date.now()}`;
    await createMatch(request, slug);
    // Not while the reset runs...
    expect(await fake.next('match.assign', 3_000).catch(() => null)).toBeNull();
    fake.answer(cmd, 'ok', { result: { ended: 'none', match_id: null } });
    expect((await res).ok()).toBe(true);
    // ...and it takes matches again once it is reset and available.
    fake.availability('available', 'idle');
    const assign = await fake.next('match.assign', 30_000);
    expect((assign.payload as { match_id: string }).match_id).toBe(slug);
    fake.answer(assign, 'ok');
    await request.post(`/api/matches/${slug}/force-cancel`, { headers: getAuthHeader() });
    await request.put('/api/fleet/failover/settings', {
      headers: getAuthHeader(),
      data: { reserve: null },
    });
  });
});
