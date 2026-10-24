import { test, expect } from '@playwright/test';
import { getAuthHeader, signInViaRequest } from '../helpers/auth';
import { createFleetKey, resetEnrollRateLimit } from '../helpers/fleet';
import { FakeReadyUp } from '../helpers/fleetFake';

/**
 * Console lines on a Ready Up server (`cmd exec`, FLEET.md D10) are for root
 * admins: an admin-scope API token, the local admin, or a listed admin Steam ID.
 * `GET /api/fleet/root` tells the Servers page whether to show the console.
 *
 * @tag api
 * @tag fleet
 */
const ADMIN_TOKEN = (process.env.API_TOKENS || 'ci-admin:ci-admin-token-0123456789abcdef')
  .split(',')[0]
  .split(':')
  .slice(1)
  .join(':');
const ROOT = { Authorization: `Bearer ${ADMIN_TOKEN}` };

test.describe.serial('Fleet: root console', () => {
  let key: { id: string; value: string };
  let fake: FakeReadyUp;

  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    await resetEnrollRateLimit(request);
    if (!key) key = await createFleetKey(request, { name: 'fleet-root-console-tests' });
  });

  test.afterAll(() => fake?.close());

  test('an admin API token is root; a signed-in admin who is not listed is not', async ({
    request,
  }) => {
    expect((await (await request.get('/api/fleet/root', { headers: ROOT })).json()).root).toBe(
      true
    );
    expect(
      (await (await request.get('/api/fleet/root', { headers: getAuthHeader() })).json()).root
    ).toBe(false);
  });

  test('exec is audited and sent for root, refused for others, bad lines and offline servers', async ({
    request,
  }) => {
    fake = await FakeReadyUp.enroll(request, key.value);
    const exec = (headers: Record<string, string>, command: unknown, id = fake.serverId) =>
      request.post(`/api/fleet/servers/${id}/exec`, { headers, data: { command } });
    expect((await exec(ROOT, 'status')).status()).toBe(409);
    await fake.hello({ availability: 'available' });

    const denied = await exec(getAuthHeader(), 'status');
    expect(denied.status()).toBe(403);
    expect((await denied.json()).error).toContain('root');

    const sent = exec(ROOT, 'status');
    const cmd = await fake.next('cmd');
    const payload = cmd.payload as {
      name: string;
      args: { command: string };
      issued_by: { root: boolean };
      audit_id: string;
    };
    expect(payload).toMatchObject({
      name: 'exec',
      args: { command: 'status' },
      issued_by: { root: true },
    });
    expect(payload.audit_id).toMatch(/^[0-9A-Z]{26}$/);
    fake.answer(cmd, 'ok', { output: 'hostname: readyup', audit_id: payload.audit_id });
    expect(await (await sent).json()).toMatchObject({
      success: true,
      response: 'hostname: readyup',
      auditId: payload.audit_id,
    });

    expect((await exec(ROOT, '')).status()).toBe(400);
    expect((await exec(ROOT, 'a\nb')).status()).toBe(400);
    expect((await exec(ROOT, 'x'.repeat(513))).status()).toBe(400);
    expect((await exec(ROOT, 'status', 'no-such-server')).status()).toBe(404);
  });
});
