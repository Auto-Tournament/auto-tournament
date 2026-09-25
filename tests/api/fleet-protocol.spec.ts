import fs from 'fs';
import path from 'path';
import { test, expect } from '@playwright/test';
import {
  FLEET_MESSAGE_SCHEMAS,
  validateEnrollRequest,
  validateEnrollResponse,
  validateEnvelope,
  validateMessage,
  validatePayload,
} from '../../api/src/integrations/cs2/fleet/protocol/v1';
import {
  enrollmentCodeHash,
  issueEnrollmentCode,
  issueFleetKey,
  issueServerToken,
  parseFleetKey,
  parseServerToken,
  redactFleetSecrets,
  ulid,
  verifySecret,
} from '../../api/src/integrations/cs2/fleet/credentials';
import { validateModuleMigrations } from '../../api/src/config/moduleMigrations';
import { CS2_MIGRATIONS } from '../../api/src/integrations/cs2/migrations';
import { envelope, helloPayload } from '../helpers/fleet';

/**
 * The fleet protocol v1 contract (FLEET.md §5, D18) and the credentials behind
 * it (§4.2), without a running API:
 *
 * - every schema file compiles, and is plain JSON Ready Up / csm can copy;
 * - the envelope and each step-1 message accept a well-formed example and
 *   reject the obvious mistakes;
 * - tokens / keys / codes have the documented format, round-trip through
 *   parse + hash, and fail on a wrong secret;
 * - the fleet migration stays inside CS2's table namespace.
 *
 * @tag api
 */

const PROTOCOL_DIR = path.resolve(__dirname, '../../api/src/integrations/cs2/fleet/protocol/v1');

