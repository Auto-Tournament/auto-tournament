import { test, expect } from '@playwright/test';
import { db } from '../../api/src/config/database';
import { skinService } from '../../api/src/integrations/cs2/skins/skinService';

/**
 * awardTournament runs once per tournament, also when the reward is a choice
 * of three nobody has picked from yet (no cs2_player_skins row, only a
 * cs2_skin_choices row with the same source_ref).
 *
 * @tag api
 * @tag skins
 */
test('awardTournament twice before a pick creates one set of choices', async () => {
  const STEAM = '76561198000000001';
  const choices: Array<{ source_ref: string }> = [];
  const d = db as unknown as Record<string, unknown>;
  const svc = skinService as unknown as Record<string, unknown>;
  const saved = {
    queryOneAsync: d.queryOneAsync,
    queryAsync: d.queryAsync,
    config: svc.config,
    catalog: svc.catalog,
    pickOptions: svc.pickOptions,
    offerChoice: svc.offerChoice,
  };
  try {
    d.queryOneAsync = async (sql: string, params: unknown[] = []) => {
      if (sql.includes('FROM cs2_player_skins')) return undefined;
      if (sql.includes('FROM cs2_skin_choices'))
        return choices.find((c) => c.source_ref === params[0]) ? { id: 1 } : undefined;
      if (sql.includes('FROM players')) return { uid: 'uid-1' };
      return undefined;
    };
    d.queryAsync = async () => [{ player_id: STEAM }];
    svc.config = async () => ({
      enabled: true,
      tournamentRewards: true,
      rewards: [{ place: 1, mode: 'rarity', rarity: 'rare' }],
    });
    svc.catalog = async () => [];
    svc.pickOptions = async () => [{ id: 1 }, { id: 2 }, { id: 3 }];
    svc.offerChoice = async (_uid: string, _o: unknown, meta: { ref: string }) => {
      choices.push({ source_ref: meta.ref });
    };

    const placements = [{ place: 1 as const, steamIds: [STEAM] }];
    await skinService.awardTournament(7, 'Cup', placements);
    await skinService.awardTournament(7, 'Cup', placements);
    expect(choices).toHaveLength(1);
  } finally {
    Object.assign(d, { queryOneAsync: saved.queryOneAsync, queryAsync: saved.queryAsync });
    Object.assign(svc, {
      config: saved.config,
      catalog: saved.catalog,
      pickOptions: saved.pickOptions,
      offerChoice: saved.offerChoice,
    });
  }
});
