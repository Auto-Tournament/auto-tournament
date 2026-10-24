import { test, expect, type APIRequestContext } from '@playwright/test';
import { getAuthHeader, signInViaRequest } from '../helpers/auth';
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
 * A machine removed and linked again (same machine, new host record) gets its
 * servers back: a key minted for the new link enrolls an install that a key of
 * the removed link enrolled before (fleet/registry.ts, `host_machine_id`, `host_csm_user`). Another
 * machine's key still gets 409 `install_conflict`.
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

async function link(request: APIRequestContext, name: string, machineId: string, csmUser?: string) {
  const pending = await createPendingHost(request, `${name}-${Date.now()}`);
  const linked = await enrollHost(
    request,
    { code: pending.code, ...(csmUser ? { csm_user: csmUser } : {}) },
    machineId
  );
  expect(linked.status, JSON.stringify(linked.body)).toBe(201);
  const csm = await FakeCsm.connect(linked.body.token, linked.body.host_id, machineId);
  await csm.handshake({ capabilities: CAPABILITIES });
  return { csm, hostId: linked.body.host_id as string };
}

/** The machine lists a server whose Ready Up it cannot place (no install_id): it gets server.enroll. */
async function strayKey(csm: FakeCsm, hostId: string): Promise<string> {
  csm.sendEphemeral(
    'host.inventory',
    inventory(hostId, [
      inventoryServer('server-1', {
        readyup: { installed: '0.5.0', health: 'ok', update_safe: true },
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

test.describe.serial('Fleet: a machine removed and linked again', () => {
  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    await resetEnrollRateLimit(request);
  });

  test('its servers enroll again with the new link; another machine still gets 409', async ({
    request,
  }) => {
    test.setTimeout(60_000);
    const machineId = newMachineId();
    const first = await link(request, 'relink-a', machineId);
    const other = await link(request, 'relink-b', newMachineId());
    try {
      const installId = newInstallId();
      const enrolled = await enroll(
        request,
        { key: await strayKey(first.csm, first.hostId) },
        installId
      );
      expect(enrolled.status, JSON.stringify(enrolled.body)).toBe(201);

      // Remove the machine, link it again: a new host record for the same machine.
      first.csm.close();
      const removed = await request.delete(`/api/fleet/hosts/${first.hostId}`, {
        headers: getAuthHeader(),
      });
      expect(removed.ok(), await removed.text()).toBe(true);
      const second = await link(request, 'relink-a2', machineId);
      try {
        expect(second.hostId).not.toBe(first.hostId);
        const again = await enroll(
          request,
          { key: await strayKey(second.csm, second.hostId) },
          installId
        );
        expect(again.status, JSON.stringify(again.body)).toBe(201);
        expect(again.body.server_id).toBe(enrolled.body.server_id);
        expect(again.body.reenrolled).toBe(true);

        // A different machine's key for the same install stays refused.
        const refused = await enroll(
          request,
          { key: await strayKey(other.csm, other.hostId) },
          installId
        );
        expect(refused.status, JSON.stringify(refused.body)).toBe(409);
        expect(refused.body.code).toBe('install_conflict');
      } finally {
        second.csm.close();
      }
    } finally {
      first.csm.close();
      other.csm.close();
    }
  });

  test("another csm user's key on the same machine does not take the record", async ({
    request,
  }) => {
    test.setTimeout(60_000);
    const machineId = newMachineId();
    const one = await link(request, 'sibling-1', machineId, 'csm-one');
    const two = await link(request, 'sibling-2', machineId, 'csm-two');
    try {
      expect(two.hostId).not.toBe(one.hostId);
      const installId = newInstallId();
      const enrolled = await enroll(
        request,
        { key: await strayKey(one.csm, one.hostId) },
        installId
      );
      expect(enrolled.status, JSON.stringify(enrolled.body)).toBe(201);
      const refused = await enroll(
        request,
        { key: await strayKey(two.csm, two.hostId) },
        installId
      );
      expect(refused.status, JSON.stringify(refused.body)).toBe(409);
      expect(refused.body.code).toBe('install_conflict');
    } finally {
      one.csm.close();
      two.csm.close();
    }
  });
});
