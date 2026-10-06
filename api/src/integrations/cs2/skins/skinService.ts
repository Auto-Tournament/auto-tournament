/**
 * Virtual skins: an inventory per player, earned by winning matchmaking games
 * and placing in tournaments, shown on the platform only.
 *
 * Skins never reach a game server. Valve bans the server token of a community
 * server that lets players use items they do not own, so the inventory, the
 * equipped loadout and the profile showcase live here and nowhere else. The
 * notice that says so is fixed text in the client and cannot be edited.
 *
 * Everything is off until an admin turns it on (`skins_config.enabled`).
 *
 * The catalogue is csm's skin export (`skin_images/skins.json`). Each skin a
 * player gets is rolled like a CS2 case: a random float (wear) and pattern
 * seed, unless a tournament reward pins them.
 */

/* global AbortController */
import { randomInt } from 'crypto';
import fetch from 'node-fetch';
import { db } from '../../../config/database';
import { log } from '../../../utils/logger';
import { WEAPON_DEFINDEX } from './skinDefindex';
import { knifeAndGlovePrices, priceFor, priceKey, rarityIndexByPrice } from './skinPrices';

export const SKIN_IMAGES_BASE =
  'https://cdn.jsdelivr.net/gh/Auto-Tournament/cs2-server-manager@master/skin_images';
export const SKINS_JSON_URL =
  'https://raw.githubusercontent.com/Auto-Tournament/cs2-server-manager/master/skin_images/skins.json';

const CONFIG_KEY = 'skins_config';
const CATALOG_TTL_MS = 60 * 60 * 1000;

export const RARITIES = ['common', 'uncommon', 'rare', 'mythical', 'legendary', 'ancient', 'immortal'] as const;
export type Rarity = (typeof RARITIES)[number];

export interface CatalogSkin {
  weapon: string;
  weaponName: string;
  paintKit: number;
  /** The game's paint kit name (`am_sapphire_marbleized`): tells the phases of one finish apart. */
  paintKitName?: string;
  name: string;
  rarity: Rarity;
  image: string;
  /** Knives and gloves: the finish's market price in USD (skinPrices.ts), which sets its rarity. */
  price?: number;
}

/**
 * The phase of a multi-phase finish (Doppler, Gamma Doppler) from its paint
 * kit name, as players call it: Ruby, Sapphire, Black Pearl, Emerald, Phase 1
 * to 4. Null for a finish with one look.
 */
export function variantOf(paintKitName: string | undefined): string | null {
  // am_sapphire_marbleized(_b), am_doppler_phase2(_widow), am_gamma_doppler_phase1(_glock).
  // Not "emerald" anywhere: specialist_emerald_web is a glove, an_emerald a plain finish.
  const name = (paintKitName ?? '').toLowerCase();
  const gem = /^am_(ruby|sapphire|blackpearl|emerald)_marbleized/.exec(name);
  if (gem) return { ruby: 'Ruby', sapphire: 'Sapphire', blackpearl: 'Black Pearl', emerald: 'Emerald' }[gem[1]] ?? null;
  const phase = /^am_(?:gamma_)?doppler_phase(\d)/.exec(name);
  return phase ? `Phase ${phase[1]}` : null;
}

export interface TournamentReward {
  /** 1 = winners, 2 = runners-up, 3 = third place. */
  place: 1 | 2 | 3;
  mode: 'random' | 'skin';
  /** Random mode: the rarity to draw from. */
  rarity?: Rarity;
  /** Skin mode: the weapon and the skin's name (Doppler covers every phase). */
  weapon?: string;
  name?: string;
  floatMin?: number;
  floatMax?: number;
  /** Pattern seeds to draw from; empty means any seed. */
  seeds?: number[];
}

export interface SkinsConfig {
  enabled: boolean;
  matchmakingDrops: boolean;
  /** Chance of a skin for each winning player, 0–100. */
  dropChance: number;
  /** Chance of a skin for each other player (losers, and everyone in a draw), 0–100. */
  playDropChance: number;
  /** Relative weight per rarity for random drops. */
  rarityWeights: Record<Rarity, number>;
  tournamentRewards: boolean;
  rewards: TournamentReward[];
}

