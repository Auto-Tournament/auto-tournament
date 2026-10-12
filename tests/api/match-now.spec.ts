import { test, expect } from '@playwright/test';
import { signInAsPlayerViaRequest } from '../helpers/auth';
import {
  nextCrashState,
  showMissedMove,
  MISSED_MOVE_SECONDS,
} from '../../client/src/integrations/cs2/match/crashPopup';

/**
 * "My match now" (GET /api/players/me/match-now, the `/match/now` page) and
 * the "your server crashed" popup's state from the failover broadcasts.
 *
 * @tag api
 */

test.describe('match now', () => {
  test(
    'signed out: 401; a player with no match: no path',
    { tag: ['@api'] },
    async ({ playwright, baseURL }) => {
      const anon = await playwright.request.newContext({ baseURL });
      expect((await anon.get('/api/players/me/match-now')).status()).toBe(401);
      const player = await playwright.request.newContext({ baseURL });
      const id = `7656119${String(Date.now() % 1e10).padStart(10, '0')}`;
      expect(await signInAsPlayerViaRequest(player, id, 'No Match Yet')).toBe(true);
      const res = await player.get('/api/players/me/match-now');
      expect(res.ok(), await res.text()).toBe(true);
      expect((await res.json()).path).toBeNull();
      await anon.dispose();
      await player.dispose();
    }
  );
});

test.describe('crash popup state', () => {
  const mine = 'my-match';

  test("only the viewer's own match opens it; it follows the recovery", () => {
    expect(nextCrashState(null, { matchSlug: 'other', status: 'open' }, mine)).toBeNull();
    expect(nextCrashState(null, { matchSlug: mine, status: 'open' }, null)).toBeNull();
    let s = nextCrashState(null, { matchSlug: mine, status: 'open' }, mine);
    expect(s).toEqual({ matchSlug: mine, phase: 'down' });
    s = nextCrashState(s, { matchSlug: mine, status: 'moving' }, mine);
    expect(s?.phase).toBe('moving');
    s = nextCrashState(s, { matchSlug: mine, status: 'moved' }, mine);
    expect(s?.phase).toBe('back');
    expect(nextCrashState(s, { matchSlug: mine, status: 'dismissed' }, mine)).toBeNull();
  });

  test('the server coming back by itself: reconnect only when the popup was up', () => {
    expect(nextCrashState(null, { matchSlug: mine, status: 'withdrawn' }, mine)).toBeNull();
    const down = { matchSlug: mine, phase: 'down' as const };
    expect(nextCrashState(down, { matchSlug: mine, status: 'withdrawn' }, mine)?.phase).toBe(
      'back'
    );
  });

  test('a move the page missed shows when recent and not closed before', () => {
    expect(showMissedMove(1000, 1000 + 60, false)).toBe(true);
    expect(showMissedMove(1000, 1000 + MISSED_MOVE_SECONDS, false)).toBe(false);
    expect(showMissedMove(1000, 1060, true)).toBe(false);
    expect(showMissedMove(null, 1060, false)).toBe(false);
  });
});
