import { test, expect } from '@playwright/test';
import { getAuthHeader, signInAsPlayerViaRequest, signInViaRequest } from '../helpers/auth';
import { normalizeNoticeSettings } from '../../api/src/services/adminNoticeService';
import { stuckState } from '../../api/src/services/adminNoticeSweep';
import { isSilentMatch, MATCH_SILENT_SECONDS } from '../../api/src/integrations/cs2/adminNotices';
import {
  noticeKey,
  noticeLink,
  noticeParams,
  sortNotices,
  upsertNotice,
  type AdminNotice,
} from '../../client/src/components/admin/adminNoticeText';

/**
 * The admins' bell (services/adminNoticeService.ts): raised where something
 * needs an admin, counted up on repeats, closed when it fixes itself or is
 * dismissed, each admin's own unread count, per-kind settings.
 *
 * @tag api
 */

const notice = (over: Partial<AdminNotice>): AdminNotice => ({
  id: 1,
  kind: 'server_crashed',
  severity: 'error',
  data: {},
  dedupeKey: 'k',
  count: 1,
  createdAt: 100,
  updatedAt: 100,
  resolvedAt: null,
  ...over,
});

test.describe('admin notices (rules)', () => {
  test('settings: unknown values fall back, errors ring by default', () => {
    const s = normalizeNoticeSettings({ server_crashed: 'off', clips_failing: 'loud' });
    expect(s.server_crashed).toBe('off');
    expect(s.clips_failing).toBe('bell');
    expect(s.failover).toBe('sound');
    expect(s.beta_available).toBe('bell');
  });

  test('what a stuck match is stuck on', () => {
    const base = { slug: 'm', serverId: null, loadedAt: null, veto: null };
    expect(stuckState({ ...base, status: 'loaded', loadedAt: 5 })).toEqual({
      kind: 'warmup_long',
      state: 'loaded:5',
    });
    expect(stuckState({ ...base, status: 'ready' })).toEqual({
      kind: 'match_no_server',
      state: 'ready',
    });
    expect(stuckState({ ...base, status: 'ready', serverId: 'srv' })).toBeNull();
    expect(stuckState({ ...base, status: 'pending' })).toBeNull();
    expect(
      stuckState({ ...base, status: 'pending', veto: { status: 'in_progress', actions: 3 } })
    ).toEqual({
      kind: 'veto_stalled',
      state: 'veto:3',
    });
    expect(stuckState({ ...base, status: 'live' })).toBeNull();
  });

  test('a live match goes silent after a quarter of an hour without its server, unless paused', () => {
    const at = 100_000;
    expect(isSilentMatch(at - MATCH_SILENT_SECONDS, at, 'live')).toBe(true);
    expect(isSilentMatch(at - MATCH_SILENT_SECONDS + 60, at, 'live')).toBe(false);
    expect(isSilentMatch(at - 3 * MATCH_SILENT_SECONDS, at, 'paused')).toBe(false);
    expect(isSilentMatch(at - 3 * MATCH_SILENT_SECONDS, at, null)).toBe(true);
  });

  test('the line, the link, and the order', () => {
    const paths = {
      match: (s: string) => `/m/${s}`,
      servers: '/s',
      recorders: '/r',
      license: '/l',
      system: '/sys',
    };
    expect(noticeLink(notice({ kind: 'failover', data: { matchSlug: 'abc' } }), paths)).toBe(
      '/m/abc'
    );
    expect(noticeLink(notice({ kind: 'server_crashed' }), paths)).toBe('/s');
    expect(noticeLink(notice({ kind: 'clips_failing' }), paths)).toBe('/r');
    expect(noticeLink(notice({ kind: 'license_problem' }), paths)).toBe('/l');
    expect(noticeKey(notice({ kind: 'failover', data: { needsDecision: true } }))).toBe(
      'adminNotices.kind.failoverDecision'
    );
    expect(noticeParams(notice({ count: 4, data: { host: 'h1', minutes: 12 } }))).toEqual({
      count: 4,
      host: 'h1',
      minutes: '12',
    });
    const list = sortNotices([
      notice({ id: 1, updatedAt: 300, resolvedAt: 400 }),
      notice({ id: 2, updatedAt: 100 }),
      notice({ id: 3, updatedAt: 200 }),
    ]);
    expect(list.map((n) => n.id)).toEqual([3, 2, 1]);
    expect(
      upsertNotice(list, notice({ id: 2, updatedAt: 500, count: 2 })).map((n) => [n.id, n.count])
    ).toEqual([
      [2, 2],
      [3, 1],
      [1, 1],
    ]);
  });
});

