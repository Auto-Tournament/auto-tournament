import { test, expect } from '@playwright/test';
import { getAuthHeader, signInAsPlayerViaRequest, signInViaRequest } from '../helpers/auth';
import {
  nextRarity,
  tradeUpFloat,
  tradeUpRule,
  type Rarity,
} from '../../api/src/integrations/cs2/skins/skinService';
import { canPick, togglePick } from '../../client/src/integrations/cs2/skins/tradeUp';

/**
 * Trade-up contracts (skins/skinService.ts tradeUp): N weapon skins of one
 * grade for one random skin of the next, with their average wear.
 *
 * @tag api
 * @tag skins
 */

const TAGS = { tag: ['@api', '@skins'] };
const STEAM_ID = '76561198099990088';

const skin = (id: number, rarity: Rarity, weapon = 'weapon_p250') => ({ id, rarity, weapon });

test.describe('trade-up rules (pure)', () => {
  test('the next grade, up to ancient and never contraband', TAGS, () => {
    expect(nextRarity('common')).toBe('uncommon');
    expect(nextRarity('legendary')).toBe('ancient');
    expect(nextRarity('ancient')).toBeNull();
    expect(nextRarity('immortal')).toBeNull();
  });

  test('exactly the count, one grade, no knives or gloves, all yours', TAGS, () => {
    const five = [1, 2, 3, 4, 5].map((id) => skin(id, 'rare'));
    expect(tradeUpRule(five, [1, 2, 3, 4, 5], 5)).toEqual({
      ok: true,
      from: 'rare',
      to: 'mythical',
    });
    expect(tradeUpRule(five.slice(0, 4), [1, 2, 3, 4], 5).ok).toBe(false);
    // A repeated id is one skin.
    expect(tradeUpRule(five.slice(0, 4), [1, 1, 2, 3, 4], 5).ok).toBe(false);
    // Someone else's: fewer found than asked for.
    expect(tradeUpRule(five.slice(0, 4), [1, 2, 3, 4, 99], 5).ok).toBe(false);
    expect(tradeUpRule([...five.slice(0, 4), skin(5, 'common')], [1, 2, 3, 4, 5], 5).ok).toBe(
      false
    );
    expect(
      tradeUpRule(
        [...five.slice(0, 4), skin(5, 'rare', 'weapon_knife_karambit')],
        [1, 2, 3, 4, 5],
        5
      ).ok
    ).toBe(false);
    const ancients = [1, 2, 3, 4, 5].map((id) => skin(id, 'ancient'));
    expect(tradeUpRule(ancients, [1, 2, 3, 4, 5], 5).ok).toBe(false);
  });

  test('wear is the average of the inputs', TAGS, () => {
    expect(tradeUpFloat([0.1, 0.2, 0.3])).toBeCloseTo(0.2, 6);
  });

  test('picking in the inventory: one grade, room left, no knives', TAGS, () => {
    const s = (id: number, rarity: Rarity, slot = 'weapon_p250') => ({ id, rarity, slot });
    let picked: ReturnType<typeof s>[] = [];
    picked = togglePick(s(1, 'rare'), picked, 2);
    expect(canPick(s(2, 'common'), picked, 2)).toBe(false);
    expect(canPick(s(3, 'rare', 'knife'), picked, 2)).toBe(false);
    picked = togglePick(s(4, 'rare'), picked, 2);
    expect(canPick(s(5, 'rare'), picked, 2)).toBe(false);
    // A picked one can always be unpicked.
    expect(canPick(s(1, 'rare'), picked, 2)).toBe(true);
    expect(togglePick(s(1, 'rare'), picked, 2).map((p) => p.id)).toEqual([4]);
  });
});

test.describe.serial('trade-up end to end', () => {
  test(
    'five commons become one uncommon with their average wear',
    TAGS,
    async ({ request, playwright, baseURL }) => {
      await signInViaRequest(request);
      const headers = getAuthHeader();
      const config = await (await request.get('/api/skins/admin/config', { headers })).json();
      try {
        expect(
          (
            await request.put('/api/skins/admin/config', {
              headers,
              data: { enabled: true, tradeUp: { enabled: true, count: 5 } },
            })
          ).ok()
        ).toBe(true);
        const player = await playwright.request.newContext({ baseURL });
        expect(await signInAsPlayerViaRequest(player, STEAM_ID, 'Trade Up Tester')).toBe(true);

        // Five commons from the catalogue (it comes from GitHub; without it nothing to give).
        const commons: Array<{ weapon: string; paintKit: number }> = [];
        for (const q of ['p250', 'nova', 'mp7', 'sawed', 'mag', 'xm1014', 'ump', 'tec']) {
          const res = await request.get(`/api/skins/admin/catalog?q=${q}`, { headers });
          const skins = ((await res.json()).skins ?? []) as Array<{
            weapon: string;
            paintKit: number;
            rarity: string;
          }>;
          commons.push(...skins.filter((s) => s.rarity === 'common'));
          if (commons.length >= 6) break;
        }
        test.skip(commons.length < 6, 'The skin catalogue could not be read');

        const floats = [0.1, 0.2, 0.3, 0.4, 0.5];
        const ids: number[] = [];
        for (const [i, s] of commons.slice(0, 5).entries()) {
          const given = await request.post(`/api/skins/admin/players/${STEAM_ID}/skins`, {
            headers,
            data: { weapon: s.weapon, paintKit: s.paintKit, float: floats[i] },
          });
          expect(given.ok(), await given.text()).toBe(true);
          ids.push((await given.json()).id);
        }

        const status = await (await player.get('/api/skins/status')).json();
        expect(status.tradeUp).toEqual({ count: 5 });
        const preview = await (await player.get('/api/skins/me/trade-up?rarity=common')).json();
        expect(preview).toMatchObject({ enabled: true, count: 5, to: 'uncommon' });
        expect(preview.skins.length).toBeGreaterThan(0);

        // Four is not a contract.
        expect(
          (
            await player.post('/api/skins/me/trade-up', { data: { skinIds: ids.slice(0, 4) } })
          ).status()
        ).toBe(400);

        const traded = await player.post('/api/skins/me/trade-up', { data: { skinIds: ids } });
        expect(traded.ok(), await traded.text()).toBe(true);
        const { skinId } = await traded.json();

        const inventory = (await (await player.get('/api/skins/me')).json()).inventory as Array<{
          id: number;
          rarity: string;
          float: number;
          source: string;
        }>;
        expect(inventory.some((s) => ids.includes(s.id))).toBe(false);
        const got = inventory.find((s) => s.id === skinId)!;
        expect(got).toMatchObject({ rarity: 'uncommon', source: 'tradeup' });
        expect(got.float).toBeCloseTo(0.3, 4);

        // The same skins again: gone.
        expect(
          (await player.post('/api/skins/me/trade-up', { data: { skinIds: ids } })).status()
        ).toBe(400);
        await player.dispose();
      } finally {
        await request.put('/api/skins/admin/config', { headers, data: config.config ?? config });
      }
    }
  );
});
