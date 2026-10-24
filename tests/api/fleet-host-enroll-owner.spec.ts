import { test, expect } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';
import { createFleetKey, resetEnrollRateLimit } from '../helpers/fleet';
import { createPendingHost, enrollHost, newMachineId } from '../helpers/fleetHost';

/**
 * Who may enroll a machine that already has an enrolled host record
 * (fleet/hosts/registry.ts): only the fleet key that enrolled it, and never
 * into a record of another csm user. Anything else gets 409 `host_conflict`;
 * a code enrolls only its own placeholder. After an admin removes the record,
 * any key or code enrolls the machine again. Several csm users on one machine
 * stay separate hosts.
 *
 * @tag api
 * @tag fleet
 */

test.describe.serial('Fleet host enrollment: the machine owner', () => {
  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    await resetEnrollRateLimit(request);
  });

  test('another key gets 409; the enrolling key gets the host back', async ({ request }) => {
    const owner = await createFleetKey(request, { name: 'host-owner' });
    const other = await createFleetKey(request, { name: 'host-other' });
    const machine = newMachineId();
    const first = await enrollHost(request, { key: owner.value }, machine);
    expect(first.status, JSON.stringify(first.body)).toBe(201);

    const taken = await enrollHost(request, { key: other.value }, machine);
    expect(taken.status, JSON.stringify(taken.body)).toBe(409);
    expect(taken.body.code).toBe('host_conflict');
    // Nor by naming a csm user: the machine's user-less host is not claimed.
    const claimed = await enrollHost(request, { key: other.value, csm_user: 'eve' }, machine);
    expect(claimed.status, JSON.stringify(claimed.body)).toBe(409);
    expect(claimed.body.code).toBe('host_conflict');

    const again = await enrollHost(request, { key: owner.value }, machine);
    expect(again.status).toBe(201);
    expect(again.body.host_id).toBe(first.body.host_id);
  });

  test("a csm user's host is not taken by another key or a user-less enroll", async ({
    request,
  }) => {
    const owner = await createFleetKey(request, { name: 'host-users' });
    const other = await createFleetKey(request, { name: 'host-users-other' });
    const machine = newMachineId();
    const alice = await enrollHost(request, { key: owner.value, csm_user: 'alice' }, machine);
    expect(alice.status).toBe(201);
    const stolen = await enrollHost(request, { key: other.value, csm_user: 'alice' }, machine);
    expect(stolen.status, JSON.stringify(stolen.body)).toBe(409);
    expect(stolen.body.code).toBe('host_conflict');
    const userless = await enrollHost(request, { key: owner.value }, machine);
    expect(userless.status, JSON.stringify(userless.body)).toBe(409);
    expect(userless.body.code).toBe('host_conflict');
    // Another user on the machine is its own host, whichever key.
    const bob = await enrollHost(request, { key: other.value, csm_user: 'bob' }, machine);
    expect(bob.status, JSON.stringify(bob.body)).toBe(201);
    expect(bob.body.host_id).not.toBe(alice.body.host_id);
  });

  test('a code enrolls its own placeholder only; after a removal it does', async ({ request }) => {
    const key = await createFleetKey(request, { name: 'host-code' });
    const machine = newMachineId();
    const byKey = await enrollHost(request, { key: key.value }, machine);
    expect(byKey.status).toBe(201);
    const pending = await createPendingHost(request, 'rack-taken');
    const byCode = await enrollHost(request, { code: pending.code }, machine);
    expect(byCode.status, JSON.stringify(byCode.body)).toBe(409);
    expect(byCode.body.code).toBe('host_conflict');
    const hosts = (await (await request.get('/api/fleet/hosts')).json()).hosts as Array<{
      id: string;
      status: string;
    }>;
    expect(hosts.find((h) => h.id === pending.hostId)?.status).toBe('pending');
    expect(hosts.find((h) => h.id === byKey.body.host_id)?.status).toBe('enrolled');

    expect((await request.delete(`/api/fleet/hosts/${byKey.body.host_id}`)).ok()).toBe(true);
    const fresh = await enrollHost(request, { code: pending.code }, machine);
    expect(fresh.status, JSON.stringify(fresh.body)).toBe(201);
    expect(fresh.body.host_id).toBe(pending.hostId);
  });
});
