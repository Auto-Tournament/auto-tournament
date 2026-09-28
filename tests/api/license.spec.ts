import { createHash, generateKeyPairSync, sign, type KeyObject } from 'crypto';
import { test, expect } from '@playwright/test';
import { verifyLicense, LIFETIME, type LicensePayload } from '../../api/src/services/license/verify';
import { LICENSE_PUBLIC_KEYS, type LicensePublicKey } from '../../api/src/services/license/publicKeys';
import { lineDateFor, buildLineDate } from '../../api/src/services/license/lineDate';
import { statusFor, keyInputProblem, verifyUrlFor } from '../../api/src/services/license/licenseService';

/**
 * License keys (api/src/services/license): the offline check ported from the
 * website's reference verifier, the build's line date, and the status the
 * admin UI shows. Pure, no API. Keys are signed with a throwaway key pair
 * made here; the real private key is never needed.
 *
 * Nothing ever blocks: every problem is `invalid` or a warning, never a throw.
 *
 * @tag api
 */

interface TestKey {
  kid: string;
  privateKey: KeyObject;
  publicJwk: LicensePublicKey;
}

/** Same kid rule as the website: first 16 base64url chars of SHA-256(raw public key). */
function makeKey(): TestKey {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const x = publicKey.export({ format: 'jwk' }).x as string;
  const kid = createHash('sha256').update(Buffer.from(x, 'base64url')).digest('base64url').slice(0, 16);
  return { kid, privateKey, publicJwk: { kty: 'OKP', crv: 'Ed25519', x } };
}

function signToken(payload: object, key: TestKey): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const input = `ATL1.${body}`;
  return `${input}.${sign(null, Buffer.from(input, 'ascii'), key.privateKey).toString('base64url')}`;
}

const key = makeKey();
const publicKeys = { [key.kid]: key.publicJwk };

function payload(overrides: Partial<LicensePayload> = {}): LicensePayload {
  return {
    v: 1,
    kid: key.kid,
    id: 'lic_0123456789',
    customer: 'cus_test',
    licensee: 'NTLAN',
    product: 'platform',
    pack: 'S',
    max_servers: 6,
    kind: 'year',
    issued_at: '2026-09-01T12:00:00Z',
    updates_until: '2027-09-01',
    ...overrides,
  };
}

const codes = (r: { warnings: { code: string }[] }) => r.warnings.map((w) => w.code);

