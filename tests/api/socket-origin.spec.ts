import { test, expect } from '@playwright/test';
import { io } from 'socket.io-client';
import { signInViaRequest } from '../helpers/auth';
import { socketOriginAllowed } from '../../api/src/utils/socketOrigin';

/**
 * Socket.IO handshakes from a browser page on another origin are refused once
 * the site's address is configured (FRONTEND_BASE_URL, CORS_ORIGIN). The
 * page's own host, and clients that send no Origin (scripts, csm, tests),
 * are let through.
 *
 * @tag api
 * @tag auth
 * @tag security
 */

const TAGS = { tag: ['@api', '@auth', '@security'] };

test.describe('socket origin check (pure)', () => {
  const env = { FRONTEND_BASE_URL: 'https://play.example.com/' };
  const host = { host: 'play.example.com' };

  test('configured origins and the request host pass, others do not', TAGS, () => {
    expect(socketOriginAllowed(undefined, host, env)).toBe(true);
    expect(socketOriginAllowed('https://play.example.com', host, env)).toBe(true);
    expect(socketOriginAllowed('http://192.168.1.5:3069', { host: '192.168.1.5:3069' }, env)).toBe(
      true
    );
    expect(
      socketOriginAllowed(
        'https://lan.example',
        { host: 'internal:3000', 'x-forwarded-host': 'lan.example' },
        env
      )
    ).toBe(true);
    expect(socketOriginAllowed('https://evil.example.com', host, env)).toBe(false);
    expect(socketOriginAllowed('https://play.example.com:8443', host, env)).toBe(false);
    expect(socketOriginAllowed('null', host, env)).toBe(false);
    expect(
      socketOriginAllowed('https://other.example', host, {
        ...env,
        CORS_ORIGIN: 'https://a.example, https://other.example',
      })
    ).toBe(true);
  });

  test('nothing configured, or CORS_ORIGIN=*: any origin', TAGS, () => {
    expect(socketOriginAllowed('https://evil.example', { host: 'x' }, {})).toBe(true);
    expect(
      socketOriginAllowed('https://evil.example', { host: 'x' }, { ...{ CORS_ORIGIN: '*' } })
    ).toBe(true);
  });
});

test('a foreign Origin cannot open a socket', TAGS, async ({ request, baseURL }) => {
  expect(await signInViaRequest(request)).toBe(true);
  const settings = (await (await request.get('/api/email-settings')).json()) as {
    settings: { defaultSiteUrl: string };
  };
  test.skip(!settings.settings.defaultSiteUrl, 'the API has no FRONTEND_BASE_URL');

  const open = (origin?: string) =>
    new Promise<boolean>((resolve) => {
      const socket = io(baseURL!, {
        transports: ['polling'],
        extraHeaders: origin ? { Origin: origin } : {},
        forceNew: true,
        reconnection: false,
      });
      socket.once('connect', () => {
        socket.close();
        resolve(true);
      });
      socket.once('connect_error', () => {
        socket.close();
        resolve(false);
      });
    });

  expect(await open('https://evil.example')).toBe(false);
  expect(await open(settings.settings.defaultSiteUrl)).toBe(true);
  expect(await open()).toBe(true);
});
