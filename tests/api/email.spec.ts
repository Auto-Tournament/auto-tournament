import { test, expect, type PlaywrightWorkerArgs } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';

/**
 * Email (api/src/routes/email.ts, services/emailService.ts and
 * services/playerEmailService.ts): the SMTP settings are admin only and
 * never send the password back; a player cannot add an address while the
 * site does not send email; password recovery never says whether an account
 * exists; an account an admin makes picks its own password at first sign-in.
 *
 * @tag api
 * @tag auth
 */

const TAGS = { tag: ['@api', '@auth'] };
const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069';

function fresh(playwright: PlaywrightWorkerArgs['playwright']) {
  return playwright.request.newContext({ baseURL: BASE });
}

test.describe.serial('email', () => {
  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
  });

  test(
    'the SMTP settings are admin only, checked, and keep the password to themselves',
    TAGS,
    async ({ request, playwright }) => {
      const anon = await fresh(playwright);
      expect((await anon.get('/api/email-settings')).status()).toBe(401);
      await anon.dispose();

      const bad = await request.put('/api/email-settings', { data: { port: 70000 } });
      expect(bad.status(), await bad.text()).toBe(400);
      const noServer = await request.put('/api/email-settings', {
        data: { host: '', enabled: true },
      });
      expect(noServer.status(), await noServer.text()).toBe(400);

      const saved = await request.put('/api/email-settings', {
        data: {
          enabled: false,
          host: 'smtp.example.invalid',
          port: 587,
          security: 'starttls',
          username: 'mailer',
          password: 'smtp secret',
          fromAddress: 'noreply@example.invalid',
          fromName: 'E2E',
        },
      });
      expect(saved.status(), await saved.text()).toBe(200);
      const body = await saved.text();
      expect(body).not.toContain('smtp secret');
      const { settings } = JSON.parse(body) as {
        settings: { passwordSet: boolean; ready: boolean; host: string };
      };
      expect(settings).toMatchObject({
        passwordSet: true,
        ready: false,
        host: 'smtp.example.invalid',
      });

      // Not turned on: no test email, and players cannot add an address yet.
      expect(
        (
          await request.post('/api/email-settings/test', { data: { to: 'a@example.invalid' } })
        ).status()
      ).toBe(400);
      const add = await request.put('/api/me/email', { data: { email: 'admin@example.invalid' } });
      expect(add.status(), await add.text()).toBe(409);
      expect(
        (await request.put('/api/me/email', { data: { email: 'not an address' } })).status()
      ).toBe(400);
    }
  );

  test(
    'password recovery answers the same for any name, and a bad reset link is refused',
    TAGS,
    async ({ playwright }) => {
      const anon = await fresh(playwright);
      for (const identifier of ['nobody-here', 'someone@example.invalid']) {
        const res = await anon.post('/api/auth/local/forgot', { data: { identifier } });
        expect(res.status(), await res.text()).toBe(200);
      }
      const reset = await anon.post('/api/auth/local/reset', {
        data: { token: 'x'.repeat(43), password: 'a new passphrase' },
      });
      expect(reset.status(), await reset.text()).toBe(400);
      expect(
        (await anon.post('/api/email/verify', { data: { token: 'y'.repeat(43) } })).status()
      ).toBe(400);
      expect(
        (await anon.post('/api/email/unsubscribe', { data: { token: 'z'.repeat(43) } })).status()
      ).toBe(400);
      await anon.dispose();
    }
  );

  test(
    'an account an admin makes picks its own password at first sign-in',
    TAGS,
    async ({ request, playwright }) => {
      const on = await request.put('/api/sign-in-providers/admin-access', {
        data: { localAdminLoginEnabled: true },
      });
      expect(on.status(), await on.text()).toBe(200);
      const user = `e2e-first-${Date.now().toString(36)}`;
      const given = 'the password an admin picked';
      const created = await request.post('/api/local-accounts', {
        data: { username: user, password: given },
      });
      expect(created.status(), await created.text()).toBe(201);

      const owner = await fresh(playwright);
      const first = await owner.post('/api/auth/local/login', {
        data: { username: user, password: given },
      });
      expect(first.status(), await first.text()).toBe(200);
      expect(((await first.json()) as { mustChangePassword: boolean }).mustChangePassword).toBe(
        true
      );
      const changed = await owner.post('/api/auth/local/password', {
        data: { currentPassword: given, newPassword: 'their very own passphrase' },
      });
      expect(changed.status(), await changed.text()).toBe(200);
      await owner.dispose();

      const again = await fresh(playwright);
      const second = await again.post('/api/auth/local/login', {
        data: { username: user, password: 'their very own passphrase' },
      });
      expect(((await second.json()) as { mustChangePassword: boolean }).mustChangePassword).toBe(
        false
      );
      await again.dispose();

      // An admin setting a new password asks for a fresh one again.
      expect(
        (
          await request.put(`/api/local-accounts/${user}/password`, { data: { password: given } })
        ).status()
      ).toBe(200);
      const third = await (
        await fresh(playwright)
      ).post('/api/auth/local/login', { data: { username: user, password: given } });
      expect(((await third.json()) as { mustChangePassword: boolean }).mustChangePassword).toBe(
        true
      );
      expect((await request.delete(`/api/local-accounts/${user}`)).status()).toBe(200);
    }
  );
});
