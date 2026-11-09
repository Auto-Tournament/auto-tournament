import { test, expect } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';

/**
 * Sign-up invite links: an admin makes one in Settings; while self-registration is off,
 * someone who opens it can still make an account, as many times as the link allows.
 *
 * @tag api
 * @tag auth
 */

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069';

test(
  'an invite link lets a new player register while self-registration is off',
  { tag: ['@api'] },
  async ({ request, playwright }) => {
    expect(await signInViaRequest(request)).toBe(true);
    const before = (await (await request.get('/api/settings')).json()) as {
      settings: { allowSelfRegister: boolean };
    };
    expect((await request.put('/api/settings', { data: { allowSelfRegister: false } })).ok()).toBe(
      true
    );

    const stamp = String(Date.now()).slice(-9);
    const ids = [`7656119900${stamp}`, `7656119901${stamp}`];
    try {
      expect(
        (await request.post('/api/settings/signup-invites', { data: { maxUses: 0 } })).status()
      ).toBe(400);
      const made = await request.post('/api/settings/signup-invites', {
        data: { maxUses: 1, expiresInDays: 7 },
      });
      expect(made.status(), await made.text()).toBe(201);
      const { invite, path } = (await made.json()) as {
        invite: { id: string; maxUses: number; uses: number };
        path: string;
      };
      expect(path).toMatch(/^\/api\/auth\/invite\/[A-Za-z0-9_-]{43}$/);
      expect(invite.maxUses).toBe(1);
      const listed = (await (await request.get('/api/settings/signup-invites')).json()) as {
        invites: Array<{ id: string }>;
      };
      expect(listed.invites.some((i) => i.id === invite.id)).toBe(true);
      expect(JSON.stringify(listed)).not.toContain(path.split('/').pop());

      // A signed-in Steam ID with no player row, as after a sign-in while registration is off.
      const browser = async (steamId: string) => {
        const ctx = await playwright.request.newContext({ baseURL });
        const signedIn = await ctx.post('/api/test/login-player', {
          data: { steamId, noPlayer: true },
        });
        expect(signedIn.ok()).toBe(true);
        return ctx;
      };

      const first = await browser(ids[0]);
      const second = await browser(ids[1]);
      try {
        expect((await first.post('/api/auth/self-register')).status()).toBe(403);

        const bad = await first.get('/api/auth/invite/not-a-real-token', { maxRedirects: 0 });
        expect(bad.status()).toBe(302);
        expect(bad.headers().location).toMatch(/\/login\?invite=invalid$/);

        const opened = await first.get(path, { maxRedirects: 0 });
        expect(opened.status()).toBe(302);
        expect(opened.headers().location).toMatch(/\/login\?invite=ok$/);
        const registered = await first.post('/api/auth/self-register');
        expect(registered.status(), await registered.text()).toBe(200);
        expect(((await registered.json()) as { created: boolean }).created).toBe(true);

        // The one use is gone: the link no longer opens, and its cookie no longer registers.
        const again = await second.get(path, { maxRedirects: 0 });
        expect(again.headers().location).toMatch(/\/login\?invite=invalid$/);
        expect((await second.post('/api/auth/self-register')).status()).toBe(403);
        const after = (await (await request.get('/api/settings/signup-invites')).json()) as {
          invites: Array<{ id: string }>;
        };
        expect(after.invites.some((i) => i.id === invite.id)).toBe(false);
      } finally {
        await first.dispose();
        await second.dispose();
      }

      // A revoked link stops working at once.
      const other = (await (
        await request.post('/api/settings/signup-invites', { data: {} })
      ).json()) as {
        invite: { id: string };
        path: string;
      };
      expect((await request.delete(`/api/settings/signup-invites/${other.invite.id}`)).ok()).toBe(
        true
      );
      expect(
        (await request.delete(`/api/settings/signup-invites/${other.invite.id}`)).status()
      ).toBe(404);
      const revoked = await request.get(other.path, { maxRedirects: 0 });
      expect(revoked.headers().location).toMatch(/\/login\?invite=invalid$/);
    } finally {
      for (const id of ids) await request.delete(`/api/players/${id}`);
      await request.put('/api/settings', {
        data: { allowSelfRegister: before.settings.allowSelfRegister },
      });
    }
  }
);
