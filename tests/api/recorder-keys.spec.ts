import { test, expect } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';

/**
 * Recorder keys (api/src/integrations/cs2/demos/recorderKeys.ts): made by an
 * admin, good for the recorder's own calls and nothing else, revocable. A
 * recorder's heartbeat keeps its claims; an admin can name a recorder.
 */

const TAGS = { tag: ['@api', '@security'] };

test(
  'a recorder key works for recorder calls only, until it is revoked',
  TAGS,
  async ({ request, playwright }) => {
    expect(await signInViaRequest(request)).toBe(true);
    const made = await request.post('/api/game/cs2/recorder-keys', {
      data: { name: `spec-key-${Date.now()}` },
    });
    expect(made.status()).toBe(200);
    const { key, token } = (await made.json()) as { key: { id: string }; token: string };
    expect(token).toMatch(/^atr_[0-9a-f]{12}_[A-Za-z0-9_-]{20,}$/);

    // The listing never shows the key itself.
    const listed = await (await request.get('/api/game/cs2/recorder-keys')).text();
    expect(listed).toContain(key.id);
    expect(listed).not.toContain(token);

    const base = test.info().project.use.baseURL;
    const asRecorder = await playwright.request.newContext({
      baseURL: base,
      extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    });
    const name = `spec-keyed-${Date.now()}`;
    // Recorder work: yes.
    const claim = await asRecorder.post('/api/game/cs2/recorder/claim', {
      data: { recorder: name, version: 7 },
    });
    expect([200, 204]).toContain(claim.status());
    const beat = await asRecorder.post('/api/game/cs2/recorder/heartbeat', {
      data: { recorder: name },
    });
    expect(beat.status()).toBe(200);
    // Anything else: no, as an unknown token.
    expect((await asRecorder.get('/api/game/cs2/recorders')).status()).toBe(401);
    expect((await asRecorder.get('/api/settings')).status()).toBe(401);
    expect(
      (await asRecorder.post('/api/game/cs2/recorder-keys', { data: { name: 'x' } })).status()
    ).toBe(401);

    // An admin names the recorder.
    expect(
      (
        await request.put(`/api/game/cs2/recorders/${encodeURIComponent(name)}`, {
          data: { label: 'Seat 12' },
        })
      ).status()
    ).toBe(200);
    const recorders = (await (await request.get('/api/game/cs2/recorders')).json())
      .recorders as Array<{
      name: string;
      label: string | null;
    }>;
    expect(recorders.find((r) => r.name === name)?.label).toBe('Seat 12');

    // Revoked: no more work.
    expect((await request.delete(`/api/game/cs2/recorder-keys/${key.id}`)).status()).toBe(200);
    expect(
      (await asRecorder.post('/api/game/cs2/recorder/claim', { data: { recorder: name } })).status()
    ).toBe(401);
    expect((await request.delete(`/api/game/cs2/recorder-keys/${key.id}`)).status()).toBe(404);

    // A made-up key is refused.
    const fake = await playwright.request.newContext({
      baseURL: base,
      extraHTTPHeaders: { Authorization: 'Bearer atr_000000000000_notarealsecretnotarealsecret' },
    });
    expect(
      (await fake.post('/api/game/cs2/recorder/claim', { data: { recorder: name } })).status()
    ).toBe(401);
    await asRecorder.dispose();
    await fake.dispose();
  }
);
