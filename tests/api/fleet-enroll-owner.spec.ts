import { test, expect } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';
import {
  createFleetKey,
  createPendingServer,
  enroll,
  newInstallId,
  resetEnrollRateLimit,
} from '../helpers/fleet';

/**
 * Who may enroll an install that already has an enrolled server record
 * (fleet/registry.ts): only the fleet key that enrolled it. Another key, or a
 * one-time code for another placeholder, gets 409 `install_conflict` and the
 * record keeps its tokens; after an admin deletes the record, any key or code
 * enrolls it as a new server.
 *
 * @tag api
 * @tag fleet
 */

test.describe.serial('Fleet enrollment: the install owner', () => {
  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    await resetEnrollRateLimit(request);
  });

  test('another key gets 409; the enrolling key gets the record back', async ({ request }) => {
    const owner = await createFleetKey(request, { name: 'owner' });
    const other = await createFleetKey(request, { name: 'other' });
    const installId = newInstallId();
    const first = await enroll(request, { key: owner.value }, installId);
    expect(first.status).toBe(201);

    const taken = await enroll(request, { key: other.value }, installId);
    expect(taken.status, JSON.stringify(taken.body)).toBe(409);
    expect(taken.body.code).toBe('install_conflict');

    const again = await enroll(request, { key: owner.value }, installId);
    expect(again.status).toBe(201);
    expect(again.body.server_id).toBe(first.body.server_id);
    expect(again.body.reenrolled).toBe(true);
  });

  test('a code for another placeholder gets 409 and the placeholder stays', async ({ request }) => {
    const key = await createFleetKey(request, { name: 'owner-code' });
    const installId = newInstallId();
    const byKey = await enroll(request, { key: key.value }, installId);
    expect(byKey.status).toBe(201);
    const { serverId: placeholder, code } = await createPendingServer(request, 'placeholder');
    const byCode = await enroll(request, { code }, installId);
    expect(byCode.status, JSON.stringify(byCode.body)).toBe(409);
    expect(byCode.body.code).toBe('install_conflict');
    const list = (await (await request.get('/api/fleet/servers')).json()).servers as Array<{
      id: string;
      status: string;
    }>;
    expect(list.find((s) => s.id === placeholder)?.status).toBe('pending');
    expect(list.find((s) => s.id === byKey.body.server_id)?.status).toBe('enrolled');

    // Deleted by an admin: the same code enrolls it into the placeholder.
    expect((await request.delete(`/api/fleet/servers/${byKey.body.server_id}`)).ok()).toBe(true);
    const fresh = await enroll(request, { code }, installId);
    expect(fresh.status, JSON.stringify(fresh.body)).toBe(201);
    expect(fresh.body.server_id).toBe(placeholder);
  });

  test('after an admin deletes the record another key enrolls it as a new server', async ({
    request,
  }) => {
    const owner = await createFleetKey(request, { name: 'owner-delete' });
    const other = await createFleetKey(request, { name: 'other-delete' });
    const installId = newInstallId();
    const first = await enroll(request, { key: owner.value }, installId);
    expect((await request.delete(`/api/fleet/servers/${first.body.server_id}`)).ok()).toBe(true);
    const fresh = await enroll(request, { key: other.value }, installId);
    expect(fresh.status, JSON.stringify(fresh.body)).toBe(201);
    expect(fresh.body.server_id).not.toBe(first.body.server_id);
  });
});