test.describe.serial('admin notices (api)', () => {
  test('admin only', { tag: ['@api'] }, async ({ playwright, baseURL }) => {
    const anon = await playwright.request.newContext({ baseURL });
    expect((await anon.get('/api/admin-notices')).status()).toBe(401);
    const player = await playwright.request.newContext({ baseURL });
    expect(await signInAsPlayerViaRequest(player, '76561198099990211', 'Not An Admin')).toBe(true);
    expect((await player.get('/api/admin-notices')).status()).toBe(403);
    await anon.dispose();
    await player.dispose();
  });

  test('raise, repeat, unread, seen, resolve, dismiss', { tag: ['@api'] }, async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    const headers = getAuthHeader();
    await request.put('/api/admin-notices/settings', {
      headers,
      data: { server_crashed: 'sound' },
    });
    await request.post('/api/admin-notices/seen', { headers });
    const key = `server_crashed:spec-${Date.now()}`;
    const raise = () =>
      request.post('/api/test/admin-notice', {
        headers,
        data: {
          kind: 'server_crashed',
          data: { host: 'h1', server: 'cs2-1', event: 'crashed' },
          dedupeKey: key,
        },
      });
    const first = await (await raise()).json();
    expect(first.notice).toMatchObject({
      kind: 'server_crashed',
      severity: 'error',
      count: 1,
      resolvedAt: null,
    });
    // A second crash of the same server counts up instead of adding a row.
    await new Promise((r) => setTimeout(r, 1100));
    const second = await (await raise()).json();
    expect(second.notice.id).toBe(first.notice.id);
    expect(second.notice.count).toBe(2);

    let list = await (await request.get('/api/admin-notices', { headers })).json();
    expect(list.unread).toBeGreaterThanOrEqual(1);
    expect(list.notices.find((n: { id: number }) => n.id === first.notice.id)).toBeTruthy();
    expect(list.settings.server_crashed).toBe('sound');

    expect((await request.post('/api/admin-notices/seen', { headers })).ok()).toBe(true);
    list = await (await request.get('/api/admin-notices', { headers })).json();
    expect(list.unread).toBe(0);

    // Fixed itself: closed; a new crash then opens a new notice.
    await request.post('/api/test/admin-notice', {
      headers,
      data: { resolve: true, dedupeKey: key },
    });
    list = await (await request.get('/api/admin-notices', { headers })).json();
    expect(
      list.notices.find((n: { id: number }) => n.id === first.notice.id).resolvedAt
    ).not.toBeNull();
    const third = await (await raise()).json();
    expect(third.notice.id).not.toBe(first.notice.id);

    expect(
      (await request.post(`/api/admin-notices/${third.notice.id}/dismiss`, { headers })).ok()
    ).toBe(true);
    expect(
      (await request.post(`/api/admin-notices/${third.notice.id}/dismiss`, { headers })).status()
    ).toBe(404);

    // Off: not raised at all.
    await request.put('/api/admin-notices/settings', { headers, data: { server_crashed: 'off' } });
    expect((await (await raise()).json()).notice).toBeNull();
    await request.put('/api/admin-notices/settings', {
      headers,
      data: { server_crashed: 'sound' },
    });
  });

  test(
    'a lasting problem: one notice, and a dismissal holds until it clears',
    { tag: ['@api'] },
    async ({ request }) => {
      expect(await signInViaRequest(request)).toBe(true);
      const headers = getAuthHeader();
      await request.put('/api/admin-notices/settings', {
        headers,
        data: { recorder_offline: 'bell' },
      });
      const key = `recorder_offline:spec-${Date.now()}`;
      // What the minute sweep does while a recorder stays silent.
      const sweep = async () =>
        (
          await (
            await request.post('/api/test/admin-notice', {
              headers,
              data: {
                kind: 'recorder_offline',
                data: { recorder: 'r1' },
                dedupeKey: key,
                ongoing: true,
              },
            })
          ).json()
        ).notice;

      const first = await sweep();
      expect(first).toMatchObject({ kind: 'recorder_offline', count: 1 });
      // Still offline a minute later: nothing new, no count, no toast.
      expect(await sweep()).toBeNull();
      let list = await (await request.get('/api/admin-notices', { headers })).json();
      expect(list.notices.find((n: { id: number }) => n.id === first.id).count).toBe(1);

      // Dismissed while still offline: the sweep stays quiet.
      expect((await request.post(`/api/admin-notices/${first.id}/dismiss`, { headers })).ok()).toBe(
        true
      );
      expect(await sweep()).toBeNull();
      list = await (await request.get('/api/admin-notices', { headers })).json();
      expect(
        list.notices.filter(
          (n: { dedupeKey: string; resolvedAt: number | null }) =>
            n.dedupeKey === key && n.resolvedAt === null
        )
      ).toHaveLength(0);

      // Back online (cleared), then silent again: a new notice.
      await request.post('/api/test/admin-notice', {
        headers,
        data: { resolve: true, dedupeKey: key },
      });
      const again = await sweep();
      expect(again).toBeTruthy();
      expect(again.id).not.toBe(first.id);
      await request.post('/api/test/admin-notice', {
        headers,
        data: { resolve: true, dedupeKey: key },
      });
    }
  );

  test('settings ignore what they do not know', { tag: ['@api'] }, async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    const res = await request.put('/api/admin-notices/settings', {
      headers: getAuthHeader(),
      data: { nonsense: 'sound', clips_failing: 'loud' },
    });
    const { settings } = await res.json();
    expect(settings.nonsense).toBeUndefined();
    expect(settings.clips_failing).toBe('bell');
  });
});
