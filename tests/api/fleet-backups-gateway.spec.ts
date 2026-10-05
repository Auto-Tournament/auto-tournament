import fs from 'fs';
import path from 'path';
import { test, expect, type APIRequestContext } from '@playwright/test';
import { getAuthHeader, signInViaRequest } from '../helpers/auth';
import {
  FleetTestClient,
  createFleetKey,
  enroll,
  newInstallId,
  resetEnrollRateLimit,
  type Enrolled,
} from '../helpers/fleet';
import { ulid } from '../../api/src/integrations/cs2/fleet/credentials';
import { validateMessage, type Envelope, type InlineBackup } from '../../api/src/integrations/cs2/fleet/protocol/v1';

/**
 * Round backups end to end, with a fake Ready Up server on the fleet socket
 * (FLEET.md §12.3, §7.4): Ready Up's own `event.backup` frame is stored (once,
 * a replay changes nothing), listed for the admin, and "restore to round N"
 * sends `cmd restore_round` with that backup inline to the server of the
 * match's epoch; its `cmd.result` answers the admin's request and settles the
 * audit row.
 *
 * @tag api
 */

const EXAMPLES = path.resolve(__dirname, '../fixtures/fleet/v1');
const example = (file: string): Envelope =>
  JSON.parse(fs.readFileSync(path.join(EXAMPLES, file), 'utf8')) as Envelope;

let key: { id: string; value: string };

async function enrollNew(request: APIRequestContext): Promise<Enrolled & { installId: string }> {
  const installId = newInstallId();
  const res = await enroll(request, { key: key.value }, installId);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { ...res.body, installId };
}

async function assign(request: APIRequestContext, matchSlug: string, serverId: string): Promise<number> {
  const res = await request.post('/api/test/fleet/assign', {
    headers: getAuthHeader(),
    data: { matchSlug, serverId },
  });
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()).epoch as number;
}

function assignSnapshot(slug: string, epoch: number): Envelope {
  const frame = example('live.state.snapshot.json');
  const payload = JSON.parse(JSON.stringify(frame.payload)) as { state: Record<string, unknown> };
  payload.state.match_id = slug;
  payload.state.epoch = epoch;
  payload.state.live_rev = 0;
  const { seq: _seq, ack: _ack, ...rest } = frame;
  return { ...rest, id: ulid(), ts: Date.now(), epoch, payload };
}

/** Ready Up's live event.backup, for `slug` / `epoch` at `seq` / rev 1. */
function backupEvent(slug: string, epoch: number, seq: number): Envelope {
  const frame = example('live.event.backup.json');
  const payload = JSON.parse(JSON.stringify(frame.payload)) as Record<string, unknown> & {
    patch: Record<string, unknown>;
  };
  payload.match_id = slug;
  payload.rev = 1;
  payload.patch = { ...payload.patch, live_rev: 1 };
  const { ack: _ack, ...rest } = frame;
  const env = { ...rest, id: ulid(), ts: Date.now(), seq, epoch, payload };
  expect(validateMessage(env)).toEqual({ ok: true, errors: [] });
  return env;
}

/** A live event.* for `slug` / `epoch` at `seq` / `rev` (map 1). */
function liveEvent(
  slug: string,
  epoch: number,
  seq: number,
  rev: number,
  type: string,
  data: Record<string, unknown>,
  round: number
): Envelope {
  const env: Envelope = {
    v: 1,
    type,
    id: ulid(),
    ts: Date.now(),
    seq,
    epoch,
    payload: { match_id: slug, map_number: 1, round, rev, patch: { live_rev: rev }, data },
  } as Envelope;
  expect(validateMessage(env)).toEqual({ ok: true, errors: [] });
  return env;
}

async function liveScore(request: APIRequestContext, slug: string): Promise<string> {
  const res = await request.get(`/api/matches/${slug}`, { headers: getAuthHeader() });
  const m = (await res.json()).match as { team1Score?: number; team2Score?: number };
  return `${m.team1Score ?? '-'}-${m.team2Score ?? '-'}`;
}

async function acked(client: FleetTestClient, seq: number): Promise<void> {
  await client.next(
    (m) => ['ack', 'ping', 'pong'].includes(m.type) && typeof m.ack === 'number' && m.ack >= seq,
    5000
  );
}

async function listBackups(request: APIRequestContext, slug: string) {
  const res = await request.get(`/api/game/cs2/matches/${slug}/round-backups`, { headers: getAuthHeader() });
  expect(res.ok(), await res.text()).toBe(true);
  return res.json();
}

