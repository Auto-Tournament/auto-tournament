import { test, expect, type APIRequestContext } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';
import { enroll, newInstallId, resetEnrollRateLimit } from '../helpers/fleet';
import {
  FakeCsm,
  createPendingHost,
  enrollHost,
  inventory,
  inventoryServer,
  newMachineId,
} from '../helpers/fleetHost';

/**
 * A key a machine got for its own servers (`server.enroll`, `server.create`)
 * enrolls an install that a key of the same machine enrolled before: the
 * record comes back. A key of another machine, or any other key, gets 409
 * `install_conflict` (fleet/registry.ts).
 *
 * @tag api
 * @tag fleet
 */

const CAPABILITIES = [
  'host.v1',
  'servers.start_stop',
  'servers.create',
  'update.plugins',
  'servers.enroll',
];

async function linkedCsm(request: APIRequestContext, name: string) {
  const pending = await createPendingHost(request, `${name}-${Date.now()}`);
  const machineId = newMachineId();
  const linked = await enrollHost(request, { code: pending.code }, machineId);
  expect(linked.status, JSON.stringify(linked.body)).toBe(201);
  const csm = await FakeCsm.connect(linked.body.token, linked.body.host_id, machineId);
  await csm.handshake({ capabilities: CAPABILITIES });
  return { csm, hostId: linked.body.host_id as string };
}

/** The machine reports a server with Ready Up that is not enrolled here: it gets server.enroll. */
async function strayKey(csm: FakeCsm, hostId: string, server: string): Promise<string> {
  csm.sendEphemeral(
    'host.inventory',
    inventory(hostId, [
      inventoryServer(server, {
        readyup: {
          installed: '0.5.0',
          install_id: newInstallId(),
          health: 'ok',
          update_safe: true,
        },
      }),
    ])
  );
  const cmd = await csm.nextCommand('server.enroll');
  const result = csm.sendReliable(
    'host.result',
    { status: 'ok', output: 'enrolled' },
    { ref: cmd.id }
  );
  await csm.acked(result.seq as number);
  return (cmd.payload as { enroll_key: string }).enroll_key;
}

test.describe.serial('Fleet: a machine re-enrolls its own servers', () => {
  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    await resetEnrollRateLimit(request);
  });

  test("the same machine's later key gets the record back; another machine's gets 409", async ({
    request,
  }) => {
    test.setTimeout(60_000);
    const a = await linkedCsm(request, 'reenroll-a');
    const b = await linkedCsm(request, 'reenroll-b');
    try {
      const installId = newInstallId();
      const first = await enroll(
        request,
        { key: await strayKey(a.csm, a.hostId, 'server-1') },
        installId
      );
      expect(first.status, JSON.stringify(first.body)).toBe(201);

      // Another machine's key for the same install: refused, the record keeps its owner.
      const other = await enroll(
        request,
        { key: await strayKey(b.csm, b.hostId, 'server-1') },
        installId
      );
      expect(other.status, JSON.stringify(other.body)).toBe(409);
      expect(other.body.code).toBe('install_conflict');

      // A create on machine A mints it a new key: that one enrolls the install again.
      const sent = await request.post(`/api/fleet/hosts/${a.hostId}/commands`, {
        data: { type: 'server.create', payload: { count: 1 } },
      });
      expect(sent.status(), await sent.text()).toBe(202);
      const create = await a.csm.nextCommand('server.create');
      const again = await enroll(
        request,
        { key: (create.payload as { enroll_key: string }).enroll_key },
        installId
      );
      expect(again.status, JSON.stringify(again.body)).toBe(201);
      expect(again.body.server_id).toBe(first.body.server_id);
      expect(again.body.reenrolled).toBe(true);
    } finally {
      a.csm.close();
      b.csm.close();
    }
  });
});