test.describe('license keys: verify', () => {
  test('the embedded key table has the published key, and its kid matches it', () => {
    const jwk = LICENSE_PUBLIC_KEYS.tWl_YS3_AzLgqdkm;
    expect(jwk).toEqual({ kty: 'OKP', crv: 'Ed25519', x: 'YQMKIdrQtVz-QFV3Tw0AWa7RivnNtjK6PiJzskg8R0g' });
    for (const [kid, entry] of Object.entries(LICENSE_PUBLIC_KEYS)) {
      const derived = createHash('sha256').update(Buffer.from(entry.x, 'base64url')).digest('base64url').slice(0, 16);
      expect(derived, kid).toBe(kid);
      expect(Buffer.from(entry.x, 'base64url').length).toBe(32);
    }
  });

  test('a fresh platform key verifies with no warnings', () => {
    const r = verifyLicense(signToken(payload(), key), {
      publicKeys,
      product: 'platform',
      lineDate: '2027-03-01',
      now: '2027-03-01',
      serverCount: 6,
    });
    expect(r).toMatchObject({ valid: true, status: 'ok', warnings: [] });
    expect(r.license?.id).toBe('lic_0123456789');
  });

  test('surrounding whitespace is ignored', () => {
    const r = verifyLicense(`  ${signToken(payload(), key)}\n`, { publicKeys, lineDate: '2027-01-01' });
    expect(r.status).toBe('ok');
  });

  test('a tampered payload is invalid', () => {
    const [prefix, , sig] = signToken(payload(), key).split('.');
    const changed = Buffer.from(JSON.stringify(payload({ max_servers: 500 }))).toString('base64url');
    const r = verifyLicense(`${prefix}.${changed}.${sig}`, { publicKeys });
    expect(r).toMatchObject({ valid: false, status: 'invalid', license: null });
    expect(codes(r)).toEqual(['bad_signature']);
  });

  test('a flipped signature byte is invalid', () => {
    const token = signToken(payload(), key);
    const sig = Buffer.from(token.split('.')[2], 'base64url');
    sig[10] ^= 0x01;
    const r = verifyLicense(`${token.split('.').slice(0, 2).join('.')}.${sig.toString('base64url')}`, { publicKeys });
    expect(codes(r)).toEqual(['bad_signature']);
  });

  test('a key signed by an unknown kid is invalid, and so is one whose kid names another key', () => {
    const other = makeKey();
    expect(codes(verifyLicense(signToken(payload({ kid: other.kid }), other), { publicKeys }))).toEqual(['unknown_kid']);
    // The real table does not know the throwaway key.
    expect(codes(verifyLicense(signToken(payload(), key)))).toEqual(['unknown_kid']);
    // kid points at `key`, but `other` signed it.
    expect(codes(verifyLicense(signToken(payload(), other), { publicKeys }))).toEqual(['bad_signature']);
  });

  test('garbage and other versions are invalid, never thrown', () => {
    for (const bad of [
      '',
      'hello',
      'ATL1.',
      'ATL1.a.b',
      'ATL2.abc.def',
      `ATL1.${'A'.repeat(5000)}.x`,
      'ATL1.!!!.???',
      null,
      42,
      {},
    ]) {
      const r = verifyLicense(bad, { publicKeys });
      expect(r.status, String(bad)).toBe('invalid');
    }
    const v2 = Buffer.from(JSON.stringify({ ...payload(), v: 2 })).toString('base64url');
    expect(codes(verifyLicense(`ATL1.${v2}.${'A'.repeat(86)}`, { publicKeys }))).toEqual(['unsupported_version']);
  });

  test('a signed but incomplete payload is invalid', () => {
    const { customer: _customer, ...rest } = payload();
    void _customer;
    expect(codes(verifyLicense(signToken(rest, key), { publicKeys }))).toEqual(['malformed']);
    expect(codes(verifyLicense(signToken(payload({ valid_from: '2026-10-05' }), key), { publicKeys }))).toEqual([
      'malformed',
    ]);
  });

  test('a release line newer than updates_until only warns; later patches of a covered line do not', () => {
    const token = signToken(payload({ updates_until: '2027-09-01' }), key);
    const late = verifyLicense(token, { publicKeys, lineDate: '2027-11-15', now: '2028-01-01' });
    expect(late).toMatchObject({ valid: true, status: 'warning' });
    expect(codes(late)).toEqual(['updates_expired']);
    // Same day is covered; the line date, not today, decides.
    expect(verifyLicense(token, { publicKeys, lineDate: '2027-09-01', now: '2030-01-01' }).status).toBe('ok');
  });

  test('founder keys cover every release line', () => {
    const token = signToken(payload({ kind: 'founder', updates_until: LIFETIME }), key);
    expect(verifyLicense(token, { publicKeys, lineDate: '2040-01-01', now: '2041-01-01' }).status).toBe('ok');
  });

  test('the event window, too many servers and a Servers key on the platform only warn', () => {
    const event = signToken(
      payload({ kind: 'event', updates_until: '2026-10-07', valid_from: '2026-10-03', valid_to: '2026-10-07' }),
      key
    );
    expect(codes(verifyLicense(event, { publicKeys, lineDate: '2026-09-01', now: '2026-10-01' }))).toEqual([
      'period_not_started',
    ]);
    expect(verifyLicense(event, { publicKeys, lineDate: '2026-09-01', now: '2026-10-05' }).status).toBe('ok');
    expect(codes(verifyLicense(event, { publicKeys, lineDate: '2026-09-01', now: '2026-10-08' }))).toEqual([
      'period_ended',
    ]);

    const servers = signToken(payload({ product: 'servers' }), key);
    const r = verifyLicense(servers, { publicKeys, lineDate: '2026-09-01', serverCount: 7, product: 'platform' });
    expect(r.valid).toBe(true);
    expect(codes(r)).toEqual(['too_many_servers', 'wrong_product']);
    expect(r.warnings[1].message).toBe('This key covers CS2 Server Manager and Ready Up, not the platform.');
    // A Servers key checked by the Servers product is fine.
    expect(verifyLicense(servers, { publicKeys, lineDate: '2026-09-01', product: 'servers' }).status).toBe('ok');
  });
});

