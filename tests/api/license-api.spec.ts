import { test, expect, type APIRequestContext } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';

/**
 * /api/license: save, read and remove the license key, and the public badge.
 * Admin only (except the badge), same-site JSON writes. The key is never
 * returned. Only keys that fail the signature check are used here: the
 * signing logic is covered with a throwaway key pair in license.spec.ts, and
 * the API only trusts the real public key.
 *
 * @tag api
 */

const json = { 'Content-Type': 'application/json' };
/** Well-formed, but signed by no one: stored, and shown as invalid. */
const UNSIGNED_KEY = `ATL1.${Buffer.from(JSON.stringify({ v: 1, kid: 'tWl_YS3_AzLgqdkm', id: 'lic_e2e' })).toString('base64url')}.${'A'.repeat(86)}`;

interface StatusBody {
  success: boolean;
  license: {
    status: string;
    license: unknown;
    warnings: Array<{ code: string }>;
    verifyUrl: string | null;
    pricingUrl: string;
    lineDate: string;
    version: string;
    publicBadge: boolean;
    serverCount: number | null;
    checkin: { lastAt: string | null; notice: string | null; sent: string[]; privacyUrl: string } | null;
    eventPrompt: unknown;
  };
}

async function reset(request: APIRequestContext) {
  await request.delete('/api/license');
  await request.put('/api/license/public-badge', { data: { enabled: false }, headers: json });
}

test.describe('License API', () => {
  // Every test starts clean and leaves nothing stored.
  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    await reset(request);
  });

  test('strangers get no status, but the public badge answers (null)', async ({ playwright, baseURL }) => {
    const stranger = await playwright.request.newContext({ baseURL });
    try {
      expect((await stranger.get('/api/license')).status()).toBe(401);
      expect((await stranger.put('/api/license', { data: { key: UNSIGNED_KEY }, headers: json })).status()).toBe(401);
      expect((await stranger.delete('/api/license')).status()).toBe(401);
      const badge = await stranger.get('/api/license/badge');
      expect(badge.status()).toBe(200);
      expect(await badge.json()).toEqual({ success: true, badge: null });
    } finally {
      await stranger.dispose();
    }
  });

  test('no key: a quiet "none" with the pricing link', async ({ request }) => {
    const body = (await (await request.get('/api/license')).json()) as StatusBody;
    expect(body.success).toBe(true);
    expect(body.license).toMatchObject({
      status: 'none',
      license: null,
      warnings: [],
      verifyUrl: null,
      pricingUrl: 'https://autotournament.gg/pricing',
      publicBadge: false,
    });
    expect(body.license.lineDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.license.version).toBeTruthy();
  });

  test('a non-key is refused; an unsigned key is saved, shown invalid, never echoed', async ({ request }) => {
    const junk = await request.put('/api/license', { data: { key: 'hello' }, headers: json });
    expect(junk.status()).toBe(400);
    expect((await request.put('/api/license', { data: {}, headers: json })).status()).toBe(400);

    const saved = await request.put('/api/license', { data: { key: UNSIGNED_KEY }, headers: json });
    const text = await saved.text();
    expect(saved.status(), text).toBe(200);
    expect(text).not.toContain('ATL1.');
    const body = JSON.parse(text) as StatusBody;
    expect(body.license).toMatchObject({ status: 'invalid', license: null, verifyUrl: null });
    expect(body.license.warnings[0].code).toBe('bad_signature');

    // Still stored, and still not in any response.
    const again = await (await request.get('/api/license')).text();
    expect(JSON.parse(again).license.status).toBe('invalid');
    expect(again).not.toContain('ATL1.');
    expect(await (await request.get('/api/settings')).text()).not.toContain('ATL1.');

    const removed = (await (await request.delete('/api/license')).json()) as StatusBody;
    expect(removed.license.status).toBe('none');
  });

  test('the public badge is off by default and never shows without a genuine key', async ({ request }) => {
    expect((await request.put('/api/license/public-badge', { data: { enabled: 'yes' }, headers: json })).status()).toBe(
      400
    );
    const on = (await (
      await request.put('/api/license/public-badge', { data: { enabled: true }, headers: json })
    ).json()) as StatusBody;
    expect(on.license.publicBadge).toBe(true);
    expect((await (await request.get('/api/license/badge')).json()).badge).toBeNull();

    await request.put('/api/license', { data: { key: UNSIGNED_KEY }, headers: json });
    expect((await (await request.get('/api/license/badge')).json()).badge).toBeNull();
    await reset(request);
  });

  test('writes must be same-site JSON', async ({ request }) => {
    const crossSite = await request.put('/api/license', {
      data: { key: UNSIGNED_KEY },
      headers: { ...json, Origin: 'https://evil.example' },
    });
    expect(crossSite.status()).toBe(403);
    expect((await request.delete('/api/license', { headers: { Origin: 'https://evil.example' } })).status()).toBe(403);
    const form = await request.put('/api/license', { form: { key: UNSIGNED_KEY } });
    expect(form.status()).toBe(415);
  });

  test('check-in: nothing without a key; with one, what is sent (CI never sends it)', async ({ request }) => {
    const none = (await (await request.get('/api/license')).json()) as StatusBody;
    expect(none.license.checkin).toBeNull();
    expect(none.license.eventPrompt).toBeNull();

    await request.put('/api/license', { data: { key: UNSIGNED_KEY }, headers: json });
    const body = (await (await request.get('/api/license')).json()) as StatusBody;
    expect(body.license.checkin).toMatchObject({ lastAt: null, notice: null });
    expect(body.license.checkin?.sent).toEqual([
      'token',
      'key_id',
      'instance_id',
      'server_count',
      'platform_version',
      'sent_at',
      'matches_played',
      'tournaments_live',
      'max_tournament_teams',
      'declared',
    ]);
    // Not a genuine event license: no question.
    expect(body.license.eventPrompt).toBeNull();
  });

  test('the event-license question: only known answers, only for an event license, same-site JSON', async ({
    request,
  }) => {
    const bad = await request.post('/api/license/event-prompt', { data: { action: 'maybe' }, headers: json });
    expect(bad.status()).toBe(400);
    // No key (and then a key that is not a genuine event license): nothing to answer.
    const noKey = await request.post('/api/license/event-prompt', { data: { action: 'testing' }, headers: json });
    expect(noKey.status()).toBe(409);
    await request.put('/api/license', { data: { key: UNSIGNED_KEY }, headers: json });
    const notEvent = await request.post('/api/license/event-prompt', { data: { action: 'dont_ask' }, headers: json });
    expect(notEvent.status()).toBe(409);
    const crossSite = await request.post('/api/license/event-prompt', {
      data: { action: 'testing' },
      headers: { ...json, Origin: 'https://evil.example' },
    });
    expect(crossSite.status()).toBe(403);
  });
});