export const DEFAULT_CONFIG: SkinsConfig = {
  enabled: false,
  matchmakingDrops: true,
  dropChance: 20,
  playDropChance: 5,
  rarityWeights: { common: 40, uncommon: 25, rare: 18, mythical: 10, legendary: 5, ancient: 2, immortal: 0 },
  tournamentRewards: true,
  rewards: [
    { place: 1, mode: 'random', rarity: 'legendary' },
    { place: 2, mode: 'random', rarity: 'mythical' },
    { place: 3, mode: 'random', rarity: 'rare' },
  ],
};

export class SkinError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

export interface OwnedSkin {
  id: number;
  weapon: string;
  weaponName: string;
  name: string;
  rarity: Rarity;
  imageUrl: string;
  slot: string;
  float: number;
  pattern: number;
  source: 'matchmaking' | 'tournament' | 'admin';
  sourceLabel: string | null;
  sourceRef: string | null;
  place: number | null;
  /** A phase of a multi-phase finish ('Sapphire', 'Phase 2'), or null. */
  variant: string | null;
  createdAt: number;
  seen: boolean;
  equipped: boolean;
}

interface SkinRow {
  id: number;
  player_uid: string;
  weapon: string;
  weapon_name: string;
  name: string;
  rarity: Rarity;
  image: string;
  float_value: number;
  pattern: number;
  source: OwnedSkin['source'];
  source_label: string | null;
  source_ref: string | null;
  place: number | null;
  variant: string | null;
  created_at: number;
  seen: boolean;
}

/** The loadout slot a weapon fills: every knife shares one, every glove one. */
export function slotOf(weapon: string): string {
  if (weapon.startsWith('weapon_knife') || weapon === 'weapon_bayonet') return 'knife';
  if (weapon.includes('gloves') || weapon.includes('handwraps')) return 'gloves';
  return weapon;
}

