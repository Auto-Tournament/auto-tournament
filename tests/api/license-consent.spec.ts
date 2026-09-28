import { test, expect, type APIRequestContext } from '@playwright/test';
import { signInViaRequest, DEFAULT_ADMIN_STEAM_ID } from '../helpers/auth';
import {
  consentStatusFor,
  currentTerms,
  envAcceptance,
  isConsentPhrase,
  parseConsentRecord,
  parseLicenseUse,
  LICENSE_TERMS_VERSION,
  type LicenseConsentRecord,
} from '../../api/src/services/license/consent';

/**
 * Accepting the license terms (/api/license/consent): before, after, the
 * AT_ACCEPT_LICENSE pre-accept, and re-accepting when the terms version goes
 * up. The E2E server pre-accepts (AT_ACCEPT_LICENSE=noncommercial), so the
 * tests switch that off with /api/test/license-consent and switch it back on
 * afterwards.
 *
 * @tag api
 */

const json = { 'Content-Type': 'application/json' };
const UNSIGNED_KEY = `ATL1.${Buffer.from(JSON.stringify({ v: 1, kid: 'tWl_YS3_AzLgqdkm', id: 'lic_e2e' })).toString('base64url')}.${'A'.repeat(86)}`;
const ADMIN_TOKEN = (process.env.API_TOKENS || 'ci-admin:ci-admin-token-0123456789abcdef')
  .split(/[\s,;]+/)[0]
  .split(':')
  .slice(1)
  .join(':');

interface ConsentBody {
  success: boolean;
  consent: {
    accepted: boolean;
    reason: 'none' | 'version' | null;
    consent: LicenseConsentRecord | null;
    terms: { version: number; phrase: string; url: string; name: string; hash: string | null };
    envAccept: string | null;
    history: LicenseConsentRecord[];
  };
  license?: { status: string };
}

async function testConsent(request: APIRequestContext, data: Record<string, unknown>) {
  const res = await request.post('/api/test/license-consent', { data, headers: json });
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()) as { envAccept: string | null };
}

async function status(request: APIRequestContext): Promise<ConsentBody['consent']> {
  const res = await request.get('/api/license/consent');
  expect(res.status()).toBe(200);
  return ((await res.json()) as ConsentBody).consent;
}

function accept(request: APIRequestContext, data: Record<string, unknown>, headers: Record<string, string> = {}) {
  return request.post('/api/license/consent', { data, headers: { ...json, ...headers } });
}

test.describe('License consent (pure)', () => {
  test('use, phrase and env parsing', () => {
    expect(parseLicenseUse('noncommercial')).toBe('noncommercial');
    expect(parseLicenseUse('Non-Commercial')).toBe('noncommercial');
    expect(parseLicenseUse('personal')).toBe('noncommercial');
    expect(parseLicenseUse('COMMERCIAL')).toBe('commercial');
    expect(parseLicenseUse('yes')).toBeNull();
    expect(parseLicenseUse(1)).toBeNull();

    expect(isConsentPhrase('I AGREE')).toBe(true);
    expect(isConsentPhrase('  i agree ')).toBe(true);
    expect(isConsentPhrase('I  Agree')).toBe(true);
    expect(isConsentPhrase('I AGREE!')).toBe(false);
    expect(isConsentPhrase('agree')).toBe(false);
    expect(isConsentPhrase(undefined)).toBe(false);

    expect(envAcceptance({})).toBeNull();
    expect(envAcceptance({ AT_ACCEPT_LICENSE: ' ' })).toBeNull();
    expect(envAcceptance({ AT_ACCEPT_LICENSE: 'commercial' })).toBe('commercial');
    expect(envAcceptance({ AT_ACCEPT_LICENSE: 'true' })).toBe('invalid');
  });

  test('an older terms version is not accepted; the current one is', () => {
    const terms = currentTerms();
    expect(terms.version).toBe(LICENSE_TERMS_VERSION);
    expect(consentStatusFor(null, terms, null)).toMatchObject({ accepted: false, reason: 'none' });
    const record: LicenseConsentRecord = {
      use: 'noncommercial',
      acceptedAt: '2026-01-01T00:00:00.000Z',
      acceptedBy: '76561198000000001',
      source: 'admin',
      termsVersion: terms.version,
      termsHash: null,
    };
    expect(consentStatusFor(record, terms, null)).toMatchObject({ accepted: true, reason: null });
    const bumped = { ...terms, version: terms.version + 1 };
    expect(consentStatusFor(record, bumped, null)).toMatchObject({ accepted: false, reason: 'version' });

    expect(parseConsentRecord(JSON.stringify(record))).toEqual(record);
    expect(parseConsentRecord('{"use":"maybe"}')).toBeNull();
    expect(parseConsentRecord('not json')).toBeNull();
  });
});

