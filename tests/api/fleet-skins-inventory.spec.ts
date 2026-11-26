import { test, expect } from '@playwright/test';
import { validatePayload } from '../../api/src/integrations/cs2/fleet/protocol/v1';
import { gameImageName, inventoryItem } from '../../api/src/integrations/cs2/fleet/skinsInventory';
import type { OwnedSkin } from '../../api/src/integrations/cs2/skins/skinService';

/**
 * The in-game inventory (`.skins`): the platform's items as skins.inventory for Ready Up's HUD.
 * Pure parts: the item mapping and the game picture name; the payloads pass the protocol schemas.
 */

const owned = (over: Partial<OwnedSkin> = {}): OwnedSkin => ({
  id: 412,
  weapon: 'weapon_awp',
  weaponName: 'AWP',
  name: 'Asiimov',
  rarity: 'ancient' as OwnedSkin['rarity'],
  imageUrl: '/api/game/cs2/img/skins/weapon_awp_cu_awp_asimov_medium_png.webp',
  slot: 'awp',
  float: 0.27,
  pattern: 412,
  source: 'tournament',
  sourceLabel: 't50 MVP',
  sourceRef: null,
  place: null,
  variant: null,
  createdAt: 1,
  seen: true,
  equipped: true,
  equippedSides: [0],
  stattrak: 1204,
  side: null,
  ...over,
});

test.describe('fleet skins inventory', { tag: ['@api'] }, () => {
  test('the game picture name is the file stem, or empty', () => {
    expect(gameImageName('/api/game/cs2/img/skins/weapon_ak47_cu_ak-47_phantom_disruptor_light_png.webp')).toBe(
      'weapon_ak47_cu_ak-47_phantom_disruptor_light_png'
    );
    expect(gameImageName('/api/game/cs2/img/skins/weapon_awp_cu_awp_asimov_medium_png.webp')).toBe(
      'weapon_awp_cu_awp_asimov_medium_png'
    );
    expect(gameImageName('https://cdn.example/x/../evil name.png')).toBe('');
  });

  test('an owned skin becomes a skins.inventory item that passes the schema', () => {
    const item = inventoryItem(owned());
    expect(item).toMatchObject({
      id: 412,
      weapon: 'weapon_awp',
      weapon_name: 'AWP',
      name: 'Asiimov',
      equipped: [0],
      side: null,
      stattrak: 1204,
      image: 'weapon_awp_cu_awp_asimov_medium_png',
      source: 't50 MVP',
    });
    const ak = inventoryItem(owned({ id: 77, weapon: 'weapon_ak47', side: 2, equippedSides: [], stattrak: null, sourceLabel: null }));
    expect(ak.side).toBe(2);
    expect(ak.source).toBeUndefined();
    const payload = { steamid64: '76561198000000001', enabled: true, items: [item, ak] };
    expect(validatePayload('skins.inventory', payload)).toEqual({ ok: true, errors: [] });
    expect(validatePayload('skins.inventory_request', { steamid64: '76561198000000001' }).ok).toBe(true);
    expect(validatePayload('skins.equip', { steamid64: '76561198000000001', skin_id: 412, team: 3 }).ok).toBe(true);
    expect(validatePayload('skins.equip', { steamid64: '76561198000000001', skin_id: 412, team: 1 }).ok).toBe(false);
  });
});