/** A float in [min, max], rounded to six places like the game shows. */
export function rollFloat(min = 0, max = 1): number {
  const lo = Math.max(0, Math.min(min, max));
  const hi = Math.min(1, Math.max(min, max));
  const value = lo + (randomInt(0, 1_000_000) / 1_000_000) * (hi - lo);
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function rollPattern(seeds?: number[]): number {
  const pool = (seeds ?? []).filter((s) => Number.isInteger(s) && s >= 0 && s <= 1000);
  return pool.length ? pool[randomInt(0, pool.length)] : randomInt(0, 1001);
}

/** A rarity drawn by weight; null when every weight is zero. */
export function rollRarity(weights: Record<Rarity, number>): Rarity | null {
  const entries = RARITIES.map((r) => [r, Math.max(0, weights[r] ?? 0)] as const).filter(([, w]) => w > 0);
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  if (total <= 0) return null;
  let pick = randomInt(0, Math.round(total * 1000)) / 1000;
  for (const [rarity, weight] of entries) {
    if (pick < weight) return rarity;
    pick -= weight;
  }
  return entries[entries.length - 1][0];
}

let catalogCache: { at: number; skins: CatalogSkin[] } | null = null;

function toRow(row: SkinRow, equipped: Set<number>): OwnedSkin {
  return {
    id: row.id,
    weapon: row.weapon,
    weaponName: row.weapon_name,
    name: row.variant ? `${row.name} (${row.variant})` : row.name,
    rarity: row.rarity,
    imageUrl: `${SKIN_IMAGES_BASE}/${row.image}`,
    slot: slotOf(row.weapon),
    float: Number(row.float_value),
    pattern: row.pattern,
    source: row.source,
    sourceLabel: row.source_label,
    sourceRef: row.source_ref,
    place: row.place,
    variant: row.variant ?? null,
    createdAt: row.created_at,
    seen: Boolean(row.seen),
    equipped: equipped.has(row.id),
  };
}

function normalizeConfig(raw: Partial<SkinsConfig>): SkinsConfig {
  const weights = { ...DEFAULT_CONFIG.rarityWeights };
  for (const r of RARITIES) {
    const value = raw.rarityWeights?.[r];
    if (typeof value === 'number' && Number.isFinite(value)) weights[r] = Math.max(0, Math.min(1000, value));
  }
  const rewards = (Array.isArray(raw.rewards) ? raw.rewards : DEFAULT_CONFIG.rewards)
    .filter((r): r is TournamentReward => Boolean(r) && [1, 2, 3].includes(Number(r.place)))
    .map((r) => ({
      place: Number(r.place) as 1 | 2 | 3,
      mode: r.mode === 'skin' ? 'skin' : 'random',
      rarity: RARITIES.includes(r.rarity as Rarity) ? r.rarity : undefined,
      weapon: typeof r.weapon === 'string' ? r.weapon : undefined,
      name: typeof r.name === 'string' ? r.name : undefined,
      floatMin: typeof r.floatMin === 'number' ? Math.max(0, Math.min(1, r.floatMin)) : undefined,
      floatMax: typeof r.floatMax === 'number' ? Math.max(0, Math.min(1, r.floatMax)) : undefined,
      seeds: Array.isArray(r.seeds) ? r.seeds.filter((s) => Number.isInteger(s) && s >= 0 && s <= 1000).slice(0, 100) : [],
    })) as TournamentReward[];
  return {
    enabled: raw.enabled === true,
    matchmakingDrops: raw.matchmakingDrops !== false,
    dropChance:
      typeof raw.dropChance === 'number' && Number.isFinite(raw.dropChance)
        ? Math.max(0, Math.min(100, raw.dropChance))
        : DEFAULT_CONFIG.dropChance,
    playDropChance:
      typeof raw.playDropChance === 'number' && Number.isFinite(raw.playDropChance)
        ? Math.max(0, Math.min(100, raw.playDropChance))
        : DEFAULT_CONFIG.playDropChance,
    rarityWeights: weights,
    tournamentRewards: raw.tournamentRewards !== false,
    rewards,
  };
}

/**
 * Knives and gloves take their rarity from their price, not their paint kit:
 * cheap finishes are common, the dearest ancient (immortal stays the one-off
 * contraband tier). A finish Skinport has no price for keeps the catalogue's.
 */
function withPriceRarity(skins: CatalogSkin[], prices: Record<string, number>): CatalogSkin[] {
  if (Object.keys(prices).length === 0) return skins;
  const keyOf = (s: CatalogSkin) => priceKey(s.weaponName, s.name, variantOf(s.paintKitName));
  const special = skins.filter((s) => slotOf(s.weapon) === 'knife' || slotOf(s.weapon) === 'gloves');
  const bands = RARITIES.indexOf('ancient') + 1;
  const index = rarityIndexByPrice(prices, special.map(keyOf), bands);
  return skins.map((s) => {
    const slot = slotOf(s.weapon);
    if (slot !== 'knife' && slot !== 'gloves') return s;
    const key = keyOf(s);
    const band = index.get(key);
    return band === undefined ? s : { ...s, rarity: RARITIES[band], price: priceFor(prices, key) };

  });
}

async function uidOf(steamId: string): Promise<string | null> {
  const row = await db.queryOneAsync<{ uid: string }>('SELECT uid FROM players WHERE id = ?', [steamId]);
  return row?.uid ?? null;
}

export const skinService = {
  async config(): Promise<SkinsConfig> {
    const raw = await db.getAppSettingAsync(CONFIG_KEY).catch(() => null);
    if (!raw) return { ...DEFAULT_CONFIG };
    try {
      return normalizeConfig(JSON.parse(raw) as Partial<SkinsConfig>);
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  },

  async setConfig(input: Partial<SkinsConfig>): Promise<SkinsConfig> {
    const next = normalizeConfig({ ...(await this.config()), ...input });
    await db.setAppSettingAsync(CONFIG_KEY, JSON.stringify(next));
    return next;
  },

  /** csm's skin catalogue, cached for an hour. Empty when it cannot be read. */
  async catalog(): Promise<CatalogSkin[]> {
    if (catalogCache && Date.now() - catalogCache.at < CATALOG_TTL_MS) return catalogCache.skins;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      let body: { skins?: CatalogSkin[] };
      try {
        const response = await fetch(SKINS_JSON_URL, {
          // node-fetch 2 declares its own AbortSignal type; Node's has the same shape.
          signal: controller.signal as unknown as NonNullable<Parameters<typeof fetch>[1]>['signal'],
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        body = (await response.json()) as { skins?: CatalogSkin[] };
      } finally {
        clearTimeout(timer);
      }
      const skins = withPriceRarity(
        (body.skins ?? []).filter(
          (s) => s && typeof s.weapon === 'string' && RARITIES.includes(s.rarity) && typeof s.image === 'string'
        ),
        await knifeAndGlovePrices()
      );
      catalogCache = { at: Date.now(), skins };
      return skins;
    } catch (error) {
      log.warn('[Skins] Could not read the skin catalogue', { error: (error as Error).message });
      return catalogCache?.skins ?? [];
    }
  },

  /** Gives a player one skin, rolled like a case unless the reward pins it. */
  async grant(
    playerUid: string,
    skin: CatalogSkin,
    source: { source: OwnedSkin['source']; label?: string; ref?: string; place?: number },
    roll: { floatMin?: number; floatMax?: number; seeds?: number[] } = {}
  ): Promise<number> {
    const row = await db.queryOneAsync<{ id: number }>(
      `INSERT INTO cs2_player_skins
         (player_uid, weapon, weapon_name, paint_kit, name, rarity, image, float_value, pattern, source, source_label, source_ref, place, variant)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [
        playerUid,
        skin.weapon,
        skin.weaponName,
        skin.paintKit,
        skin.name,
        skin.rarity,
        skin.image,
        rollFloat(roll.floatMin ?? 0, roll.floatMax ?? 1),
        rollPattern(roll.seeds),
        source.source,
        source.label ?? null,
        source.ref ?? null,
        source.place ?? null,
        variantOf(skin.paintKitName),
      ]
    );
    return row?.id ?? 0;
  },

  /** A random catalogue skin of the rarity, or of a rarity drawn by weight. */
  async pick(rarity: Rarity | null, weights?: Record<Rarity, number>): Promise<CatalogSkin | null> {
    const catalog = await this.catalog();
    const wanted = rarity ?? (weights ? rollRarity(weights) : null);
    const pool = catalog.filter((s) => s.rarity === wanted);
    return pool.length ? pool[randomInt(0, pool.length)] : null;
  },

  /**
   * A finished matchmaking game: each winner gets a skin with the winners'
   * chance, everyone else with the chance for playing. Never throws; a failed
   * drop only logs.
   */
  async rollMatchDrops(
    matchSlug: string,
    winnerSteamIds: string[],
    otherSteamIds: string[],
    mapLabel?: string
  ): Promise<void> {
    try {
      const config = await this.config();
      if (!config.enabled || !config.matchmakingDrops) return;
      const players = [
        ...winnerSteamIds.map((steamId) => ({ steamId, chance: config.dropChance })),
        ...otherSteamIds.map((steamId) => ({ steamId, chance: config.playDropChance })),
      ];
      for (const { steamId, chance } of players) {
        if (chance <= 0 || randomInt(0, 10000) >= chance * 100) continue;
        const uid = await uidOf(steamId);
        if (!uid) continue;
        const skin = await this.pick(null, config.rarityWeights);
        if (!skin) continue;
        await this.grant(uid, skin, { source: 'matchmaking', label: mapLabel, ref: matchSlug });
      }
    } catch (error) {
      log.warn('[Skins] Match drops failed', { matchSlug, error: (error as Error).message });
    }
  },

  /**
   * A finished tournament: every player of the teams placed 1st, 2nd and 3rd
   * gets that place's reward. Runs once per tournament (`source_ref`).
   */
  async awardTournament(
    tournamentId: number,
    tournamentName: string,
    placements: Array<{ place: 1 | 2 | 3; steamIds: string[] }>,
    rewardsOff = false
  ): Promise<void> {
    try {
      const config = await this.config();
      if (!config.enabled || !config.tournamentRewards || rewardsOff) return;
      const ref = `tournament:${tournamentId}:${tournamentName}`;
      const already = await db.queryOneAsync('SELECT id FROM cs2_player_skins WHERE source_ref = ? LIMIT 1', [ref]);
      if (already) return;
      const catalog = await this.catalog();
      for (const { place, steamIds } of placements) {
        const reward = config.rewards.find((r) => r.place === place);
        if (!reward) continue;
        for (const steamId of steamIds) {
          const uid = await uidOf(steamId);
          if (!uid) continue;
          let skin: CatalogSkin | null = null;
          if (reward.mode === 'skin' && reward.weapon && reward.name) {
            // One name can be several paint kits (Doppler's phases): one at random, like a case.
            const variants = catalog.filter((s) => s.weapon === reward.weapon && s.name === reward.name);
            skin = variants.length ? variants[randomInt(0, variants.length)] : null;
          } else {
            skin = await this.pick(reward.rarity ?? 'rare');
          }
          if (!skin) continue;
          await this.grant(
            uid,
            skin,
            { source: 'tournament', label: tournamentName, ref, place },
            { floatMin: reward.floatMin, floatMax: reward.floatMax, seeds: reward.seeds }
          );
        }
      }
    } catch (error) {
      log.warn('[Skins] Tournament rewards failed', { tournamentId, error: (error as Error).message });
    }
  },

  async inventory(playerUid: string): Promise<OwnedSkin[]> {
    const rows = await db.queryAsync<SkinRow>(
      'SELECT * FROM cs2_player_skins WHERE player_uid = ? ORDER BY created_at DESC, id DESC',
      [playerUid]
    );
    const equipped = await db.queryAsync<{ skin_id: number }>(
      'SELECT skin_id FROM cs2_player_loadout WHERE player_uid = ?',
      [playerUid]
    );
    const set = new Set(equipped.map((e) => e.skin_id));
    return rows.map((row) => toRow(row, set));
  },

  /** Equips a skin in its slot, replacing what was there. */
  async equip(playerUid: string, skinId: number): Promise<void> {
    const skin = await db.queryOneAsync<SkinRow>('SELECT * FROM cs2_player_skins WHERE id = ? AND player_uid = ?', [
      skinId,
      playerUid,
    ]);
    if (!skin) throw new SkinError(404, 'That skin is not in your inventory.');
    await db.runAsync(
      `INSERT INTO cs2_player_loadout (player_uid, slot, skin_id) VALUES (?, ?, ?)
       ON CONFLICT (player_uid, slot) DO UPDATE SET skin_id = EXCLUDED.skin_id`,
      [playerUid, slotOf(skin.weapon), skinId]
    );
  },

  async unequip(playerUid: string, slot: string): Promise<void> {
    await db.runAsync('DELETE FROM cs2_player_loadout WHERE player_uid = ? AND slot = ?', [playerUid, slot]);
  },

  async markSeen(playerUid: string, ids: number[]): Promise<void> {
    if (!ids.length) return;
    await db.runAsync('UPDATE cs2_player_skins SET seen = TRUE WHERE player_uid = ? AND id = ANY(?::int[])', [
      playerUid,
      ids,
    ]);
  },

  /** The profile showcase: up to eight equipped skins in the owner's order, some big. */
  async showcase(playerUid: string): Promise<Array<{ skinId: number; big: boolean }>> {
    const row = await db.queryOneAsync<{ items: string }>(
      'SELECT items FROM cs2_player_skin_showcase WHERE player_uid = ?',
      [playerUid]
    );
    try {
      const items = row ? (JSON.parse(row.items) as Array<{ skinId: number; big: boolean }>) : [];
      return Array.isArray(items) ? items.slice(0, 8) : [];
    } catch {
      return [];
    }
  },

  async setShowcase(playerUid: string, items: Array<{ skinId: number; big: boolean }>): Promise<void> {
    const owned = new Set((await this.inventory(playerUid)).map((s) => s.id));
    const clean = items
      .filter((i) => owned.has(Number(i.skinId)))
      .slice(0, 8)
      .map((i) => ({ skinId: Number(i.skinId), big: Boolean(i.big) }));
    await db.runAsync(
      `INSERT INTO cs2_player_skin_showcase (player_uid, items) VALUES (?, ?)
       ON CONFLICT (player_uid) DO UPDATE SET items = EXCLUDED.items`,
      [playerUid, JSON.stringify(clean)]
    );
  },

  /** A player's skins for their public profile: inventory, loadout and showcase. */
  async publicProfile(steamId: string) {
    const uid = await uidOf(steamId);
    if (!uid) return null;
    const inventory = await this.inventory(uid);
    return { inventory, showcase: await this.showcase(uid) };
  },

  /**
   * A player's equipped skins as Ready Up's `skins.loadout` items: a paint
   * per equipped weapon, knife and gloves (with the knife and gloves also
   * named, so the plugin swaps them in). Null without an account, while skins
   * are off, or with nothing equipped.
   */
  async loadoutItems(steamId: string): Promise<{
    paints: Array<{ team: 0; defindex: number; paint: number; wear: number; seed: number }>;
    knife?: Array<{ team: 0; defindex: number }>;
    gloves?: Array<{ team: 0; defindex: number }>;
  } | null> {
    if (!(await this.config()).enabled) return null;
    const uid = await uidOf(steamId);
    if (!uid) return null;
    const rows = await db.queryAsync<{ weapon: string; paint_kit: number; float_value: number; pattern: number; slot: string }>(
      `SELECT s.weapon, s.paint_kit, s.float_value, s.pattern, l.slot
         FROM cs2_player_loadout l JOIN cs2_player_skins s ON s.id = l.skin_id
        WHERE l.player_uid = ?`,
      [uid]
    );
    const paints: Array<{ team: 0; defindex: number; paint: number; wear: number; seed: number }> = [];
    let knife: Array<{ team: 0; defindex: number }> | undefined;
    let gloves: Array<{ team: 0; defindex: number }> | undefined;
    for (const row of rows) {
      const defindex = WEAPON_DEFINDEX[row.weapon];
      if (!defindex || !row.paint_kit) continue;
      paints.push({
        team: 0,
        defindex,
        paint: row.paint_kit,
        wear: Math.max(0, Math.min(1, Number(row.float_value))),
        seed: Math.max(0, Math.min(1000, row.pattern)),
      });
      if (row.slot === 'knife') knife = [{ team: 0, defindex }];
      if (row.slot === 'gloves') gloves = [{ team: 0, defindex }];
    }
    if (!paints.length) return null;
    return { paints, ...(knife ? { knife } : {}), ...(gloves ? { gloves } : {}) };
  },

  /** Admin: players by name or Steam ID, with how many skins they own. */
  async adminFindPlayers(query: string) {
    const q = query.trim();
    return db.queryAsync<{ id: string; name: string; avatar_url: string | null; skins: number }>(
      `SELECT p.id, p.name, p.avatar_url,
              (SELECT COUNT(*)::int FROM cs2_player_skins s WHERE s.player_uid = p.uid) AS skins
         FROM players p
        WHERE (? = '' OR p.name ILIKE ? OR p.id = ?)
        ORDER BY skins DESC, p.name
        LIMIT 30`,
      [q, `%${q}%`, q]
    );
  },

  /** Admin: a player's whole inventory. */
  async adminInventory(steamId: string): Promise<OwnedSkin[]> {
    const uid = await uidOf(steamId);
    if (!uid) throw new SkinError(404, 'No such player.');
    return this.inventory(uid);
  },

  /** Admin: give a player one exact skin (a paint kit), with the float and pattern given or rolled. */
  async adminGive(
    steamId: string,
    input: { weapon: string; paintKit: number; float?: number | null; pattern?: number | null },
    adminLabel?: string
  ): Promise<number> {
    const uid = await uidOf(steamId);
    if (!uid) throw new SkinError(404, 'No such player.');
    const skin = (await this.catalog()).find((s) => s.weapon === input.weapon && s.paintKit === input.paintKit);
    if (!skin) throw new SkinError(400, 'That skin is not in the catalogue.');
    const float =
      typeof input.float === 'number' && Number.isFinite(input.float) ? Math.max(0, Math.min(1, input.float)) : null;
    const pattern =
      typeof input.pattern === 'number' && Number.isInteger(input.pattern) && input.pattern >= 0 && input.pattern <= 1000
        ? input.pattern
        : null;
    return this.grant(
      uid,
      skin,
      { source: 'admin', label: adminLabel },
      { floatMin: float ?? 0, floatMax: float ?? 1, seeds: pattern !== null ? [pattern] : [] }
    );
  },

  /** Admin: take a skin away (it leaves the loadout and the showcase with it). */
  async adminRemove(skinId: number): Promise<void> {
    const row = await db.queryOneAsync<{ id: number }>('SELECT id FROM cs2_player_skins WHERE id = ?', [skinId]);
    if (!row) throw new SkinError(404, 'No such skin.');
    await db.runAsync('DELETE FROM cs2_player_skins WHERE id = ?', [skinId]);
  },

  /** One skin with its owner, for the inspect dialog. */
  async one(skinId: number) {
    const row = await db.queryOneAsync<SkinRow & { owner_id: string; owner_name: string; owner_avatar: string | null }>(
      `SELECT s.*, p.id AS owner_id, p.name AS owner_name, p.avatar_url AS owner_avatar
         FROM cs2_player_skins s JOIN players p ON p.uid = s.player_uid WHERE s.id = ?`,
      [skinId]
    );
    if (!row) throw new SkinError(404, 'No such skin.');
    const equipped = await db.queryOneAsync('SELECT 1 FROM cs2_player_loadout WHERE skin_id = ?', [skinId]);
    return {
      skin: toRow(row, new Set(equipped ? [skinId] : [])),
      owner: { steamId: row.owner_id, name: row.owner_name, avatar: row.owner_avatar },
    };
  },
};
