import { test, expect, type APIRequestContext } from '@playwright/test';
import { getAuthHeader, signInViaRequest } from '../helpers/auth';
import {
  FleetTestClient,
  createFleetKey,
  enroll,
  envelope,
  newInstallId,
  resetEnrollRateLimit,
} from '../helpers/fleet';
import type { HelloPayload } from '../../api/src/integrations/cs2/fleet/protocol/v1';
import { CS2_MIGRATIONS } from '../../api/src/integrations/cs2/migrations';
import {
  effectiveBusyReason,
  parseBusyDetail,
  parseBusyReason,
} from '../../api/src/integrations/cs2/fleet/busyReason';

/**
 * Why a Ready Up server takes no match (FLEET.md §8): the reason it reports with
 * its availability is kept per server and shown on the servers list and in the
 * pool status. Older Ready Up sends free text, read as no reason.
 *
 * @tag api
 * @tag fleet
 */

test.describe('Fleet busy reason: parsing', () => {
  test('only the known reasons are kept; legacy text is null', () => {
    expect(parseBusyReason('awaiting_reset')).toBe('awaiting_reset');
    expect(parseBusyReason('local_match')).toBe('local_match');
    expect(parseBusyReason('series_end')).toBeNull();
    expect(parseBusyReason('assigned')).toBeNull();
    expect(parseBusyReason('reserved')).toBeNull(); // platform-only
    expect(parseBusyReason(undefined)).toBeNull();
    expect(parseBusyReason(3)).toBeNull();
    expect(parseBusyDetail('x'.repeat(300))).toHaveLength(128);
    expect(parseBusyDetail('  cup\u0007-final ')).toBe('cup-final');
    expect(parseBusyDetail('')).toBeNull();
    expect(parseBusyDetail(null)).toBeNull();
  });

  test('match off and a held spare win over the stored reason in that order', () => {
    expect(effectiveBusyReason('local_match', { matchDisabled: true, reserved: false })).toBe(
      'match_disabled'
    );
    expect(effectiveBusyReason('local_match', { matchDisabled: false, reserved: true })).toBe(
      'local_match'
    );
    expect(effectiveBusyReason(null, { matchDisabled: false, reserved: true })).toBe('reserved');
    expect(effectiveBusyReason(null, { matchDisabled: false, reserved: false })).toBeNull();
  });

  test('the availability reason migration is declared last', () => {
    expect(CS2_MIGRATIONS.at(-1)?.id).toBe('062-fleet-availability-reason');
  });
});

/** A fake Ready Up server: enrolled, helloed, says what it is busy with. */
class FakeReadyUp {
  private seq = 0;
  private keepalive: NodeJS.Timeout | null = null;

  private constructor(
    readonly serverId: string,
    readonly installId: string,
    private readonly client: FleetTestClient
  ) {}

  static async enroll(request: APIRequestContext, keyValue: string): Promise<FakeReadyUp> {
    const installId = newInstallId();
    const res = await enroll(request, { key: keyValue }, installId);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const client = await FleetTestClient.connect(res.body.token);
    return new FakeReadyUp(res.body.server_id, installId, client);
  }

  async hello(over: Partial<HelloPayload>): Promise<void> {
    await this.client.handshake(this.serverId, this.installId, {
      stream: { id: `stream-${this.serverId}`, last_tx_seq: 0, last_rx_seq: 0 },
      ...over,
    });
    this.keepalive = setInterval(() => this.client.send(envelope('ping', { t: Date.now() })), 5000);
  }

  availability(
    availability: 'available' | 'busy',
    reason: string,
    extra: { detail?: string } = {}
  ): void {
    this.client.send(
      envelope('server.availability', { availability, reason, ...extra }, { seq: ++this.seq })
    );
  }

  snapshot(over: Record<string, unknown>): void {
    this.client.send(
      envelope('state.snapshot', {
        reason: 'request',
        state: null,
        availability: 'available',
        config_rev: 0,
        admins_rev: 0,
        ...over,
      })
    );
  }

  close(): void {
    if (this.keepalive) clearInterval(this.keepalive);
    this.client.close();
  }
}

type Row = {
  id: string;
  availability: string | null;
  availabilityReason: string | null;
  availabilityDetail: string | null;
};

async function row(request: APIRequestContext, fleetServerId: string): Promise<Row | undefined> {
  const res = await request.get('/api/fleet/servers', { headers: getAuthHeader() });
  const body = (await res.json()) as { servers: Row[] };
  return body.servers.find((s) => s.id === fleetServerId);
}

test.describe.serial('Fleet busy reason: kept per server', () => {
  let key: { id: string; value: string };
  const fakes: FakeReadyUp[] = [];

  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    await resetEnrollRateLimit(request);
    if (!key) key = await createFleetKey(request, { name: 'fleet-busy-reason-tests' });
  });

  test.afterAll(() => {
    for (const f of fakes) f.close();
  });

  test('the busy reason follows hello, server.availability and snapshots', async ({ request }) => {
    const fake = await FakeReadyUp.enroll(request, key.value);
    fakes.push(fake);
    await fake.hello({ availability: 'busy', reason: 'local_match', detail: 'cup-final' });
    await expect
      .poll(() => row(request, fake.serverId))
      .toMatchObject({
        availability: 'busy',
        availabilityReason: 'local_match',
        availabilityDetail: 'cup-final',
      });
    fake.availability('busy', 'awaiting_reset', { detail: 'm1' });
    await expect
      .poll(() => row(request, fake.serverId))
      .toMatchObject({ availabilityReason: 'awaiting_reset', availabilityDetail: 'm1' });
    fake.availability('busy', 'assigned'); // older Ready Up: free text
    await expect
      .poll(() => row(request, fake.serverId))
      .toMatchObject({ availabilityReason: null });
    fake.snapshot({
      availability: 'busy',
      availability_reason: 'local_match',
      availability_detail: 'x',
    });
    await expect
      .poll(() => row(request, fake.serverId))
      .toMatchObject({ availabilityReason: 'local_match', availabilityDetail: 'x' });
    fake.availability('available', 'idle');
    await expect
      .poll(() => row(request, fake.serverId))
      .toMatchObject({
        availability: 'available',
        availabilityReason: null,
        availabilityDetail: null,
      });
  });
});
