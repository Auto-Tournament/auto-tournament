import { test, expect } from '@playwright/test';
import { getAuthHeader, signInAsPlayerViaRequest, signInViaRequest } from '../helpers/auth';
import {
  equipTeam,
  loadoutPayload,
  sideOf,
  withInventoryFallback,
} from '../../api/src/integrations/cs2/skins/skinService';
import {
  applyStep,
  equipOnStep,
  equipStep,
  equippedFor,
  type SidedSkin,
} from '../../client/src/integrations/cs2/skins/loadoutSides';

/**
 * Per-side loadouts: a knife, gloves or a weapon both sides buy can be
 * equipped for CT, T or both; a one-side weapon is always its side's. The
 * server, the client's instant update and the `skins.loadout` message agree.
 *
 * @tag api
 */

const skin = (
  id: number,
  slot: string,
  side: 2 | 3 | null = null,
  sides: Array<0 | 2 | 3> = []
): SidedSkin => ({
  id,
  slot,
  side,
  equippedSides: sides,
  equipped: sides.length > 0,
});

test.describe('loadout sides (rules)', () => {
  test('the new-skin modal equips without toggling: a skin already on that side stays on', () => {
    // Equipped on its own when it dropped: "Equip" must not take it off.
    expect(equipOnStep(skin(1, 'knife', null, [0]), 0)).toBeNull();
    // On both sides (as it dropped), "Equip T" moves it to T only.
    expect(equipOnStep(skin(1, 'knife', null, [0]), 2)).toEqual({ kind: 'split', keep: 2 });
    expect(equipOnStep(skin(1, 'knife', null, [3]), 3)).toBeNull();
    expect(equipOnStep(skin(1, 'knife', null, [3]), 2)).toEqual({ kind: 'equip', team: 2 });
    expect(equipOnStep(skin(1, 'knife', null, [3]), 0)).toEqual({ kind: 'equip', team: 0 });
    expect(equipOnStep(skin(1, 'knife'), 3)).toEqual({ kind: 'equip', team: 3 });
    // A one-side weapon is always "both".
    expect(equipOnStep(skin(2, 'weapon_ak47', 2), 3)).toEqual({ kind: 'equip', team: 0 });
  });

  test('one-side weapons are their side; the rest can go either way', () => {
    expect(sideOf('weapon_ak47')).toBe(2);
    expect(sideOf('weapon_m4a1_silencer')).toBe(3);
    expect(sideOf('weapon_awp')).toBeNull();
    expect(sideOf('weapon_knife_karambit')).toBeNull();
    expect(equipTeam('weapon_ak47', 3)).toBe(0);
    expect(equipTeam('weapon_awp', 3)).toBe(3);
    expect(equipTeam('weapon_awp', 7)).toBe(0);
  });

  test('a side uses its own pick, else a "both" one it can use', () => {
    const inv = [
      skin(1, 'knife', null, [0]),
      skin(2, 'knife', null, [2]),
      skin(3, 'weapon_ak47', 2, [0]),
    ];
    expect(equippedFor(inv, 2).get('knife')?.id).toBe(2);
    expect(equippedFor(inv, 3).get('knife')?.id).toBe(1);
    expect(equippedFor(inv, 2).get('weapon_ak47')?.id).toBe(3);
    expect(equippedFor(inv, 3).has('weapon_ak47')).toBe(false);
  });

  test('clicks: equip a side, take it off, split a "both" one', () => {
    let inv = [skin(1, 'knife', null, [0]), skin(2, 'knife')];
    // Knife 2 for T: knife 1 stays for CT (its "both").
    inv = applyStep(inv, inv[1], equipStep(inv[1], 2));
    expect(inv.map((s) => s.equippedSides)).toEqual([[0], [2]]);
    // Knife 2 for both: the slot's other picks go.
    inv = applyStep(inv, inv[1], equipStep(inv[1], 0));
    expect(inv.map((s) => s.equippedSides)).toEqual([[], [0]]);
    // Clicking knife 2 with CT selected: off CT, kept on T.
    expect(equipStep(inv[1], 3)).toEqual({ kind: 'split', keep: 2 });
    inv = applyStep(inv, inv[1], equipStep(inv[1], 3));
    expect(inv.map((s) => s.equippedSides)).toEqual([[], [2]]);
    // And off T: nothing on.
    inv = applyStep(inv, inv[1], equipStep(inv[1], 2));
    expect(inv[1].equipped).toBe(false);
  });

  test('the server message carries each side', () => {
    const payload = loadoutPayload([
      {
        weapon: 'weapon_knife_karambit',
        paint_kit: 415,
        float_value: 0.01,
        pattern: 1,
        slot: 'knife',
        team: 3,
      },
      {
        weapon: 'weapon_knife_butterfly',
        paint_kit: 38,
        float_value: 0.2,
        pattern: 2,
        slot: 'knife',
        team: 2,
      },
      {
        weapon: 'weapon_awp',
        paint_kit: 344,
        float_value: 0.5,
        pattern: 3,
        slot: 'weapon_awp',
        team: 0,
      },
    ]);
    expect(payload?.knife).toEqual([
      { team: 3, defindex: 507 },
      { team: 2, defindex: 515 },
    ]);
    expect(payload?.paints.map((p) => [p.team, p.defindex])).toEqual([
      [3, 507],
      [2, 515],
      [0, 9],
    ]);
    expect(loadoutPayload([])).toBeNull();
  });

  test('nothing equipped in a weapon slot: the newest owned skin for it, on both sides', () => {
    const row = (weapon: string, paint: number, slot = '', team = 0) => ({
      weapon,
      paint_kit: paint,
      float_value: 0.1,
      pattern: 1,
      slot,
      team,
    });
    const owned = [
      row('weapon_knife_m9_bayonet', 568),
      row('sporty_gloves', 10018),
      row('weapon_knife_tactical', 415),
    ];
    // Knives and gloves only when equipped: owning them adds nothing (the Steam knife stays).
    expect(withInventoryFallback([], owned)).toEqual([]);
    // Weapons too: the newest AK skin owned, unless one is equipped.
    const guns = [row('weapon_ak47', 180), row('weapon_ak47', 44), row('weapon_awp', 344)];
    expect(withInventoryFallback([], guns).map((r) => [r.weapon, r.paint_kit])).toEqual([
      ['weapon_ak47', 180],
      ['weapon_awp', 344],
    ]);
    expect(
      withInventoryFallback([row('weapon_ak47', 44, 'weapon_ak47', 3)], guns).map((r) => [
        r.weapon,
        r.paint_kit,
        r.team,
      ])
    ).toEqual([
      ['weapon_ak47', 44, 3],
      ['weapon_awp', 344, 0],
    ]);
    // A knife equipped (any side) stays the only knife.
    const equipped = [row('weapon_knife_tactical', 415, 'knife', 2)];
    expect(
      withInventoryFallback(equipped, owned)
        .filter((r) => r.slot === 'knife')
        .map((r) => r.weapon)
    ).toEqual(['weapon_knife_tactical']);
    // Nothing owned: nothing added.
    expect(withInventoryFallback([], [])).toEqual([]);
  });
});