test.describe.serial('License consent API', () => {
  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
  });

  test.afterAll(async ({ request }) => {
    await signInViaRequest(request);
    await request.delete('/api/license');
    await testConsent(request, { action: 'restore' });
  });

  test('admin only', async ({ playwright, baseURL }) => {
    const stranger = await playwright.request.newContext({ baseURL });
    try {
      expect((await stranger.get('/api/license/consent')).status()).toBe(401);
      expect(
        (await stranger.post('/api/license/consent', { data: { use: 'noncommercial', confirm: 'I AGREE' }, headers: json })).status()
      ).toBe(401);
    } finally {
      await stranger.dispose();
    }
  });

  test('before: not accepted, with the terms to show', async ({ request }) => {
    await testConsent(request, { action: 'clear' });
    const before = await status(request);
    expect(before).toMatchObject({ accepted: false, reason: 'none', consent: null, envAccept: null });
    expect(before.terms).toMatchObject({
      version: LICENSE_TERMS_VERSION,
      phrase: 'I AGREE',
      url: 'https://polyformproject.org/licenses/noncommercial/1.0.0',
    });
  });

  test('refused: no use, no I AGREE, not a key, a changed terms version, cross-site, a form, an API token', async ({
    request,
  }) => {
    await testConsent(request, { action: 'clear' });
    expect((await accept(request, { confirm: 'I AGREE' })).status()).toBe(400);
    expect((await accept(request, { use: 'sometimes', confirm: 'I AGREE' })).status()).toBe(400);
    expect((await accept(request, { use: 'noncommercial' })).status()).toBe(400);
    expect((await accept(request, { use: 'noncommercial', confirm: 'I agree!' })).status()).toBe(400);
    expect((await accept(request, { use: 'commercial', confirm: 'I AGREE', key: 'hello' })).status()).toBe(400);
    expect(
      (await accept(request, { use: 'noncommercial', confirm: 'I AGREE', termsVersion: LICENSE_TERMS_VERSION + 1 })).status()
    ).toBe(409);
    expect(
      (await accept(request, { use: 'noncommercial', confirm: 'I AGREE' }, { Origin: 'https://evil.example' })).status()
    ).toBe(403);
    expect(
      (await request.post('/api/license/consent', { form: { use: 'noncommercial', confirm: 'I AGREE' } })).status()
    ).toBe(415);

    const token = await accept(
      request,
      { use: 'noncommercial', confirm: 'I AGREE' },
      { Authorization: `Bearer ${ADMIN_TOKEN}` }
    );
    // 403 when the token is configured (CI); 401 when this server has none.
    expect([401, 403]).toContain(token.status());

    // Nothing was recorded.
    expect(await status(request)).toMatchObject({ accepted: false, consent: null });
  });

  test('after: accepted, recorded with who, when and which terms', async ({ request }) => {
    await testConsent(request, { action: 'clear' });
    const res = await accept(request, { use: 'noncommercial', confirm: '  i agree ', termsVersion: LICENSE_TERMS_VERSION });
    expect(res.status(), await res.text()).toBe(200);
    const after = ((await res.json()) as ConsentBody).consent;
    expect(after).toMatchObject({ accepted: true, reason: null });
    expect(after.consent).toMatchObject({
      use: 'noncommercial',
      acceptedBy: DEFAULT_ADMIN_STEAM_ID,
      source: 'admin',
      termsVersion: LICENSE_TERMS_VERSION,
    });
    expect(Date.now() - Date.parse(after.consent!.acceptedAt)).toBeLessThan(60_000);
    expect(after.history[0]).toEqual(after.consent);

    // Read back the same.
    expect((await status(request)).consent).toEqual(after.consent);
  });

  test('change to commercial with a key: saved, history kept, key never echoed', async ({ request }) => {
    const before = (await status(request)).history.length;
    const res = await accept(request, { use: 'commercial', confirm: 'I AGREE', key: UNSIGNED_KEY });
    const text = await res.text();
    expect(res.status(), text).toBe(200);
    expect(text).not.toContain('ATL1.');
    const body = JSON.parse(text) as ConsentBody;
    expect(body.consent.consent?.use).toBe('commercial');
    expect(body.consent.history.length).toBe(Math.min(before + 1, 50));
    expect(body.consent.history[1]?.use).toBe('noncommercial');
    expect(body.license?.status).toBe('invalid');
    await request.delete('/api/license');
  });

  test('a new terms version asks again, and accepting clears it', async ({ request }) => {
    await testConsent(request, {
      action: 'set',
      record: {
        use: 'noncommercial',
        acceptedAt: '2026-01-01T00:00:00.000Z',
        acceptedBy: DEFAULT_ADMIN_STEAM_ID,
        source: 'admin',
        termsVersion: LICENSE_TERMS_VERSION - 1,
        termsHash: null,
      },
    });
    const due = await status(request);
    expect(due).toMatchObject({ accepted: false, reason: 'version' });
    expect(due.consent?.termsVersion).toBe(LICENSE_TERMS_VERSION - 1);

    const res = await accept(request, { use: 'noncommercial', confirm: 'I AGREE' });
    expect(res.status()).toBe(200);
    expect(await status(request)).toMatchObject({ accepted: true, reason: null });
  });

  test('AT_ACCEPT_LICENSE accepts up front, and again after a version bump', async ({ request }) => {
    const { envAccept } = await testConsent(request, { action: 'clear' });
    test.skip(!envAccept, 'this server runs without AT_ACCEPT_LICENSE');

    await testConsent(request, { action: 'env' });
    const pre = await status(request);
    expect(pre).toMatchObject({ accepted: true, reason: null, envAccept: parseLicenseUse(envAccept) });
    expect(pre.consent).toMatchObject({
      source: 'env',
      acceptedBy: 'env:AT_ACCEPT_LICENSE',
      termsVersion: LICENSE_TERMS_VERSION,
    });

    await testConsent(request, {
      action: 'set',
      record: { ...pre.consent, termsVersion: LICENSE_TERMS_VERSION - 1 },
    });
    expect((await status(request)).accepted).toBe(false);
    await testConsent(request, { action: 'env' });
    const again = await status(request);
    expect(again.accepted).toBe(true);
    expect(again.consent).toMatchObject({ source: 'env', termsVersion: LICENSE_TERMS_VERSION });
  });
});