test.describe('Fleet protocol schemas', () => {
  test('every schema file is JSON with a unique $id under the v1 base', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name.endsWith('.json')) files.push(full);
      }
    };
    walk(PROTOCOL_DIR);
    expect(files.length).toBeGreaterThanOrEqual(13);
    const ids = new Set<string>();
    for (const file of files) {
      const schema = JSON.parse(fs.readFileSync(file, 'utf8'));
      expect(schema.$schema, file).toBe('https://json-schema.org/draft/2020-12/schema');
      const rel = path.relative(PROTOCOL_DIR, file).split(path.sep).join('/');
      expect(schema.$id, file).toBe(`https://auto-tournament.dev/fleet/v1/${rel}`);
      expect(ids.has(schema.$id)).toBe(false);
      ids.add(schema.$id);
    }
    // Every message type has a schema file named after it.
    for (const type of Object.keys(FLEET_MESSAGE_SCHEMAS)) {
      expect(fs.existsSync(path.join(PROTOCOL_DIR, 'messages', `${type}.json`)), type).toBe(true);
    }
  });

  test('envelope: accepts the documented shape, rejects the rest', () => {
    const ok = envelope('ping', { t: 1 }, { seq: 3, ack: 2, ref: null, epoch: 1 });
    expect(validateEnvelope(ok)).toEqual({ ok: true, errors: [] });
    // Single-word types (hello, ping, …) are valid even though FLEET.md's
    // pattern draft required a dot.
    expect(validateEnvelope(envelope('hello', {})).ok).toBe(true);
    expect(validateEnvelope(envelope('event.round_end', {})).ok).toBe(true);

    expect(validateEnvelope({ ...ok, v: 2 }).ok).toBe(false);
    expect(validateEnvelope({ ...ok, id: 'not-a-ulid' }).ok).toBe(false);
    expect(validateEnvelope({ ...ok, type: 'Event.X' }).ok).toBe(false);
    expect(validateEnvelope({ ...ok, seq: 0 }).ok).toBe(false);
    expect(validateEnvelope({ ...ok, extra: true }).ok).toBe(false);
    const { payload: _payload, ...noPayload } = ok;
    expect(validateEnvelope(noPayload).ok).toBe(false);
  });

  test('hello: the example validates; missing or wrong fields do not', () => {
    const hello = helloPayload('fs_x', 'install-12345678');
    expect(validatePayload('hello', hello)).toEqual({ ok: true, errors: [] });
    expect(validateMessage(envelope('hello', hello)).ok).toBe(true);
    // Unknown fields are ignored (additive changes within a major, §14.1).
    expect(validatePayload('hello', { ...hello, future_field: 1 }).ok).toBe(true);
    // state and selftest may be left out.
    const { state: _s, selftest: _t, ...minimal } = hello;
    expect(validatePayload('hello', minimal).ok).toBe(true);

    expect(validatePayload('hello', { ...hello, tenant_id: 'other' }).ok).toBe(false);
    expect(validatePayload('hello', { ...hello, availability: 'idle' }).ok).toBe(false);
    expect(validatePayload('hello', { ...hello, host: { hostname: 'x', game_port: 70000 } }).ok).toBe(false);
    const { boot_id: _b, ...noBoot } = hello;
    const bad = validatePayload('hello', noBoot);
    expect(bad.ok).toBe(false);
    expect(bad.errors.join()).toContain('boot_id');
  });

  test('welcome, ping, pong, ack, error, auth.*, server.config', () => {
    expect(
      validatePayload('welcome', {
        session_id: ulid(),
        protocol: 1,
        heartbeat: { interval_ms: 10000, timeout_ms: 30000 },
        resume: { result: 'reset', platform_last_rx_seq: 0 },
        server_config_rev: 0,
        admins_rev: 0,
        assignment: null,
      }).ok
    ).toBe(true);
    expect(validatePayload('welcome', { session_id: ulid() }).ok).toBe(false);

    expect(validatePayload('ping', { t: Date.now(), health: { players: 10, tick_ms_p99: 1.2 } }).ok).toBe(true);
    expect(validatePayload('ping', {}).ok).toBe(false);
    expect(validatePayload('pong', { t: 1 }).ok).toBe(true);
    expect(validatePayload('ack', {}).ok).toBe(true);
    expect(validatePayload('error', { code: 'unknown_type', message: 'x' }).ok).toBe(true);
    expect(validatePayload('error', { code: 'Bad Code' }).ok).toBe(false);

    const token = issueServerToken().value;
    expect(validatePayload('auth.rotate', { token, old_valid_until: Date.now() }).ok).toBe(true);
    expect(validatePayload('auth.rotate', { token: 'rus_x', old_valid_until: 1 }).ok).toBe(false);
    expect(validatePayload('auth.rotated', {}).ok).toBe(true);

    expect(validatePayload('server.config', { rev: 0, settings: {} }).ok).toBe(true);
    expect(
      validatePayload('server.config', {
        rev: 3,
        settings: { chat_prefix: '[RU]', series_end_kick_delay: { no_demo: 5, demo_no_upload: 10, demo_upload: 60 } },
      }).ok
    ).toBe(true);
    expect(validatePayload('server.config', { settings: {} }).ok).toBe(false);
    expect(validatePayload('no.such_type', {}).ok).toBe(false);
  });

  test('enroll request / response', () => {
    const key = issueFleetKey().value;
    const base = { install_id: 'install-12345678', host: { hostname: 'h', game_port: 27015 } };
    expect(validateEnrollRequest({ ...base, key }).ok).toBe(true);
    expect(validateEnrollRequest({ ...base, code: 'RUE-AAAA-BBBB-CCCC-DDDD' }).ok).toBe(true);
    // Exactly one credential.
    expect(validateEnrollRequest(base).ok).toBe(false);
    expect(validateEnrollRequest({ ...base, key, code: 'RUE-AAAA' }).ok).toBe(false);
    expect(validateEnrollRequest({ ...base, key, install_id: 'short' }).ok).toBe(false);
    expect(validateEnrollRequest({ ...base, key: 'rfk_nope' }).ok).toBe(false);

    expect(
      validateEnrollResponse({
        success: true,
        server_id: 'fs_x',
        tenant_id: 'default',
        token: issueServerToken().value,
        ws_url: 'wss://example.com/api/fleet/ws',
        reenrolled: false,
      }).ok
    ).toBe(true);
  });
});

