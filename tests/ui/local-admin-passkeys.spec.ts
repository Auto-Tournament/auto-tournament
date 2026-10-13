import { test, expect } from '@playwright/test';

/**
 * Passkeys end to end (Vikunja 1741), with Chrome's virtual authenticator
 * standing in for Touch ID: real WebAuthn on both sides, nothing faked.
 * A local admin adds a passkey on /me/connections, signs out, and signs in on
 * /login/admin with the passkey alone.
 *
 * @tag ui
 * @tag auth
 * @tag security
 */

const digits = (n: number) =>
  Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');

test.describe('Local admin passkeys', () => {
  test(
    'add a passkey on the account page, then sign in with it',
    { tag: ['@ui', '@auth', '@security'] },
    async ({ page, browserName }) => {
      test.skip(
        browserName !== 'chromium',
        'the virtual authenticator is a Chrome DevTools feature'
      );
      const status = await (await page.request.get('/api/auth/local/status')).json();
      test.skip(!status.passkeys, 'passkeys need FRONTEND_BASE_URL on https or localhost');

      // The real verifier, whatever an API test left behind.
      await page.request
        .post('/api/test/passkey-verifier', { data: { fake: false } })
        .catch(() => undefined);

      const cdp = await page.context().newCDPSession(page);
      await cdp.send('WebAuthn.enable');
      await cdp.send('WebAuthn.addVirtualAuthenticator', {
        options: {
          protocol: 'ctap2',
          transport: 'internal',
          hasResidentKey: true,
          hasUserVerification: true,
          isUserVerified: true,
          automaticPresenceSimulation: true,
        },
      });

      // A new local admin, signed in in this browser.
      await page.request.post('/api/test/login-throttle/reset');
      const codeRes = await page.request.post('/api/test/setup-code', {
        data: { purpose: 'reset' },
      });
      expect(codeRes.ok(), await codeRes.text()).toBe(true);
      const { code } = (await codeRes.json()) as { code: string };
      const username = `pkui-${digits(8)}`;
      const done = await page.request.post('/api/setup/complete', {
        data: { code, username, password: 'passkey ui test passphrase' },
      });
      expect(done.status(), await done.text()).toBe(200);

      await page.goto('/me/connections');
      await page.getByTestId('passkey-add').click();
      await page.getByTestId('passkey-name').fill('Test laptop');
      await page.getByTestId('passkey-continue').click();
      await expect(page.getByTestId('passkey-row')).toContainText('Test laptop');

      // Signed out: the passkey alone signs the account in.
      await page.context().clearCookies();
      await page.goto('/login/admin');
      await page.getByTestId('admin-login-passkey').click();
      await expect
        .poll(async () => (await (await page.request.get('/api/auth/admin/me')).json()).steamId)
        .toBe(`local-${username}`);
      await expect(page).not.toHaveURL(/\/login\/admin/);
    }
  );
});
