import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import path from 'path';
import {
  SESSION_COOKIE_MAX_AGE_MS,
  createInsecureSessionWarner,
  requestHost,
  useHostOnlySession,
} from '../../api/src/utils/sessionCookies';

/**
 * Which session cookie a request gets: a Domain cookie for FRONTEND_BASE_URL's
 * host, or a host-only cookie on any other host, so the browser does not drop it.
 *
 * @tag api
 * @tag auth
 * @tag security
 */

const TAGS = { tag: ['@api', '@auth', '@security'] };
const DOMAIN = 'tournament.example.com';
const raw = (host?: string) => ({ headers: host === undefined ? {} : { host } });
const express = (hostname: string) => ({ hostname, headers: { host: hostname } });

test.describe('session cookie selection (pure)', () => {
  test('the base host and its subdomains keep the Domain cookie', TAGS, () => {
    expect(useHostOnlySession(express(DOMAIN), DOMAIN)).toBe(false);
    expect(useHostOnlySession(express(`app.${DOMAIN}`), DOMAIN)).toBe(false);
  });

  test('another host, a lookalike and an IP get the host-only cookie', TAGS, () => {
    expect(useHostOnlySession(express('mybox.local'), DOMAIN)).toBe(true);
    expect(useHostOnlySession(express(`not${DOMAIN}`), DOMAIN)).toBe(true);
    expect(useHostOnlySession(express('10.0.0.5'), DOMAIN)).toBe(true);
    expect(useHostOnlySession(express('10.0.0.5'), undefined)).toBe(true);
  });

  test('without a cookie domain a DNS name keeps the one session', TAGS, () => {
    expect(useHostOnlySession(express('mybox.local'), undefined)).toBe(false);
  });

  test('a raw handshake request does not throw and reads the Host header', TAGS, () => {
    expect(() => useHostOnlySession(raw(`${DOMAIN}:3069`), DOMAIN)).not.toThrow();
    expect(useHostOnlySession(raw(`${DOMAIN}:3069`), DOMAIN)).toBe(false);
    expect(useHostOnlySession(raw('mybox.local:3069'), DOMAIN)).toBe(true);
    expect(() => useHostOnlySession(raw(), DOMAIN)).not.toThrow();
    expect(() => useHostOnlySession(raw(''), DOMAIN)).not.toThrow();
    expect(useHostOnlySession(raw(), DOMAIN)).toBe(false);
  });

  test('IPv6 hosts lose their brackets and port', TAGS, () => {
    expect(requestHost(raw('[::1]:3069'))).toBe('::1');
    expect(useHostOnlySession(raw('[::1]:3069'), DOMAIN)).toBe(true);
    expect(useHostOnlySession(express('[fd00::5]'), DOMAIN)).toBe(true);
  });

  test('the session cookie lasts as long as the player cookie', TAGS, () => {
    expect(SESSION_COOKIE_MAX_AGE_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });

  test('warns once when an https deployment sees plain http', TAGS, () => {
    const warnings: string[] = [];
    const warn = createInsecureSessionWarner((m) => warnings.push(m));
    warn({ headers: {}, secure: false }, true);
    warn({ headers: {}, secure: false }, true);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('TRUSTED_PROXIES');
  });

  test('no warning for forwarded https, secure requests or http deployments', TAGS, () => {
    const warnings: string[] = [];
    const warn = createInsecureSessionWarner((m) => warnings.push(m));
    warn({ headers: { 'x-forwarded-proto': 'https' }, secure: false }, true);
    warn({ headers: {}, secure: true }, true);
    warn({ headers: {}, secure: false }, false);
    expect(warnings).toEqual([]);
  });

  test(
    'each session middleware has a store of its own (express-session puts its cookie options on the store)',
    TAGS,
    () => {
      const src = readFileSync(path.join(__dirname, '../../api/src/index.ts'), 'utf8');
      const stores = [...src.matchAll(/session\(\{[^}]*?store:\s*([^,]+),/gs)].map((m) =>
        m[1].trim()
      );
      expect(stores).toHaveLength(2);
      expect(stores[0]).not.toBe(stores[1]);
      const blocks = [...src.matchAll(/=\s*session\(\{[\s\S]*?\n\}\);/g)].map((m) => m[0]);
      expect(blocks).toHaveLength(2);
      for (const block of blocks) expect(block).toMatch(/\bproxy: true,/);
    }
  );
});