test.describe('Fleet credentials', () => {
  test('server tokens: format, parse, verify', () => {
    const issued = issueServerToken();
    expect(issued.value).toMatch(/^rus_[0-9a-hjkmnp-tv-z]{12}_[A-Za-z0-9_-]{43}$/);
    const parsed = parseServerToken(issued.value);
    expect(parsed?.id).toBe(issued.id);
    // Only the hash of the secret is stored, and it verifies.
    expect(issued.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(issued.value).not.toContain(issued.hash);
    expect(verifySecret(parsed!, issued.hash)).toBe(true);

    // A different secret under the same id does not.
    const other = issueServerToken(issued.id);
    expect(other.id).toBe(issued.id);
    expect(verifySecret(parseServerToken(other.value)!, issued.hash)).toBe(false);
    // A key is not a token and vice versa.
    expect(parseServerToken(issueFleetKey().value)).toBeNull();
    expect(parseFleetKey(issued.value)).toBeNull();
    expect(parseServerToken('rus_short_x')).toBeNull();
    expect(parseServerToken(42)).toBeNull();
    expect(verifySecret(parsed!, '')).toBe(false);
  });

  test('secrets that contain underscores still parse', () => {
    // base64url secrets use '_' and '-'; only the first two separators count.
    for (let i = 0; i < 200; i++) {
      const issued = issueServerToken();
      const parsed = parseServerToken(issued.value);
      expect(parsed && verifySecret(parsed, issued.hash)).toBe(true);
    }
  });

  test('enrollment codes: format and forgiving input', () => {
    const { code, hash } = issueEnrollmentCode();
    expect(code).toMatch(/^RUE-[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
    expect(enrollmentCodeHash(code)).toBe(hash);
    expect(enrollmentCodeHash(code.toLowerCase())).toBe(hash);
    expect(enrollmentCodeHash(code.replace(/-/g, ' '))).toBe(hash);
    expect(enrollmentCodeHash(code.slice(4))).toBe(hash);
    expect(enrollmentCodeHash('RUE-AAAA')).toBeNull();
    expect(enrollmentCodeHash('RUE-UUUU-UUUU-UUUU-UUUU')).toBeNull();
  });

  test('ulid and redaction', () => {
    const id = ulid(1790340012345);
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(id.slice(0, 10)).toBe(ulid(1790340012345).slice(0, 10));
    const token = issueServerToken().value;
    const key = issueFleetKey().value;
    const { code } = issueEnrollmentCode();
    const text = redactFleetSecrets(`token=${token} key=${key} code=${code}`);
    expect(text).not.toContain(token);
    expect(text).not.toContain(key);
    expect(text).not.toContain(code);
    expect(text).toContain('rus_[redacted]');
  });

  test('the fleet migration stays in the cs2_ namespace', () => {
    expect(validateModuleMigrations('cs2', CS2_MIGRATIONS, { installedModuleIds: ['cs2'] })).toBeNull();
    const fleet = CS2_MIGRATIONS.find((m) => m.id === '005-fleet');
    expect(fleet).toBeTruthy();
    expect(CS2_MIGRATIONS[CS2_MIGRATIONS.length - 1]).toBe(fleet);
    for (const table of ['servers', 'tokens', 'enrollment_codes', 'enrollment_keys', 'outbox']) {
      expect(fleet!.up).toContain(`CREATE TABLE IF NOT EXISTS cs2_fleet_${table}`);
    }
    expect(fleet!.up).toContain("tenant_id TEXT NOT NULL DEFAULT 'default'");
  });
});
