import { test, expect } from '@playwright/test';
import { spawn } from 'child_process';
import path from 'path';
import { getSessionSecret, sessionSecretProblem } from '../../api/src/utils/sessionSecret';
import { encryptSecret } from '../../api/src/utils/secretBox';
import { previousSecretsKey } from '../../api/src/utils/secretsKeyHint';

/**
 * SESSION_SECRET signs the session and every signed cookie. In production the
 * API refuses to start without a real one; elsewhere a fixed fallback keeps
 * development working.
 *
 * @tag api
 * @tag auth
 * @tag security
 */

const TAGS = { tag: ['@api', '@auth', '@security'] };
const GOOD = 'a'.repeat(32);

test.describe('session secret (pure)', () => {
  test('production needs a real secret', TAGS, () => {
    const prod = (SESSION_SECRET?: string) => ({ NODE_ENV: 'production', SESSION_SECRET });
    expect(sessionSecretProblem(prod())).toMatch(/not set/);
    expect(sessionSecretProblem(prod('   '))).toMatch(/not set/);
    expect(sessionSecretProblem(prod('change-this-session-secret'))).toMatch(/placeholder/);
    expect(sessionSecretProblem(prod('auto-tournament-dev-session-secret'))).toMatch(/placeholder/);
    expect(sessionSecretProblem(prod('a'.repeat(31)))).toMatch(/32/);
    expect(sessionSecretProblem(prod(GOOD))).toBeNull();
  });

  test('development keeps the fallback', TAGS, () => {
    expect(sessionSecretProblem({ NODE_ENV: 'development' })).toBeNull();
    expect(sessionSecretProblem({})).toBeNull();
    expect(getSessionSecret({})).toBe('auto-tournament-dev-session-secret');
    expect(getSessionSecret({ SESSION_SECRET: ` ${GOOD} ` })).toBe(GOOD);
  });
});

test.describe('secrets key hint after a SESSION_SECRET change (pure)', () => {
  const NEW = { NODE_ENV: 'production', SESSION_SECRET: GOOD };

  test('names the known default that still opens a stored secret', TAGS, () => {
    const fromDev = encryptSecret('totp', {});
    const fromExample = encryptSecret('smtp', { SESSION_SECRET: 'change-this-session-secret' });
    expect(previousSecretsKey([fromDev], NEW)).toBe('auto-tournament-dev-session-secret');
    expect(previousSecretsKey([null, fromExample], NEW)).toBe('change-this-session-secret');
  });

  test('says nothing when the current key opens them or no default does', TAGS, () => {
    expect(previousSecretsKey([], NEW)).toBeNull();
    expect(previousSecretsKey([encryptSecret('ok', NEW)], NEW)).toBeNull();
    expect(
      previousSecretsKey([encryptSecret('x', { SESSION_SECRET: 'b'.repeat(40) })], NEW)
    ).toBeNull();
    const dev = encryptSecret('dev', {});
    expect(
      previousSecretsKey([dev], { SECRETS_KEY: 'auto-tournament-dev-session-secret' })
    ).toBeNull();
  });
});

test('the API exits at boot in production with the placeholder secret', TAGS, async () => {
  test.setTimeout(60_000);
  const apiDir = path.join(__dirname, '../../api');
  const tsx = path.join(__dirname, '../../node_modules/.bin/tsx');
  const child = spawn(tsx, ['src/index.ts'], {
    cwd: apiDir,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      SESSION_SECRET: 'change-this-session-secret',
      PORT: process.env.API_PORT ?? '3372',
      // Never reached; a database that does not exist keeps a missed check harmless.
      DB_NAME: 'auto_tournament_session_secret_never',
      DATABASE_URL: '',
    },
  });
  let output = '';
  child.stdout.on('data', (d) => (output += String(d)));
  child.stderr.on('data', (d) => (output += String(d)));
  const code = await new Promise<number | null>((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve(null);
    }, 45_000);
    child.on('exit', (c) => {
      clearTimeout(timer);
      resolve(c);
    });
  });
  expect(code).toBe(1);
  expect(output).toContain('SESSION_SECRET');
  expect(output).toMatch(/refusing to start/i);
  expect(output).toContain('SECRETS_KEY');
});
