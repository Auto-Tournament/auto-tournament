import { test, expect } from '@playwright/test';
import { drawMaps } from '../../api/src/integrations/cs2/matchConfig';
import { cs2Integration } from '../../api/src/integrations/cs2';
import { toIntegrationTournament } from '../../api/src/utils/matchIntegration';
import type { TournamentResponse } from '../../api/src/types/tournament.types';

/**
 * A tournament without a veto (`settings.cs2.veto: false`): no pre-match
 * phase, and each match plays maps drawn from the pool, the same on every
 * read of its config.
 *
 * @tag api
 */
const TAGS = { tag: ['@api'] };

test(
  'the map draw is the same for a match every time, and fills a series from a small pool',
  TAGS,
  () => {
    const pool = [
      'de_inferno',
      'de_nuke',
      'de_overpass',
      'de_vertigo',
      'de_poseidon',
      'de_debris',
      'de_eldorado',
    ];
    expect(drawMaps(pool, 1, 't9-r1m1')).toEqual(drawMaps(pool, 1, 't9-r1m1'));
    expect(pool).toContain(drawMaps(pool, 1, 't9-r1m2')[0]);
    // Different matches spread over the pool.
    const firsts = new Set(
      Array.from({ length: 30 }, (_, i) => drawMaps(pool, 1, `t9-r1m${i}`)[0])
    );
    expect(firsts.size).toBeGreaterThan(2);
    // A BO3 from two maps repeats one.
    expect(drawMaps(['de_inferno', 'de_nuke'], 3, 'x')).toHaveLength(3);
    // A BO3 from a big pool plays three different maps.
    expect(new Set(drawMaps(pool, 3, 'y')).size).toBe(3);
  }
);

test('veto off turns the pre-match phase off; on (or unset) keeps it', TAGS, () => {
  expect(cs2Integration.usesPreMatchPhase?.({ settings: { cs2: { veto: false } } })).toBe(false);
  expect(cs2Integration.usesPreMatchPhase?.({ settings: { cs2: { veto: true } } })).toBe(true);
  expect(cs2Integration.usesPreMatchPhase?.({ settings: JSON.stringify({ cs2: {} }) })).toBe(true);
});

test(
  'a later round of a veto-off tournament is ready to allocate (no veto to wait for)',
  TAGS,
  async () => {
    // MatchContext used to hand the whole tournament as `settings` (its settings one level
    // down): the check read only the top level, so the final of a veto-off bracket waited for a
    // veto that never opened (2026-10-15). Its tournament comes from toIntegrationTournament.
    const response = {
      id: 9,
      type: 'single_elimination',
      format: 'bo1',
      settings: { cs2: { veto: false } },
    } as unknown as TournamentResponse;
    const ctx = () =>
      ({
        slug: 't9-r2m1',
        matchId: 1,
        game: 'cs2',
        tournament: toIntegrationTournament(response),
        team1: { id: 'a' },
        team2: { id: 'b' },
        round: 2,
        bracket: null,
        integrationConfig: null,
        resourceId: null,
      }) as unknown as Parameters<NonNullable<typeof cs2Integration.isReadyToAllocate>>[0];
    expect(await cs2Integration.isReadyToAllocate?.(ctx())).toBe(true);
  }
);
