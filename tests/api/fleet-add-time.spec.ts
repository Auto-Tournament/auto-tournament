import { test, expect } from '@playwright/test';
import { getAuthHeader, signInViaRequest } from '../helpers/auth';
import { createFleetKey, resetEnrollRateLimit } from '../helpers/fleet';
import { FakeReadyUp, acceptAssign, createMatch, link } from '../helpers/fleetFake';

/**
 * Add round time on a Ready Up server: the match page's `add_time` command is
 * `cmd add_time` on the assigned match, 1 to 600 seconds.
 *
 * @tag api
 * @tag fleet
 */
test.describe.serial('Fleet: add round time', () => {
  let key: { id: string; value: string };
  let fake: FakeReadyUp;
  let slug: string;
  let epoch: number;

  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    await resetEnrollRateLimit(request);
    if (!key) key = await createFleetKey(request, { name: 'fleet-add-time-tests' });
  });

  test.afterAll(() => fake?.close());

  const send = (request: Parameters<typeof signInViaRequest>[0], seconds: unknown) =>
    request.post(`/api/game/cs2/matches/${slug}/manage/command`, {
      headers: getAuthHeader(),
      data: { name: 'add_time', args: { seconds } },
    });

  test('add_time is cmd add_time on the assigned match', async ({ request }) => {
    fake = await FakeReadyUp.enroll(request, key.value);
    await fake.hello({ availability: 'available' });
    await link(request, fake.serverId);
    slug = `add-time-${Date.now()}`;
    await createMatch(request, slug);
    const assign = await acceptAssign(fake, slug);
    epoch = assign.epoch as number;
    fake.availability('busy', 'assigned');
    const sent = send(request, 30);
    const cmd = await fake.next('cmd');
    expect(cmd.payload).toMatchObject({
      name: 'add_time',
      args: { seconds: 30 },
      match_id: slug,
      epoch,
    });
    fake.answer(cmd, 'ok');
    expect(await (await sent).json()).toMatchObject({
      success: true,
      transport: 'fleet',
      status: 'ok',
    });
  });

  test('0, 601 and text seconds are refused', async ({ request }) => {
    for (const seconds of [0, 601, 'x']) {
      expect((await send(request, seconds)).status()).toBe(400);
    }
  });
});
