import { test, expect, type APIRequestContext } from '@playwright/test';
import { loadoutPayload } from '../../api/src/integrations/cs2/skins/skinService';
import { getAuthHeader, signInAsPlayerViaRequest, signInViaRequest } from '../helpers/auth';

/**
 * Catalogue unlock: with the mode on, a player equips any catalogue skin with
 * a float and seed they choose, per side like earned skins. A pick is not an
 * earned skin: never in the inventory, showcase, trade-ups or admin counts.
 * Skins come from the live catalogue, found through the admin search.
 *
 * @tag api
 */

const STEAM_ID = '76561198099990002';
const DEAGLE = 'weapon_deagle';
const AK = 'weapon_ak47';

interface Item {
  weapon: string;
  paintKit: number;
  rarity?: string;
}

test.describe.serial('Skins catalogue unlock', () => {
  let player: APIRequestContext;
  let deagle: Item[] = [];
  let ak: Item[] = [];
  let original: Record<string, unknown> = {};

  const setConfig = (request: APIRequestContext, data: Record<string, unknown>) =>
    request.put('/api/skins/admin/config', { headers: getAuthHeader(), data });
  const me = async () => (await player.get('/api/skins/me')).json();
  const put = (data: unknown) => player.put('/api/skins/me/picks', { data });
  const pickOf = (weapon: string, index: number, over: Record<string, unknown> = {}) => ({
    weapon,
    paintKit: (weapon === DEAGLE ? deagle : []).concat(ak)[index].paintKit,
    float: 0.25,
    seed: 7,
    team: 0,
    ...over,
  });
  const skinGone = async (id: number) =>
    (await player.get(`/api/skins/skin/${id}`)).status() === 404;
  /** Catalogue skins of one weapon, one row per paint kit (admin search). */
  const search = async (admin: APIRequestContext, q: string, weapon: string) =>
    (
      ((
        await (
          await admin.get(`/api/skins/admin/catalog?all=1&q=${encodeURIComponent(q)}`, {
            headers: getAuthHeader(),
          })
        ).json()
      ).skins ?? []) as Item[]
    ).filter((s) => s.weapon === weapon);

  test.beforeAll(async ({ playwright, baseURL }) => {
    const admin = await playwright.request.newContext({ baseURL });
    await signInViaRequest(admin);
    original = (
      await (await admin.get('/api/skins/admin/config', { headers: getAuthHeader() })).json()
    ).config;
    await setConfig(admin, { enabled: true, catalogUnlocked: true });
    player = await playwright.request.newContext({ baseURL });
    await signInAsPlayerViaRequest(player, STEAM_ID, 'Catalog Tester');
    deagle = await search(admin, 'desert eagle', DEAGLE);
    ak = await search(admin, 'ak-47', AK);
    await admin.dispose();
  });

  test.afterAll(async ({ playwright, baseURL }) => {
    const admin = await playwright.request.newContext({ baseURL });
    await signInViaRequest(admin);
    await setConfig(admin, original);
    await admin.dispose();
    await player.dispose();
  });

  test.beforeEach(async ({ request }) => {
    await signInViaRequest(request);
    await setConfig(request, { enabled: true, catalogUnlocked: true });
    for (const slot of [DEAGLE, AK]) await player.delete(`/api/skins/me/equip/${slot}`);
  });

  test('status reports the mode', { tag: ['@api'] }, async ({ request }) => {
    expect(await (await player.get('/api/skins/status')).json()).toMatchObject({
      enabled: true,
      catalogUnlocked: true,
    });
    await setConfig(request, { enabled: false, catalogUnlocked: true });
    expect(await (await player.get('/api/skins/status')).json()).toMatchObject({
      enabled: false,
      catalogUnlocked: false,
    });
  });

  test(
    'one PUT turns skins and the catalogue on together',
    { tag: ['@api'] },
    async ({ request }) => {
      await setConfig(request, { enabled: false, catalogUnlocked: false });
      const res = await setConfig(request, { enabled: true, catalogUnlocked: true });
      expect((await res.json()).config).toMatchObject({ enabled: true, catalogUnlocked: true });
      expect((await put(pickOf(DEAGLE, 0))).status()).toBe(200);
      await setConfig(request, { enabled: true, catalogUnlocked: false });
      expect((await put(pickOf(DEAGLE, 0))).status()).toBe(404);
    }
  );

  test('catalogue is closed while the mode is off', { tag: ['@api'] }, async ({ request }) => {
    expect(deagle.length).toBeGreaterThan(1);
    await setConfig(request, { catalogUnlocked: false });
    expect((await put(pickOf(DEAGLE, 0))).status()).toBe(404);
  });

  test('a pick equips with the chosen float and seed', { tag: ['@api'] }, async () => {
    const res = await put({ ...pickOf(DEAGLE, 0), float: 0.0123, seed: 661 });
    expect(res.status()).toBe(200);
    const { pick } = await res.json();
    expect(pick).toMatchObject({
      source: 'catalog',
      float: 0.0123,
      pattern: 661,
      stattrak: null,
      equipped: true,
      equippedSides: [0],
      slot: DEAGLE,
    });
    const body = await me();
    expect(body.inventory.some((s: { source: string }) => s.source === 'catalog')).toBe(false);
    expect(body.picks).toEqual([expect.objectContaining({ id: pick.id })]);
    const pub = await (await player.get(`/api/skins/players/${STEAM_ID}`)).json();
    expect(pub.picks).toEqual([expect.objectContaining({ id: pick.id })]);
  });

  test('picks are never StatTrak', { tag: ['@api'] }, async ({ request }) => {
    await setConfig(request, { statTrakChance: 100 });
    const { pick } = await (await put(pickOf(AK, 0))).json();
    await setConfig(request, { statTrakChance: 10 });
    expect(pick.stattrak).toBeNull();
  });

  test('one pick per side: both, then a side splits it', { tag: ['@api'] }, async () => {
    const both = (await (await put(pickOf(DEAGLE, 0))).json()).pick;
    const ct = (await (await put(pickOf(DEAGLE, 1, { team: 3 }))).json()).pick;
    let { picks } = await me();
    const sides = Object.fromEntries(
      picks.map((p: { id: number; equippedSides: number[] }) => [p.id, p.equippedSides])
    );
    expect(sides).toEqual({ [both.id]: [0], [ct.id]: [3] });

    // A T pick next to it: the both pick is shadowed on both sides.
    const t = (await (await put(pickOf(DEAGLE, 2, { team: 2 }))).json()).pick;
    expect(t.equippedSides).toEqual([2]);

    // The same side again replaces that side's pick only.
    const ct2 = (await (await put(pickOf(DEAGLE, 3, { team: 3 }))).json()).pick;
    expect(await skinGone(ct.id)).toBe(true);
    picks = (await me()).picks;
    expect(picks.map((p: { id: number }) => p.id).sort()).toEqual([both.id, t.id, ct2.id].sort());

    // A pick for both clears every side's.
    const all = (await (await put(pickOf(DEAGLE, 0, { float: 0.5 }))).json()).pick;
    expect((await me()).picks.map((p: { id: number }) => p.id)).toEqual([all.id]);
    expect(await skinGone(both.id)).toBe(true);
    expect(await skinGone(t.id)).toBe(true);
    expect(await skinGone(ct2.id)).toBe(true);
  });

  test('parallel picks on one slot and side leave one row', { tag: ['@api'] }, async () => {
    const responses = await Promise.all(
      [0, 1, 2, 3, 0, 1, 2, 3].map((i) =>
        put(pickOf(DEAGLE, i % deagle.length, { team: 3, float: 0.1 + i / 100 }))
      )
    );
    const ids: number[] = [];
    for (const res of responses) {
      expect(res.status()).toBe(200);
      ids.push((await res.json()).pick.id);
    }
    let alive = 0;
    for (const id of ids) if (!(await skinGone(id))) alive += 1;
    expect(alive).toBe(1);
    expect((await me()).picks).toHaveLength(1);
  });

  test('a one-side weapon is always picked for both', { tag: ['@api'] }, async () => {
    const { pick } = await (await put(pickOf(AK, 0, { team: 3 }))).json();
    expect(pick).toMatchObject({ side: 2, equippedSides: [0] });
  });

  test(
    'equipping an earned skin deletes the pick on that side',
    { tag: ['@api'] },
    async ({ request }) => {
      const given = await request.post(`/api/skins/admin/players/${STEAM_ID}/skins`, {
        headers: getAuthHeader(),
        data: { weapon: DEAGLE, paintKit: deagle[0].paintKit },
      });
      const { id } = await given.json();
      await player.delete(`/api/skins/me/equip/${DEAGLE}`);

      const ct = (await (await put(pickOf(DEAGLE, 1, { team: 3 }))).json()).pick;
      const t = (await (await put(pickOf(DEAGLE, 2, { team: 2 }))).json()).pick;
      await player.post('/api/skins/me/equip', { data: { skinId: id, team: 3 } });
      expect(await skinGone(ct.id)).toBe(true);
      expect((await me()).picks.map((p: { id: number }) => p.id)).toEqual([t.id]);

      await player.post('/api/skins/me/equip', { data: { skinId: id, team: 0 } });
      expect(await skinGone(t.id)).toBe(true);
      const body = await me();
      expect(body.picks).toEqual([]);
      expect(body.inventory.find((s: { id: number }) => s.id === id)).toMatchObject({
        equippedSides: [0],
      });
      await request.delete(`/api/skins/admin/skins/${id}`, { headers: getAuthHeader() });
    }
  );

  test('an earned skin never equips onto a pick id', { tag: ['@api'] }, async () => {
    const { pick } = await (await put(pickOf(DEAGLE, 0))).json();
    const res = await player.post('/api/skins/me/equip', { data: { skinId: pick.id } });
    expect(res.status()).toBe(404);
  });

  test('unequip deletes the pick on that side', { tag: ['@api'] }, async () => {
    const ct = (await (await put(pickOf(DEAGLE, 1, { team: 3 }))).json()).pick;
    const t = (await (await put(pickOf(DEAGLE, 2, { team: 2 }))).json()).pick;
    await player.delete(`/api/skins/me/equip/${DEAGLE}?team=3`);
    expect(await skinGone(ct.id)).toBe(true);
    expect((await me()).picks.map((p: { id: number }) => p.id)).toEqual([t.id]);
    await player.delete(`/api/skins/me/equip/${DEAGLE}`);
    expect(await skinGone(t.id)).toBe(true);
    expect((await me()).picks).toEqual([]);
  });

  test('taking one side off a pick for both keeps the other side', { tag: ['@api'] }, async () => {
    const { pick } = await (await put(pickOf(DEAGLE, 0))).json();
    await player.delete(`/api/skins/me/equip/${DEAGLE}?team=3`);
    let picks = (await me()).picks;
    expect(picks).toEqual([expect.objectContaining({ id: pick.id, equippedSides: [2] })]);
    await player.delete(`/api/skins/me/equip/${DEAGLE}?team=2`);
    expect((await me()).picks).toEqual([]);
    expect(await skinGone(pick.id)).toBe(true);

    // The other side has its own pick: the shared one only loses this side.
    const both = (await (await put(pickOf(DEAGLE, 0))).json()).pick;
    const t = (await (await put(pickOf(DEAGLE, 1, { team: 2 }))).json()).pick;
    await player.delete(`/api/skins/me/equip/${DEAGLE}?team=3`);
    picks = (await me()).picks;
    expect(picks.map((p: { id: number }) => p.id)).toEqual([t.id]);
    expect(await skinGone(both.id)).toBe(true);
  });

  test(
    'the server loadout carries picks only while the mode is on',
    { tag: ['@api'] },
    async ({ request }) => {
      const headers = getAuthHeader();
      const loadout = async () =>
        (await (await request.get(`/api/test/fleet/skins-loadout/${STEAM_ID}`, { headers })).json())
          .items;
      const ct = (await (await put(pickOf(DEAGLE, 0, { team: 3, float: 0.12, seed: 77 }))).json())
        .pick;
      const both = (await (await put(pickOf(AK, 0, { float: 0.34, seed: 5 }))).json()).pick;
      expect([ct.id, both.id].length).toBe(2);
      expect((await loadout()).paints).toEqual(
        expect.arrayContaining([
          { team: 3, defindex: 1, paint: deagle[0].paintKit, wear: 0.12, seed: 77 },
          { team: 0, defindex: 7, paint: ak[0].paintKit, wear: 0.34, seed: 5 },
        ])
      );
      expect(
        (await loadout()).paints.every((p: { stattrak?: number }) => p.stattrak === undefined)
      ).toBe(true);

      await setConfig(request, { catalogUnlocked: false });
      expect(await loadout()).toBeNull();

      await setConfig(request, { catalogUnlocked: true });
      expect((await loadout()).paints).toHaveLength(2);
    }
  );

  test('picks stay hidden while the mode is off', { tag: ['@api'] }, async ({ request }) => {
    const { pick } = await (await put(pickOf(DEAGLE, 0))).json();
    await setConfig(request, { catalogUnlocked: false });
    expect((await me()).picks).toEqual([]);
    expect((await (await player.get(`/api/skins/players/${STEAM_ID}`)).json()).picks).toEqual([]);
    expect((await me()).inventory.some((s: { id: number }) => s.id === pick.id)).toBe(false);
    expect(await skinGone(pick.id)).toBe(true);
    expect((await put(pickOf(DEAGLE, 1))).status()).toBe(404);
    await setConfig(request, { catalogUnlocked: true });
    expect((await me()).picks).toEqual([expect.objectContaining({ id: pick.id })]);
    expect(await skinGone(pick.id)).toBe(false);
  });

  test(
    'a stored pick with the mode off is not an owned skin and keeps its slot',
    { tag: ['@api'] },
    async ({ request }) => {
      // The state a catalogue row left by an earlier unlock is in: `source = 'catalog'`, one
      // team-0 loadout row, no skin of its own in the inventory.
      const { pick } = await (await put(pickOf(DEAGLE, 0))).json();
      await setConfig(request, { catalogUnlocked: false });
      const headers = getAuthHeader();
      const given = await request.post(`/api/skins/admin/players/${STEAM_ID}/skins`, {
        headers,
        data: { weapon: DEAGLE, paintKit: deagle[1].paintKit },
      });
      const { id } = await given.json();
      let body = await me();
      expect(body.inventory.map((s: { id: number }) => s.id)).toContain(id);
      expect(body.inventory.map((s: { id: number }) => s.id)).not.toContain(pick.id);
      // A new drop does not take the hidden pick's slot.
      expect(body.inventory.find((s: { id: number }) => s.id === id).equipped).toBe(false);
      const admin = await (
        await request.get(`/api/skins/admin/players/${STEAM_ID}/inventory`, { headers })
      ).json();
      expect(admin.inventory.map((s: { id: number }) => s.id)).not.toContain(pick.id);

      await setConfig(request, { catalogUnlocked: true });
      body = await me();
      expect(body.picks).toEqual([expect.objectContaining({ id: pick.id, equippedSides: [0] })]);
      await request.delete(`/api/skins/admin/skins/${id}`, { headers });
    }
  );

  test('bad picks are refused and store nothing', { tag: ['@api'] }, async () => {
    const good = pickOf(DEAGLE, 0, { float: 0.2, seed: 6 });
    const { pick } = await (await put(good)).json();
    const bad = [
      { ...good, float: 1.5 },
      { ...good, float: -0.1 },
      { ...good, float: 'x' },
      { ...good, float: null },
      { ...good, seed: 1001 },
      { ...good, seed: 2.5 },
      { ...good, seed: -1 },
      { ...good, paintKit: 999999 },
      { ...good, weapon: 'weapon_nonexistent' },
      { weapon: 'weapon_decoy', paintKit: 9001, float: 0.1, seed: 1, team: 0 },
    ];
    for (const data of bad) expect((await put(data)).status(), JSON.stringify(data)).toBe(400);
    expect((await me()).picks).toEqual([expect.objectContaining({ id: pick.id })]);
  });

  test('the showcase ignores picks', { tag: ['@api'] }, async () => {
    const { pick } = await (await put(pickOf(DEAGLE, 0))).json();
    await player.put('/api/skins/me/showcase', {
      data: { items: [{ skinId: pick.id, big: true }] },
    });
    expect((await me()).showcase).toEqual([]);
  });

  test('admin views leave picks out', { tag: ['@api'] }, async ({ request }) => {
    const headers = getAuthHeader();
    const stats = async () =>
      await (await request.get('/api/skins/admin/stats', { headers })).json();
    const before = await stats();
    await put(pickOf(DEAGLE, 0));
    const after = await stats();
    expect(after.given).toBe(before.given);
    expect(after.playersWithSkins).toBe(before.playersWithSkins);
    expect(after.rarest?.name).toBe(before.rarest?.name);

    const earned = (await me()).inventory.length;
    const found = await (
      await request.get('/api/skins/admin/players?q=Catalog Tester', { headers })
    ).json();
    expect(found.players.find((p: { steamId: string }) => p.steamId === STEAM_ID).skins).toBe(
      earned
    );
    const inventory = await (
      await request.get(`/api/skins/admin/players/${STEAM_ID}/inventory`, { headers })
    ).json();
    expect(inventory.inventory.some((s: { source: string }) => s.source === 'catalog')).toBe(false);
  });

  test('a pick is no trade-up input', { tag: ['@api'] }, async ({ request }) => {
    const headers = getAuthHeader();
    await setConfig(request, { tradeUp: { enabled: true, count: 3 } });
    const commons = (await search(request, 'mp9', 'weapon_mp9')).filter(
      (s) => s.rarity === 'common'
    );
    expect(commons.length).toBeGreaterThanOrEqual(2);
    const ids: number[] = [];
    for (const c of commons.slice(0, 2)) {
      const given = await request.post(`/api/skins/admin/players/${STEAM_ID}/skins`, {
        headers,
        data: { weapon: c.weapon, paintKit: c.paintKit },
      });
      ids.push((await given.json()).id);
    }
    // A common pick like the two commons it would complete the contract with.
    const common = (await search(request, 'p250', 'weapon_p250')).find(
      (s) => s.rarity === 'common'
    )!;
    const { pick } = await (
      await put({ weapon: common.weapon, paintKit: common.paintKit, float: 0.3, seed: 3, team: 0 })
    ).json();
    expect(pick.rarity).toBe('common');
    const res = await player.post('/api/skins/me/trade-up', {
      data: { skinIds: [...ids, pick.id] },
    });
    expect(res.status()).toBe(400);
    expect((await me()).picks).toEqual([expect.objectContaining({ id: pick.id })]);
    expect((await me()).inventory.filter((s: { id: number }) => ids.includes(s.id))).toHaveLength(
      2
    );
    for (const id of ids) await request.delete(`/api/skins/admin/skins/${id}`, { headers });
  });
});

test.describe('catalogue picks in the server loadout', () => {
  test('pick rows become one paint per side, never StatTrak', { tag: ['@api'] }, () => {
    const row = (weapon: string, paint_kit: number, team: number, slot = weapon) => ({
      weapon,
      paint_kit,
      float_value: 0.07,
      pattern: 3,
      slot,
      team,
      stattrak: null,
    });
    const payload = loadoutPayload([
      row('weapon_knife_karambit', 415, 3, 'knife'),
      row('weapon_deagle', 17, 2),
      row('weapon_deagle', 37, 3),
      // No definition index: the plugin cannot paint it.
      row('weapon_decoy', 9001, 0),
    ]);
    expect(payload?.paints.map((p) => [p.team, p.defindex, p.paint])).toEqual([
      [3, 507, 415],
      [2, 1, 17],
      [3, 1, 37],
    ]);
    expect(payload?.paints.some((p) => 'stattrak' in p)).toBe(false);
    expect(payload?.knife).toEqual([{ team: 3, defindex: 507 }]);
    expect(loadoutPayload([row('weapon_decoy', 9001, 0)])).toBeNull();
  });
});
