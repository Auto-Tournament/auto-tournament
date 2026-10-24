import { test, expect, type APIRequestContext } from '@playwright/test';
import { categoryOf } from '../../api/src/integrations/cs2/skins/catalogSearch';
import { WEAPON_DEFINDEX } from '../../api/src/integrations/cs2/skins/skinDefindex';
import { getAuthHeader, signInAsPlayerViaRequest, signInViaRequest } from '../helpers/auth';

/**
 * Catalogue search for players (GET /api/skins/catalog/search and
 * /catalog/weapons): open only while the catalogue unlock is on, and only
 * weapons the game plugin can paint.
 *
 * @tag api
 */

const STEAM_ID = '76561198099990005';

interface Item {
  weapon: string;
  weaponName?: string;
  paintKit: number;
  slot: string;
  side: 2 | 3 | null;
  category?: string;
}

test.describe.serial('Skins catalogue search', () => {
  let player: APIRequestContext;
  let original: Record<string, unknown> = {};

  const setConfig = (request: APIRequestContext, data: Record<string, unknown>) =>
    request.put('/api/skins/admin/config', { headers: getAuthHeader(), data });
  const search = async (query: string) =>
    ((await (await player.get(`/api/skins/catalog/search?${query}`)).json()).skins ?? []) as Item[];

  test.beforeAll(async ({ playwright, baseURL }) => {
    const admin = await playwright.request.newContext({ baseURL });
    await signInViaRequest(admin);
    original = (
      await (await admin.get('/api/skins/admin/config', { headers: getAuthHeader() })).json()
    ).config;
    await setConfig(admin, { enabled: true, catalogUnlocked: true });
    player = await playwright.request.newContext({ baseURL });
    await signInAsPlayerViaRequest(player, STEAM_ID, 'Catalog Search Tester');
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
  });

  test('the public catalogue route stays as it is', { tag: ['@api'] }, async () => {
    const res = await player.get('/api/skins/catalog');
    expect(res.status()).toBe(200);
    expect((await res.json()).skins.length).toBeGreaterThan(0);
  });

  test('closed while the mode is off', { tag: ['@api'] }, async ({ request }) => {
    await setConfig(request, { catalogUnlocked: false });
    expect((await player.get('/api/skins/catalog/search')).status()).toBe(404);
    expect((await player.get('/api/skins/catalog/weapons')).status()).toBe(404);
  });

  test('search carries the side and the slot', { tag: ['@api'] }, async () => {
    const deagle = await search('weapon=weapon_deagle');
    expect(deagle.length).toBeGreaterThan(1);
    expect(deagle.every((s) => s.weapon === 'weapon_deagle' && s.side === null)).toBe(true);
    const ak = await search('weapon=weapon_ak47');
    expect(ak.length).toBeGreaterThan(0);
    expect(ak.every((s) => s.side === 2 && s.slot === 'weapon_ak47')).toBe(true);
  });

  test('category filters on the server before the cap', { tag: ['@api'] }, async () => {
    const knives = await search('category=knives');
    expect(knives.length).toBeGreaterThan(0);
    expect(knives.every((s) => s.slot === 'knife')).toBe(true);
    const gloves = await search('category=gloves');
    expect(gloves.length).toBeGreaterThan(0);
    expect(gloves.every((s) => s.slot === 'gloves')).toBe(true);
    const pistols = await search('category=pistols');
    expect(pistols.some((s) => s.weapon === 'weapon_deagle')).toBe(true);
    expect(pistols.some((s) => s.weapon === 'weapon_ak47')).toBe(false);
  });

  test('the Zeus sits with the pistols', { tag: ['@api'] }, () => {
    expect(categoryOf('weapon_taser')).toBe('pistols');
  });

  test('weapons list covers every slot', { tag: ['@api'] }, async () => {
    const res = await player.get('/api/skins/catalog/weapons');
    expect(res.status()).toBe(200);
    const weapons = ((await res.json()).weapons ?? []) as Item[];
    const slots = weapons.map((w) => w.slot);
    expect(new Set(slots).size).toBe(slots.length);
    const by = (slot: string) => weapons.find((w) => w.slot === slot);
    expect(by('knife')).toMatchObject({ category: 'knives', weaponName: 'Knife', side: null });
    expect(by('gloves')).toMatchObject({ category: 'gloves', weaponName: 'Gloves', side: null });
    expect(by('weapon_ak47')).toMatchObject({ category: 'rifles', side: 2 });
    expect(by('weapon_deagle')).toMatchObject({ category: 'pistols', side: null });
    expect(slots.slice(0, 2)).toEqual(['knife', 'gloves']);
  });

  test('only weapons the game can paint are offered', { tag: ['@api'] }, async () => {
    const { weapons } = await (await player.get('/api/skins/catalog/weapons')).json();
    expect(weapons.length).toBeGreaterThan(5);
    for (const w of weapons as Item[]) {
      expect(WEAPON_DEFINDEX[w.weapon], w.weapon).toBeTruthy();
    }
    for (const s of await search('q=a')) expect(WEAPON_DEFINDEX[s.weapon], s.weapon).toBeTruthy();
  });
});
