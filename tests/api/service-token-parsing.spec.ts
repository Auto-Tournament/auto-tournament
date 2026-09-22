import { test, expect } from '@playwright/test';
import {
  MIN_TOKEN_LENGTH,
  extractPresentedToken,
  findServiceToken,
  isReadOnlyMethod,
  parseServiceTokens,
} from '../../api/src/utils/serviceTokens';

/**
 * Parsing and matching API service tokens.
 *
 * The registry is built from environment variables at startup, so the parsing
 * is where this can quietly go wrong — and a mistake here is not cosmetic. A
 * short secret silently accepted is a guessable admin credential; a duplicate
 * silently taking the narrower scope is a bot that stops being able to write
 * for no visible reason.
 *
 * @tag api
 * @tag auth
 */

const SECRET_A = 'a'.repeat(32);
const SECRET_B = 'b'.repeat(32);

test.describe('API token parsing', () => {
  test('reads labelled and bare entries, across both scopes', () => {
    const { tokens, problems } = parseServiceTokens(`bot:${SECRET_A}`, SECRET_B);

    expect(problems).toEqual([]);
    expect(tokens).toHaveLength(2);

    expect(tokens[0].label).toBe('bot');
    expect(tokens[0].scope).toBe('admin');

    // No label given, so one is derived from the fingerprint — never from the
    // secret, which must not appear in logs.
    expect(tokens[1].scope).toBe('readonly');
    expect(tokens[1].label).toBe(`token-${tokens[1].fingerprint}`);
    expect(tokens[1].label).not.toContain(SECRET_B);
  });

  test('accepts commas, semicolons and whitespace as separators', () => {
    const { tokens } = parseServiceTokens(
      `one:${SECRET_A}, two:${SECRET_B};three:${'c'.repeat(32)} four:${'d'.repeat(32)}`,
      undefined
    );

    expect(tokens.map((t) => t.label)).toEqual(['one', 'two', 'three', 'four']);
  });

  test('refuses a secret shorter than the minimum, loudly', () => {
    const short = 'x'.repeat(MIN_TOKEN_LENGTH - 1);
    const { tokens, problems } = parseServiceTokens(`weak:${short}`, undefined);

    // Dropped rather than accepted: a guessable token is worse than no token.
    expect(tokens).toHaveLength(0);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('weak');
    expect(problems[0]).toContain('minimum');
    // The complaint must not leak the secret it is complaining about.
    expect(problems[0]).not.toContain(short);
  });

  test('a secret in both variables keeps admin scope rather than being downgraded', () => {
    const { tokens, problems } = parseServiceTokens(`bot:${SECRET_A}`, `bot-ro:${SECRET_A}`);

    expect(tokens).toHaveLength(1);
    expect(tokens[0].scope).toBe('admin');
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('duplicate');
  });

  test('treats unset and empty as "no tokens", not as an error', () => {
    expect(parseServiceTokens(undefined, undefined)).toEqual({ tokens: [], problems: [] });
    expect(parseServiceTokens('   ', '')).toEqual({ tokens: [], problems: [] });
  });

  test('a colon that is not a label separator stays part of the secret', () => {
    // Only a label-shaped prefix splits. `n0t/a/label` is not one, so the
    // entry is a bare secret — and it must authenticate as the whole string,
    // colon included, rather than as the tail after the colon.
    const entry = `n0t/a/label:${SECRET_A}`;
    const { tokens, problems } = parseServiceTokens(entry, undefined);

    expect(problems).toEqual([]);
    expect(tokens).toHaveLength(1);
    expect(tokens[0].label).toMatch(/^token-/);
    expect(findServiceToken(entry, tokens)).not.toBeNull();
    expect(findServiceToken(SECRET_A, tokens)).toBeNull();
  });
});

test.describe('API token matching', () => {
  test('matches the configured secret and nothing else', () => {
    const { tokens } = parseServiceTokens(`bot:${SECRET_A}`, undefined);

    expect(findServiceToken(SECRET_A, tokens)?.label).toBe('bot');
    expect(findServiceToken(SECRET_B, tokens)).toBeNull();
    expect(findServiceToken('', tokens)).toBeNull();
    // A prefix of the real secret must not match — the comparison is over
    // fixed-length digests, so length tells an attacker nothing either.
    expect(findServiceToken(SECRET_A.slice(0, 16), tokens)).toBeNull();
  });

  test('nothing matches when no tokens are configured', () => {
    expect(findServiceToken(SECRET_A, [])).toBeNull();
  });
});

test.describe('API token header extraction', () => {
  test('reads Authorization: Bearer, case-insensitively', () => {
    expect(extractPresentedToken({ authorization: `Bearer ${SECRET_A}` })).toBe(SECRET_A);
    expect(extractPresentedToken({ authorization: `bearer ${SECRET_A}` })).toBe(SECRET_A);
    expect(extractPresentedToken({ authorization: `  Bearer   ${SECRET_A}  ` })).toBe(SECRET_A);
  });

  test('reads X-API-Token', () => {
    expect(extractPresentedToken({ 'x-api-token': SECRET_A })).toBe(SECRET_A);
  });

  test('ignores headers that carry no token', () => {
    // An empty Authorization header is what the legacy test helper sends. It
    // has to read as "no token presented" so those requests still fall through
    // to session auth rather than being rejected outright.
    expect(extractPresentedToken({})).toBeNull();
    expect(extractPresentedToken({ authorization: '' })).toBeNull();
    expect(extractPresentedToken({ authorization: 'Bearer' })).toBeNull();
    expect(extractPresentedToken({ authorization: 'Bearer   ' })).toBeNull();
    // A different scheme is somebody else's credential, not ours.
    expect(extractPresentedToken({ authorization: `Basic ${SECRET_A}` })).toBeNull();
  });

  test('Authorization wins when both headers are present', () => {
    expect(
      extractPresentedToken({ authorization: `Bearer ${SECRET_A}`, 'x-api-token': SECRET_B })
    ).toBe(SECRET_A);
  });
});

test.describe('read-only scope', () => {
  test('allows only the methods that cannot change state', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS', 'get', 'head']) {
      expect(isReadOnlyMethod(method), `${method} should be read-only`).toBe(true);
    }
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'post']) {
      expect(isReadOnlyMethod(method), `${method} should not be read-only`).toBe(false);
    }
  });
});
