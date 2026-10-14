import { test, expect } from '@playwright/test';
import { getAuthHeader, signInViaRequest } from '../helpers/auth';

/**
 * API tokens made in Settings: a signed-in admin makes one and sees its
 * secret once; it works like an env token of its scope; a token cannot make
 * tokens; a revoked one stops working at once.
 *
 * @tag api
 * @tag auth
 */

test(
  'make, use and revoke API tokens from Settings',
  { tag: ['@api'] },
  async ({ request, playwright }) => {
    expect(await signInViaRequest(request)).toBe(true);
    const stamp = String(Date.now()).slice(-8);

    // Made by the signed-in admin (the session, no token header).
    const made = await request.post('/api/settings/api-tokens', {
      data: { label: `mcp-${stamp}`, scope: 'readonly' },
    });
    expect(made.status(), await made.text()).toBe(201);
    const { secret, token } = (await made.json()) as {
      secret: string;
      token: { id: number; label: string; scope: string; fingerprint: string };
    };
    expect(secret).toMatch(/^att_[0-9a-f]{64}$/);
    expect(token.scope).toBe('readonly');

    // Listed without its secret.
    const listed = (await (await request.get('/api/settings/api-tokens')).json()) as {
      tokens: Array<Record<string, unknown>>;
    };
    const row = listed.tokens.find((t) => t.label === `mcp-${stamp}`);
    expect(row).toBeTruthy();
    expect(JSON.stringify(listed)).not.toContain(secret);

    const bare = await playwright.request.newContext({
      baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069',
    });
    try {
      const auth = { Authorization: `Bearer ${secret}` };
      // Reads like an admin...
      expect((await bare.get('/api/settings', { headers: auth })).status()).toBe(200);
      // ...but a read-only token cannot write.
      expect(
        (
          await bare.post('/api/settings/api-tokens', {
            headers: auth,
            data: { label: 'x', scope: 'admin' },
          })
        ).status()
      ).toBe(403);

      // An admin token still cannot make tokens.
      const admin = await request.post('/api/settings/api-tokens', {
        data: { label: `mcp-admin-${stamp}`, scope: 'admin' },
      });
      expect(admin.status()).toBe(201);
      const adminSecret = ((await admin.json()) as { secret: string }).secret;
      const minted = await bare.post('/api/settings/api-tokens', {
        headers: { Authorization: `Bearer ${adminSecret}` },
        data: { label: `mcp-minted-${stamp}`, scope: 'admin' },
      });
      expect(minted.status()).toBe(403);
      const adminId = ((await admin.json()) as { token: { id: number } }).token.id;

      // Bad names are refused.
      expect(
        (
          await request.post('/api/settings/api-tokens', {
            data: { label: 'no spaces', scope: 'readonly' },
          })
        ).status()
      ).toBe(400);

      // Revoked: 401 at once.
      expect((await request.delete(`/api/settings/api-tokens/${token.id}`)).ok()).toBe(true);
      expect((await bare.get('/api/settings', { headers: auth })).status()).toBe(401);
      await request.delete(`/api/settings/api-tokens/${adminId}`, { headers: getAuthHeader() });
    } finally {
      await bare.dispose();
    }
  }
);
