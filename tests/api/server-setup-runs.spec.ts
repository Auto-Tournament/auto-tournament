import { test, expect } from '@playwright/test';
import { getAuthHeader, signInViaRequest } from '../helpers/auth';
import {
  FleetTestClient,
  createFleetKey,
  enroll,
  envelope,
  newInstallId,
  resetEnrollRateLimit,
} from '../helpers/fleet';
import { ulid } from '../../api/src/integrations/cs2/fleet/credentials';
import type { Envelope } from '../../api/src/integrations/cs2/fleet/protocol/v1';

/**
 * Starting a saved setup on a server (serverSetupRuns.ts), with a fake Ready Up server on the
 * real gateway: start gives it the setup's plugins and map pool (loading the first map) and
 * takes it out of the match pool; stop gives it its plugins and map vote back, and it can take
 * a match again.
 *
 * @tag api
 * @tag fleet
 */

const isCmd = (name: string) => (m: Envelope) =>
  m.type === 'cmd' && (m.payload as { name: string }).name === name;

test(
  'a setup takes a free server out of the match pool until it is stopped',
  {
    tag: ['@api'],
  },
  async ({ request }) => {
    test.setTimeout(90_000);
    expect(await signInViaRequest(request)).toBe(true);
    await resetEnrollRateLimit(request);
    // No bracket matches waiting for a server: the allocator would hand ours one first.
    await request.delete('/api/tournament', { headers: getAuthHeader() });
    const key = await createFleetKey(request, { name: 'setup-runs-tests' });
    const installId = newInstallId();
    const enrolled = await enroll(request, { key: key.value }, installId);
    expect(enrolled.status, JSON.stringify(enrolled.body)).toBe(201);
    const fleetServerId = enrolled.body.server_id as string;
    const client = await FleetTestClient.connect(enrolled.body.token);
    let seq = 0;
    const send = (env: Omit<Envelope, 'seq'>) => client.send({ ...env, seq: ++seq } as Envelope);
    const answer = (msg: Envelope) =>
      send({
        v: 1,
        type: 'cmd.result',
        id: ulid(),
        ts: Date.now(),
        ack: msg.seq,
        ref: msg.id,
        payload: { status: 'ok' },
      });
    await client.handshake(fleetServerId, installId, {
      stream: { id: `setup-${fleetServerId}`, last_tx_seq: 0, last_rx_seq: 0 },
      capabilities: ['match.v1', 'fleet.cmds.v1'],
    });
    const keepalive = setInterval(() => client.send(envelope('ping', { t: Date.now() })), 5000);
    const linked = await request.post(`/api/fleet/servers/${fleetServerId}/link`, {
      headers: getAuthHeader(),
      data: {},
    });
    expect([200, 201], await linked.text()).toContain(linked.status());
    const cs2ServerId = (await linked.json()).cs2ServerId as string;
    send({
      v: 1,
      type: 'server.availability',
      id: ulid(),
      ts: Date.now(),
      payload: { availability: 'available', reason: 'test' },
    });
    const allocatable = async () => {
      const res = await request.get('/api/tournament/server-availability', {
        headers: getAuthHeader(),
      });
      const body = (await res.json()) as { servers?: Array<{ id: string; allocatable: boolean }> };
      return body.servers?.find((s) => s.id === cs2ServerId)?.allocatable ?? null;
    };
    await expect.poll(allocatable).toBe(true);

    const name = `Surf ${Date.now().toString(36)}`;
    const saved = await request.put('/api/game/cs2/setups', {
      data: { name, plugins: { preset: 'movement' }, maps: ['surf_utopia_v3', '3070212801'] },
    });
    expect(saved.ok(), await saved.text()).toBe(true);
    const setupId = ((await saved.json()) as { setup: { id: string } }).setup.id;
    try {
      const starting = request.post(`/api/game/cs2/setups/${setupId}/start`, {
        data: { serverId: cs2ServerId },
      });
      const plugins = await client.next(isCmd('plugins.set'), 15_000);
      expect((plugins.payload as { args: { enable: string[] } }).args.enable).toContain('movement');
      answer(plugins);
      const pool = await client.next(isCmd('mapvote.set'), 15_000);
      expect((pool.payload as { args: unknown }).args).toEqual({
        maps: ['surf_utopia_v3', 'workshop/3070212801'],
        load: true,
      });
      answer(pool);
      const started = await starting;
      expect(started.status(), await started.text()).toBe(200);
      expect(((await started.json()) as { serverId: string }).serverId).toBe(cs2ServerId);

      // No match goes to it now, and the setup runs once.
      await expect.poll(allocatable).toBe(false);
      const list = (await (await request.get('/api/game/cs2/setups')).json()) as {
        running: Array<{ setupId: string; serverId: string }>;
      };
      expect(list.running).toContainEqual(
        expect.objectContaining({ setupId, serverId: cs2ServerId })
      );
      expect(
        (await request.post(`/api/game/cs2/setups/${setupId}/start`, { data: {} })).status()
      ).toBe(409);

      // Stop: its plugins and map vote back, and it takes matches again.
      const stopping = request.post(`/api/game/cs2/setups/running/${cs2ServerId}/stop`);
      const back = await client.next((m) => isCmd('plugins.set')(m) && m.id !== plugins.id, 15_000);
      expect((back.payload as { args: { enable: string[] } }).args.enable).not.toContain(
        'movement'
      );
      answer(back);
      const cleared = await client.next((m) => isCmd('mapvote.set')(m) && m.id !== pool.id, 15_000);
      expect((cleared.payload as { args: unknown }).args).toEqual({ maps: [] });
      answer(cleared);
      expect((await stopping).ok()).toBe(true);
      await expect.poll(allocatable).toBe(true);
      expect(
        (await request.post(`/api/game/cs2/setups/running/${cs2ServerId}/stop`)).status()
      ).toBe(404);
    } finally {
      await request.delete(`/api/game/cs2/setups/${setupId}`);
      await request.delete(`/api/fleet/servers/${fleetServerId}/link`, {
        headers: getAuthHeader(),
      });
      clearInterval(keepalive);
      client.close();
    }
  }
);