test.describe.serial('loadout sides (api)', () => {
  const STEAM_ID = '76561198099990088';

  test(
    'equip for a side, for both, and take one side off',
    { tag: ['@api'] },
    async ({ request, playwright, baseURL }) => {
      await signInViaRequest(request);
      await request.put('/api/skins/admin/config', {
        headers: getAuthHeader(),
        data: { enabled: true },
      });
      const player = await playwright.request.newContext({ baseURL });
      expect(await signInAsPlayerViaRequest(player, STEAM_ID, 'Side Tester')).toBe(true);

      const catalog = await (
        await request.get('/api/skins/admin/catalog?all=1&q=karambit', { headers: getAuthHeader() })
      ).json();
      const knives = (catalog.skins ?? []) as Array<{ weapon: string; paintKit: number }>;
      test.skip(knives.length < 2, 'The skin catalogue could not be read');
      const give = async (weapon: string, paintKit: number) =>
        (
          await (
            await request.post(`/api/skins/admin/players/${STEAM_ID}/skins`, {
              headers: getAuthHeader(),
              data: { weapon, paintKit },
            })
          ).json()
        ).id as number;
      const first = await give(knives[0].weapon, knives[0].paintKit);
      const second = await give(knives[1].weapon, knives[1].paintKit);
      const sides = async () => {
        const me = await (await player.get('/api/skins/me')).json();
        return Object.fromEntries(
          (me.inventory as Array<{ id: number; equippedSides: number[] }>).map((s) => [
            s.id,
            s.equippedSides,
          ])
        );
      };
      // The first knife went on for both sides when it was given.
      expect((await sides())[first]).toEqual([0]);

      expect(
        (await player.post('/api/skins/me/equip', { data: { skinId: second, team: 2 } })).ok()
      ).toBe(true);
      expect(await sides()).toMatchObject({ [first]: [0], [second]: [2] });

      expect(
        (await player.post('/api/skins/me/equip', { data: { skinId: second, team: 0 } })).ok()
      ).toBe(true);
      expect(await sides()).toMatchObject({ [first]: [], [second]: [0] });

      expect((await player.delete('/api/skins/me/equip/knife?team=0')).ok()).toBe(true);
      expect(await sides()).toMatchObject({ [first]: [], [second]: [] });

      await request.put('/api/skins/admin/config', {
        headers: getAuthHeader(),
        data: { enabled: false },
      });
      await player.dispose();
    }
  );
});
