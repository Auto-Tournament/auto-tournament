import { test, expect } from '@playwright/test';
import { getAuthHeader, signInViaRequest } from '../helpers/auth';
import { FleetTestClient, enroll, newInstallId, resetEnrollRateLimit } from '../helpers/fleet';
import {
  FakeCsm,
  createPendingHost,
  enrollHost,
  inventory,
  inventoryServer,
  newMachineId,
} from '../helpers/fleetHost';

/**
 * A machine linked again (e.g. to a fresh install) keeps its servers: Ready
 * Up on them has credentials this platform does not know, so the platform
 * sends csm `server.enroll` with a new fleet key (csm writes it into each
 * server's fleet.cfg and restarts it), and the server that enrolls with it
 * joins the match pool on its first hello. Only csm with the
 * `servers.enroll` capability gets it.
 *
 * @tag api
 * @tag fleet
 */
test.describe('Fleet: a linked machine enrolls its servers', () => {
  test('stray servers get server.enroll; the enrolled server joins the pool', async ({
    request,
  }) => {
    test.setTimeout(60_000);
    expect(await signInViaRequest(request)).toBe(true);
    await resetEnrollRateLimit(request);
    const pending = await createPendingHost(request, `relink-${Date.now()}`);
    const machineId = newMachineId();
    const linked = await enrollHost(request, { code: pending.code }, machineId);
    expect(linked.status, JSON.stringify(linked.body)).toBe(201);
    const csm = await FakeCsm.connect(linked.body.token, linked.body.host_id, machineId);
    try {
      await csm.handshake({
        capabilities: [
          'host.v1',
          'servers.start_stop',
          'servers.create',
          'update.plugins',
          'servers.enroll',
        ],
      });
      // Two servers with Ready Up from the platform it was linked to before.
      csm.sendEphemeral(
        'host.inventory',
        inventory(linked.body.host_id, [
          inventoryServer('server-1', {
            readyup: {
              installed: '0.5.0',
              install_id: newInstallId(),
              health: 'ok',
              update_safe: true,
            },
          }),
          inventoryServer('server-2', {
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
      const payload = cmd.payload as { servers: string[]; enroll_key: string };
      expect(payload.servers).toEqual(['server-1', 'server-2']);
      expect(payload.enroll_key).toMatch(/^rfk_/);
      const result = csm.sendReliable(
        'host.result',
        { status: 'ok', output: 'enrolled' },
        { ref: cmd.id }
      );
      await csm.acked(result.seq as number);

      // Not sent again while that one is fresh.
      csm.sendEphemeral(
        'host.inventory',
        inventory(linked.body.host_id, [inventoryServer('server-1')])
      );
      await expect(csm.client.nextOfType('server.enroll', 1500)).rejects.toThrow();

      // server-1's Ready Up enrolls with the new key and says hello: a match server again.
      const installId = newInstallId();
      const ru = await enroll(request, { key: payload.enroll_key }, installId, {
        name: 'relinked-1',
      });
      expect(ru.status, JSON.stringify(ru.body)).toBe(201);
      const client = await FleetTestClient.connect(ru.body.token);
      try {
        await client.handshake(ru.body.server_id, installId, {
          stream: { id: `relink-${ru.body.server_id}`, last_tx_seq: 0, last_rx_seq: 0 },
        });
        await expect
          .poll(
            async () => {
              const res = await request.get(`/api/servers/${ru.body.server_id}`, {
                headers: getAuthHeader(),
              });
              if (!res.ok()) return null;
              const row = await res.json();
              return (row.server ?? row).transport ?? null;
            },
            { timeout: 15000 }
          )
          .toBe('fleet');
      } finally {
        client.close();
        await request.delete(`/api/fleet/servers/${ru.body.server_id}/link`, {
          headers: getAuthHeader(),
        });
      }
    } finally {
      csm.close();
    }
  });
});
