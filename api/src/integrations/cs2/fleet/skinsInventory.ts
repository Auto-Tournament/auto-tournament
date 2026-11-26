/**
 * The in-game inventory (`.skins`, Ready Up's skins plugin): a player opens their inventory on a
 * fleet server and equips from it, without leaving the game.
 *
 * - `skins.inventory_request` (server -> platform): answered with `skins.inventory`, the player's
 *   items as the website's inventory shows them, each with the game's own picture name so the HUD
 *   addon can draw it (panorama/images/econ/default_generated/<image>.vtex).
 * - `skins.equip` (server -> platform): equips (or takes off) one item, the same way the website
 *   does, then answers with a fresh `skins.inventory` and pushes the new loadout
 *   (`skins.loadout`) to wherever the player is connected.
 *
 * The server says who the player is (its fleet link is authenticated); the item must still be
 * that player's own (skinService checks it).
 */

import { log } from '../../../utils/logger';
import { skinService, SkinError, type OwnedSkin } from '../skins/skinService';
import { registerInboundHandler, type InboundContext } from './inbound';
import type {
  Envelope,
  SkinsEquipPayload,
  SkinsInventoryItem,
  SkinsInventoryPayload,
  SkinsInventoryRequestPayload,
} from './protocol/v1';

/** Requests closer together than this, per player, are dropped (the server keeps its last answer). */
const MIN_GAP_MS = 1000;
const lastRequest = new Map<string, number>();

function tooSoon(steamid64: string): boolean {
  const now = Date.now();
  const last = lastRequest.get(steamid64) ?? 0;
  if (now - last < MIN_GAP_MS) return true;
  lastRequest.set(steamid64, now);
  if (lastRequest.size > 5000) lastRequest.clear();
  return false;
}

/** `/api/game/cs2/img/skins/weapon_ak47_cu_ak47_cobra_light_png.webp` -> `weapon_ak47_cu_ak47_cobra_light_png`. */
export function gameImageName(imageUrl: string): string {
  const file = imageUrl.split('/').pop() ?? '';
  const stem = file.replace(/\.[a-z0-9]+$/i, '');
  return /^[a-z0-9_-]{1,128}$/.test(stem) ? stem : ''; // the game's own names (ak-47 has a dash)
}

/** One OwnedSkin as the HUD needs it. Pure: tested on its own. */
export function inventoryItem(s: OwnedSkin): SkinsInventoryItem {
  const item: SkinsInventoryItem = {
    id: s.id,
    weapon: s.weapon.slice(0, 64),
    weapon_name: s.weaponName.slice(0, 64),
    name: s.name.slice(0, 96),
    rarity: String(s.rarity).slice(0, 32),
    slot: s.slot.slice(0, 32),
    float: Number.isFinite(s.float) ? Math.min(1, Math.max(0, s.float)) : null,
    pattern: Number.isInteger(s.pattern) && s.pattern >= 0 ? s.pattern : null,
    stattrak: s.stattrak,
    side: s.side,
    equipped: [...new Set(s.equippedSides)],
    image: gameImageName(s.imageUrl),
  };
  if (s.sourceLabel) item.source = s.sourceLabel.slice(0, 96);
  return item;
}

async function inventoryOf(steamid64: string): Promise<SkinsInventoryPayload> {
  if (!(await skinService.config()).enabled) return { steamid64, enabled: false, error: 'Skins are off', items: [] };
  try {
    const items = (await skinService.adminInventory(steamid64)).slice(0, 1000).map(inventoryItem);
    return { steamid64, enabled: true, items };
  } catch (error) {
    if (error instanceof SkinError) return { steamid64, enabled: false, error: error.message.slice(0, 200), items: [] };
    throw error;
  }
}

async function answer(ctx: InboundContext, steamid64: string, ref: string): Promise<void> {
  const payload = await inventoryOf(steamid64);
  if (!ctx.sendEphemeral('skins.inventory', payload, { ref }))
    log.debug(`[FLEET] ${ctx.serverId}: skins.inventory not sent (socket gone)`);
}

async function onRequest(ctx: InboundContext, env: Envelope<string, SkinsInventoryRequestPayload>): Promise<void> {
  const steamid64 = env.payload.steamid64;
  if (tooSoon(steamid64)) return;
  await answer(ctx, steamid64, env.id);
}

async function onEquip(ctx: InboundContext, env: Envelope<string, SkinsEquipPayload>): Promise<void> {
  const { steamid64, skin_id: skinId, team, unequip } = env.payload;
  try {
    if (unequip) {
      const item = (await skinService.adminInventory(steamid64)).find((s) => s.id === skinId);
      if (!item) throw new SkinError(404, 'That skin is not in your inventory.');
      await skinService.adminUnequip(steamid64, item.slot, team);
    } else {
      await skinService.adminEquip(steamid64, skinId, team);
    }
    const { pushLoadoutLive } = await import('./push/skins');
    await pushLoadoutLive(steamid64);
  } catch (error) {
    if (!(error instanceof SkinError)) throw error;
    log.info(`[FLEET] ${ctx.serverId}: in-game equip refused for ${steamid64}: ${error.message}`);
  }
  lastRequest.delete(steamid64);
  await answer(ctx, steamid64, env.id);
}

let unregister: Array<() => void> = [];

export function startSkinsInventory(): void {
  if (unregister.length) return;
  unregister = [
    registerInboundHandler('skins.inventory_request', { handle: onRequest }),
    registerInboundHandler('skins.equip', { handle: onEquip }),
  ];
}

export function stopSkinsInventory(): void {
  for (const off of unregister) off();
  unregister = [];
}