test.describe('license keys: line date', () => {
  test('x.y.0, its betas, dev and unparseable versions use the build date', () => {
    const dates = { buildDate: '2026-09-28', lineReleaseDate: '2026-01-10' };
    expect(lineDateFor('3.0.0', dates)).toBe('2026-09-28');
    expect(lineDateFor('3.0.0-beta.13', dates)).toBe('2026-09-28');
    expect(lineDateFor('dev', dates)).toBe('2026-09-28');
    expect(lineDateFor('', dates)).toBe('2026-09-28');
  });

  test('a patch uses its x.y.0 release date when known, never later than the build', () => {
    expect(lineDateFor('2.4.15', { buildDate: '2026-09-28', lineReleaseDate: '2026-05-02' })).toBe('2026-05-02');
    expect(lineDateFor('v3.1.2', { buildDate: '2026-09-28', lineReleaseDate: '2026-08-01' })).toBe('2026-08-01');
    expect(lineDateFor('3.0.1-beta.1', { buildDate: '2026-09-28', lineReleaseDate: '2026-09-20' })).toBe('2026-09-20');
    expect(lineDateFor('2.4.15', { buildDate: '2026-09-28' })).toBe('2026-09-28');
    expect(lineDateFor('2.4.15', { buildDate: '2026-09-28', lineReleaseDate: '' })).toBe('2026-09-28');
    expect(lineDateFor('2.4.15', { buildDate: '2026-09-28', lineReleaseDate: '2026-02-30' })).toBe('2026-09-28');
    expect(lineDateFor('2.4.15', { buildDate: '2026-09-28', lineReleaseDate: '2027-01-01' })).toBe('2026-09-28');
  });

  test('from source (nothing baked in) the line date is today', () => {
    expect(buildLineDate('2.4.15', new Date('2026-09-28T23:59:00Z'))).toBe('2026-09-28');
  });
});

test.describe('license keys: admin status', () => {
  const inputs = { serverCount: 6, lineDate: '2027-01-01', version: '3.0.0', publicBadge: false, publicKeys };

  test('no key: status none, with the pricing link and no verify link', () => {
    const s = statusFor(null, inputs);
    expect(s).toMatchObject({
      status: 'none',
      license: null,
      warnings: [],
      verifyUrl: null,
      pricingUrl: 'https://autotournament.gg/pricing',
    });
  });

  test('a valid key: the licensee, pack, servers and updates, and its verify page', () => {
    const s = statusFor(signToken(payload(), key), inputs);
    expect(s.status).toBe('ok');
    expect(s.license).toMatchObject({
      id: 'lic_0123456789',
      licensee: 'NTLAN',
      product: 'platform',
      pack: 'S',
      maxServers: 6,
      updatesUntil: '2027-09-01',
    });
    expect(s.verifyUrl).toBe('https://autotournament.gg/verify/lic_0123456789');
    expect(JSON.stringify(s)).not.toContain('ATL1.');
  });

  test('more servers than the pack and a founder key', () => {
    const s = statusFor(signToken(payload({ kind: 'founder', updates_until: LIFETIME }), key), {
      ...inputs,
      serverCount: 9,
    });
    expect(s.status).toBe('warning');
    expect(codes(s)).toEqual(['too_many_servers']);
    expect(s.license?.updatesUntil).toBeNull();
  });

  test('servers that could not be counted are not checked', () => {
    const s = statusFor(signToken(payload({ max_servers: 1 }), key), { ...inputs, serverCount: null });
    expect(s.status).toBe('ok');
  });

  test('a bad key is invalid, with no license details or verify link', () => {
    const s = statusFor('ATL1.eyJ2IjoxfQ.' + 'A'.repeat(86), inputs);
    expect(s).toMatchObject({ status: 'invalid', license: null, verifyUrl: null });
  });

  test('the pasted input: only non-keys are refused before saving', () => {
    expect(keyInputProblem('')).toBeTruthy();
    expect(keyInputProblem(undefined)).toBeTruthy();
    expect(keyInputProblem('not a key')).toMatch(/ATL1/);
    // A key that fails the signature is stored and shown as invalid.
    expect(keyInputProblem('ATL1.eyJ2IjoxfQ.' + 'A'.repeat(86))).toBeNull();
    expect(keyInputProblem(signToken(payload(), key))).toBeNull();
  });

  test('the verify link escapes the id', () => {
    expect(verifyUrlFor('a/b?c')).toBe('https://autotournament.gg/verify/a%2Fb%3Fc');
  });
});
