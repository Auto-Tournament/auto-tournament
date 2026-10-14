import { test, expect } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';

/**
 * A map played again (restarted, or restored to a round) gets a new demo.
 * Its analysis replaces the clips the old demo gave for the rounds played
 * again (Sivert, 2026-10-14): those are marked `superseded`, out of every
 * list and reel. Clips of earlier rounds stay, and a retried analysis of
 * the same demo keeps its clips.
 *
 * @tag api
 * @tag highlights
 */
test(
  'clips of rounds played again are replaced by the new demo',
  { tag: ['@api'] },
  async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    const slug = `replayed-${Date.now()}`;
    const player = '76561198000000042';
    const clip = (round: number, startTick: number, demoPath: string, status = 'done') => ({
      playerId: player,
      round,
      startTick,
      status,
      demoPath,
    });

    // A restore to round 8: the new demo plays rounds 8 on.
    const res = await request.post('/api/test/highlights/repick', {
      data: {
        matchSlug: slug,
        mapNumber: 0,
        clips: [
          clip(3, 1000, 'old.dem'),
          clip(9, 2000, 'old.dem'),
          clip(12, 3000, 'old.dem', 'recording'),
        ],
        source: { demoPath: 'new.dem', firstRound: 8 },
      },
    });
    expect(res.ok(), await res.text()).toBe(true);
    const { statuses } = (await res.json()) as { statuses: Record<string, string> };
    expect(statuses['1000']).toBe('done'); // round 3, before the restore
    expect(statuses['2000']).toBe('superseded');
    expect(statuses['3000']).toBe('superseded');

    // The same demo analysed again keeps its clips.
    const again = await request.post('/api/test/highlights/repick', {
      data: {
        matchSlug: `${slug}-same`,
        mapNumber: 0,
        clips: [clip(9, 4000, 'new.dem')],
        source: { demoPath: 'new.dem', firstRound: 1 },
      },
    });
    expect(((await again.json()) as { statuses: Record<string, string> }).statuses['4000']).toBe(
      'done'
    );
  }
);
