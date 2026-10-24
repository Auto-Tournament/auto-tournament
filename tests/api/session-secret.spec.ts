import { test, expect } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolveSessionSecret } from '../../api/src/config/sessionSecret';

/**
 * Sessions and signed cookies never use a secret anyone can read in the repo.
 *
 * @tag api
 * @tag auth
 */

const TAGS = { tag: ['@api', '@auth'] };

test.describe('Session secret', () => {
  test('uses SESSION_SECRET when it is our own', TAGS, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'at-secret-'));
    expect(resolveSessionSecret({ SESSION_SECRET: ' a-real-secret ' }, dir)).toBe('a-real-secret');
    expect(fs.existsSync(path.join(dir, 'session-secret'))).toBe(false);
  });

  for (const value of [undefined, '', 'change-this-session-secret', 'auto-tournament-dev-session-secret']) {
    test(`makes and keeps a random one for ${JSON.stringify(value)}`, TAGS, () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'at-secret-'));
      const first = resolveSessionSecret({ SESSION_SECRET: value }, dir);
      expect(first).not.toBe(value);
      expect(first.length).toBeGreaterThanOrEqual(40);
      expect(resolveSessionSecret({ SESSION_SECRET: value }, dir)).toBe(first);
    });
  }
});