test.describe.serial('Fleet round backups: event.backup -> stored -> restore_round inline -> cmd.result', () => {
  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    await resetEnrollRateLimit(request);
    if (!key) key = await createFleetKey(request, { name: 'round-backup-tests' });
  });

  test('a backup is stored once, listed, and restored inline on the server of the epoch', async ({ request }) => {
    const server = await enrollNew(request);
    const slug = `fleet-bk-${Date.now()}`;
    // A match row, so its live score shows on the match API. A serverId keeps
    // the allocator off it (the route only auto-allocates without one).
    const created = await request.post('/api/matches', {
      headers: getAuthHeader(),
      data: {
        slug,
        serverId: server.server_id,
        config: { team1: { name: 'A', players: {} }, team2: { name: 'B', players: {} } },
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    const epoch = await assign(request, slug, server.server_id);

    const client = await FleetTestClient.connect(server.token);
    await client.handshake(server.server_id, server.installId, {
      stream: { id: 'backup-stream', last_tx_seq: 0, last_rx_seq: 0 },
    });
    client.send(assignSnapshot(slug, epoch));

    // Nothing stored yet; the match restores over the fleet link.
    await expect.poll(async () => (await listBackups(request, slug)).transport).toBe('fleet');

    const event = backupEvent(slug, epoch, 1);
    const sent = (event.payload as { data: InlineBackup }).data;
    client.send(event);
    await acked(client, 1);
    await expect.poll(async () => (await listBackups(request, slug)).backups.length).toBe(1);

    // A replay of the same seq after a lost ack (a new envelope id: the
    // gateway drops an id it has seen on this session): acked, not stored twice.
    client.send({ ...event, id: ulid(), ts: Date.now() });
    await acked(client, 1);
    const listed = await listBackups(request, slug);
    expect(listed).toMatchObject({ transport: 'fleet', serverId: server.server_id, epoch });
    expect(listed.backups).toHaveLength(1);
    expect(listed.backups[0]).toMatchObject({
      mapNumber: 1,
      round: 1,
      size: sent.size,
      sha256: sent.sha256,
      file: sent.file,
      score: sent.score,
      serverId: server.server_id,
      epoch,
      supersededAt: null,
    });
    expect(listed.backups[0].data).toBeUndefined();

    // No such round: nothing is sent.
    const missing = await request.post(`/api/game/cs2/matches/${slug}/round-backups/restore`, {
      headers: getAuthHeader(),
      data: { mapNumber: 1, round: 42 },
    });
    expect(missing.status()).toBe(404);
    expect((await missing.json()).code).toBe('no_backup');

    // Restore to round 1: the admin's request waits for the server's answer.
    const pending = request.post(`/api/game/cs2/matches/${slug}/round-backups/restore`, {
      headers: getAuthHeader(),
      data: { mapNumber: 1, round: 1 },
    });
    const cmd = await client.nextOfType('cmd', 10_000);
    expect(validateMessage(cmd)).toEqual({ ok: true, errors: [] });
    expect(cmd.epoch).toBe(epoch);
    const payload = cmd.payload as {
      match_id: string;
      name: string;
      args: { map_number: number; round: number; backup: InlineBackup };
      audit_id: string;
      expires_at: number;
    };
    expect(payload).toMatchObject({ match_id: slug, name: 'restore_round', epoch });
    expect(payload.expires_at).toBeGreaterThan(Date.now());
    expect(payload.args.map_number).toBe(1);
    expect(payload.args.round).toBe(1);
    // The stored file, inline and byte for byte, so another server could load it.
    expect(payload.args.backup).toEqual({
      map_number: sent.map_number,
      round: sent.round,
      file: sent.file,
      size: sent.size,
      sha256: sent.sha256,
      score: sent.score,
      encoding: 'base64',
      data: sent.data,
    });

    // Ready Up acks it and answers ok, echoing the audit id.
    client.send({
      v: 1,
      type: 'cmd.result',
      id: ulid(),
      ts: Date.now(),
      seq: 2,
      ack: cmd.seq,
      ref: cmd.id,
      epoch,
      payload: { status: 'ok', audit_id: payload.audit_id },
    });
    await acked(client, 2);

    const res = await pending;
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      success: true,
      delivered: true,
      restore: {
        id: payload.audit_id,
        transport: 'fleet',
        status: 'ok',
        mapNumber: 1,
        round: 1,
        serverId: server.server_id,
        epoch,
        inline: true,
        backupSha256: sent.sha256,
        commandId: cmd.id,
      },
    });

    const after = await listBackups(request, slug);
    expect(after.restores[0]).toMatchObject({ id: payload.audit_id, status: 'ok', commandId: cmd.id });

    // The match had gone on to 3-2; the restore takes the live score back to
    // the restored backup's (round 1, 0-0), not the abandoned 3-2.
    client.send(
      liveEvent(slug, epoch, 3, 2, 'event.round_start', { round: 6, score: { team1: 3, team2: 2 } }, 6)
    );
    await acked(client, 3);
    await expect.poll(() => liveScore(request, slug)).toBe('3-2');
    client.send(
      liveEvent(
        slug,
        epoch,
        4,
        3,
        'event.match_restored',
        { map_number: 1, round: 1, backup_sha256: sent.sha256, file: sent.file },
        1
      )
    );
    await acked(client, 4);
    await expect
      .poll(() => liveScore(request, slug))
      .toBe(`${sent.score.team1}-${sent.score.team2}`);
    client.close();
  });

  test('a match with no server has nothing to restore on; the routes are admin only', async ({
    request,
    playwright,
    baseURL,
  }) => {
    const slug = `fleet-bk-none-${Date.now()}`;
    const listed = await listBackups(request, slug);
    expect(listed).toMatchObject({ transport: null, backups: [], restores: [] });
    const res = await request.post(`/api/game/cs2/matches/${slug}/round-backups/restore`, {
      headers: getAuthHeader(),
      data: { mapNumber: 1, round: 3 },
    });
    expect(res.status()).toBe(409);
    expect((await res.json()).code).toBe('not_assigned');

    const anon = await playwright.request.newContext({ baseURL });
    expect((await anon.get(`/api/game/cs2/matches/${slug}/round-backups`)).status()).toBe(401);
    expect(
      (await anon.post(`/api/game/cs2/matches/${slug}/round-backups/restore`, { data: { round: 1 } })).status()
    ).toBe(401);
    // The public connect route under the same prefix stays public.
    expect((await anon.get(`/api/game/cs2/matches/${slug}/connect`)).status()).not.toBe(401);
    await anon.dispose();
  });
});
