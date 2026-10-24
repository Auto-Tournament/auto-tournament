import { test, expect, type APIRequestContext } from '@playwright/test';
import { execFileSync } from 'child_process';
import { getAuthHeader, signInViaRequest } from '../helpers/auth';
import { createFleetKey, resetEnrollRateLimit } from '../helpers/fleet';
import { FakeReadyUp, createMatch, link, unlink } from '../helpers/fleetFake';

/**
 * A Ready Up server reporting a platform assignment (reason assigned or
 * awaiting_reset) for a match the platform no longer runs gets match.unassign.
 *
 * @tag api
 * @tag fleet
 */

const DB = process.env.DB_NAME ?? 'auto_tournament';

const psql = (sql: string): void => {
  execFileSync(
    'podman',
    ['exec', 'auto-tournament-postgres', 'psql', '-U', 'postgres', '-d', DB, '-c', sql],
    { encoding: 'utf8' }
  );
};

const auditRows = (slug: string): string =>
  execFileSync(
    'podman',
    [
      'exec',
      'auto-tournament-postgres',
      'psql',
      '-U',
      'postgres',
      '-d',
      DB,
      '-At',
      '-c',
      `SELECT actor || '|' || command || '|' || status FROM cs2_fleet_audit WHERE match_slug = '${slug}'`,
    ],
    { encoding: 'utf8' }
  ).trim();

const setState = async (
  request: APIRequestContext,
  slug: string,
  status: string,
  serverId: string | null
) => {
  const res = await request.post('/api/test/match-state', {
    headers: getAuthHeader(),
    data: { slug, status, serverId },
  });
  expect(res.ok(), await res.text()).toBe(true);
};

test.describe.serial('Fleet orphan unassign', () => {
  let key: { id: string; value: string };
  const fakes: FakeReadyUp[] = [];

  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    await resetEnrollRateLimit(request);
    if (!key) key = await createFleetKey(request, { name: 'fleet-orphan-tests' });
  });

  test.afterAll(() => {
    for (const f of fakes) f.close();
  });

  const online = async (request: APIRequestContext) => {
    const fake = await FakeReadyUp.enroll(request, key.value);
    fakes.push(fake);
    await fake.hello({ availability: 'busy' });
    const cs2Id = await link(request, fake.serverId);
    return { fake, cs2Id };
  };

  const report = (fake: FakeReadyUp, slug: string, epoch = 1, reason = 'assigned') =>
    fake.snapshot(slug, epoch, {
      availability: 'busy',
      availability_reason: reason,
      availability_detail: slug,
    });

  test('unknown slug is unassigned', async ({ request }) => {
    const { fake } = await online(request);
    const slug = `ghost-${Date.now()}`;
    report(fake, slug);
    const msg = await fake.next('match.unassign');
    expect(msg.payload).toMatchObject({ match_id: slug, epoch: 1, reason: 'cancelled' });
    fake.answer(msg, 'ok');
    await expect.poll(() => auditRows(slug)).toBe(`system|match.unassign ${slug} (cancelled)|ok`);
  });

  test('completed match is unassigned as ended', async ({ request }) => {
    const { fake, cs2Id } = await online(request);
    const slug = `orphan-done-${Date.now()}`;
    await createMatch(request, slug);
    await setState(request, slug, 'completed', cs2Id);
    report(fake, slug, 2, 'awaiting_reset');
    const msg = await fake.next('match.unassign');
    expect(msg.payload).toMatchObject({ match_id: slug, epoch: 2, reason: 'ended' });
    fake.answer(msg, 'ok');
  });

  test('match on another server is superseded', async ({ request }) => {
    const { fake } = await online(request);
    const other = await online(request);
    const slug = `orphan-moved-${Date.now()}`;
    await createMatch(request, slug);
    await setState(request, slug, 'live', other.cs2Id);
    report(fake, slug);
    const msg = await fake.next('match.unassign');
    expect(msg.payload).toMatchObject({ match_id: slug, reason: 'superseded' });
    fake.answer(msg, 'ok');
  });

  test('live match on this server is kept', async ({ request }) => {
    const { fake, cs2Id } = await online(request);
    const slug = `orphan-live-${Date.now()}`;
    await createMatch(request, slug);
    await setState(request, slug, 'live', cs2Id);
    report(fake, slug);
    await expect(fake.next('match.unassign', 2000)).rejects.toThrow();
  });

  test('a match the platform still assigns here survives unlink and relink', async ({
    request,
  }) => {
    const { fake, cs2Id } = await online(request);
    const slug = `orphan-unlinked-${Date.now()}`;
    await createMatch(request, slug);
    await setState(request, slug, 'live', cs2Id);
    psql(
      `INSERT INTO cs2_fleet_assignments (match_slug, epoch, server_id, cs2_server_id, password, created_at, updated_at)
       VALUES ('${slug}', 1, '${fake.serverId}', '${cs2Id}', 'pw', 1, 1)
       ON CONFLICT (match_slug) DO UPDATE SET server_id = EXCLUDED.server_id, ended_at = NULL`
    );
    await unlink(request, fake.serverId);
    report(fake, slug);
    await expect(fake.next('match.unassign', 2000)).rejects.toThrow();
    await link(request, fake.serverId);
    report(fake, slug);
    await expect(fake.next('match.unassign', 2000)).rejects.toThrow();
  });

  test('local_match with unknown slug is kept', async ({ request }) => {
    const { fake } = await online(request);
    report(fake, `local-${Date.now()}`, 1, 'local_match');
    await expect(fake.next('match.unassign', 2000)).rejects.toThrow();
  });

  test('hello with an orphan assignment is unassigned', async ({ request }) => {
    const { fake } = await online(request);
    const slug = `ghost-hello-${Date.now()}`;
    await fake.reconnect({
      availability: 'busy',
      reason: 'assigned',
      detail: slug,
      state: {
        match_id: slug,
        epoch: 3,
        live_rev: 0,
      } as never,
    });
    const msg = await fake.next('match.unassign');
    expect(msg.payload).toMatchObject({ match_id: slug, epoch: 3, reason: 'cancelled' });
    fake.answer(msg, 'ok');
  });

  test('same orphan is unassigned once per connection', async ({ request }) => {
    const { fake } = await online(request);
    const slug = `ghost-once-${Date.now()}`;
    report(fake, slug);
    fake.answer(await fake.next('match.unassign'), 'ok');
    report(fake, slug);
    await expect(fake.next('match.unassign', 2000)).rejects.toThrow();
    await fake.reconnect({ availability: 'busy', reason: 'assigned', detail: slug, state: null });
    // no state and no assignment row: nothing to address
    await expect(fake.next('match.unassign', 2000)).rejects.toThrow();
  });
});
