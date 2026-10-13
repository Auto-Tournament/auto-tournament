/**
 * Skins: an inventory per player, earned by winning matchmaking games and
 * placing in tournaments, shown on the platform and played in the servers:
 * the equipped loadout goes to Ready Up's skins plugin when a player
 * connects (../fleet/push/skins.ts), on every server while skins are on here.
 * A tournament in esports mode plays without them (Ready Up's `valve`
 * ruleset).
 *
 * Everything is off until an admin turns it on (`skins_config.enabled`).
 *
 * The catalogue is csm's skin export (`skin_images/skins.json`). Each skin a
 * player gets is rolled like a CS2 case: a random float (wear) and pattern
 * seed, unless a tournament reward pins them.
 */

/* global AbortController */
import { notificationService } from '../../../services/notificationService';
import { randomInt } from 'crypto';
import fetch from 'node-fetch';
import { db } from '../../../config/database';
import { log } from '../../../utils/logger';
import { emitSkinsChanged } from '../../../services/socketService';
import { WEAPON_DEFINDEX } from './skinDefindex';
import { knifeAndGlovePrices, priceFor, priceKey, rarityIndexByPrice } from './skinPrices';

export const SKIN_IMAGES_BASE =
  'https://cdn.jsdelivr.net/gh/Auto-Tournament/cs2-server-manager@master/skin_images';
export const SKINS_JSON_URL =
  'https://raw.githubusercontent.com/Auto-Tournament/cs2-server-manager/master/skin_images/skins.json';

const CONFIG_KEY = 'skins_config';
const CATALOG_TTL_MS = 60 * 60 * 1000;

export const RARITIES = [
  'common',
  'uncommon',
  'rare',
  'mythical',
  'legendary',
  'ancient',
  'immortal',
] as const;
export type Rarity = (typeof RARITIES)[number];

/** How many options a drop offers. */
export const CHOICE_COUNT = 3;

/** One option of a choice: a catalogue skin with its wear and pattern already rolled. */
export interface ChoiceOption extends CatalogSkin {
  float: number;
  pattern: number;
}

/** A drop waiting for the player to keep one option. */
export interface SkinChoice {
  id: number;
  source: OwnedSkin['source'];
  sourceLabel: string | null;
  place: number | null;
  createdAt: number;
  options: Array<
    Pick<ChoiceOption, 'weapon' | 'weaponName' | 'name' | 'rarity' | 'image' | 'float' | 'pattern'>
  >;
}

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
  if (gem)
    return (
      { ruby: 'Ruby', sapphire: 'Sapphire', blackpearl: 'Black Pearl', emerald: 'Emerald' }[
        gem[1]
      ] ?? null
    );
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

export type SmallMode = '2v2' | '1v1';

/** A finished matchmaking game counts for drops from this many rounds on (no walkover or early end). */
export const MIN_DROP_ROUNDS = 4;

/**
 * One player's drop chance (0–100) for a finished matchmaking game: the
 * mode's win or play chance, much less for every earlier game against the
 * same opponents in the last day (no farming one friend).
 */
export function matchDropChance(
  config: Pick<SkinsConfig, 'dropChance' | 'playDropChance' | 'modeChances'>,
  mode: string | null,
  won: boolean,
  repeats: number
): number {
  const small = mode === '2v2' || mode === '1v1' ? config.modeChances[mode] : null;
  const base = small
    ? won
      ? small.win
      : small.play
    : won
      ? config.dropChance
      : config.playDropChance;
  return base / Math.pow(1 + Math.max(0, repeats), 2);
}

/**
 * Whether a finished game can drop for one player: nobody abandoned it, it
 * went MIN_DROP_ROUNDS rounds, and the player played in it.
 */
export function dropEligible(game: {
  abandoned: boolean;
  maxRounds: number;
  playerRounds: number;
}): boolean {
  return !game.abandoned && game.maxRounds >= MIN_DROP_ROUNDS && game.playerRounds > 0;
}

/** The mode a game's team size plays like (a tournament has no lobby to say). */
export function modeForTeamSize(size: number | undefined): string | null {
  if (size === 1) return '1v1';
  if (size === 2) return '2v2';
  return size ? '5v5' : null;
}

export interface SkinsConfig {
  enabled: boolean;
  matchmakingDrops: boolean;
  /** Chance of a skin for each winning player, 0–100 (5v5; 2v2 and 1v1 in modeChances). */
  dropChance: number;
  /** Chance of a skin for each other player (losers, and everyone in a draw), 0–100. */
  playDropChance: number;
  /** The smaller modes drop less: a 1v1 is over in minutes. */
  modeChances: Record<SmallMode, { win: number; play: number }>;
  /** Tournament matches drop too (with the same chances), unless the tournament turns skins off. */
  tournamentMatchDrops: boolean;
  /** Every new matchmaking level is a drop to pick from. */
  levelUpDrops: boolean;
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
  modeChances: { '2v2': { win: 10, play: 3 }, '1v1': { win: 5, play: 1 } },
  tournamentMatchDrops: true,
  levelUpDrops: true,
  rarityWeights: {
    common: 40,
    uncommon: 25,
    rare: 18,
    mythical: 10,
    legendary: 5,
    ancient: 2,
    immortal: 0,
  },
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
  source: 'matchmaking' | 'tournament' | 'admin' | 'level';
  sourceLabel: string | null;
  sourceRef: string | null;
  place: number | null;
  /** A phase of a multi-phase finish ('Sapphire', 'Phase 2'), or null. */
  variant: string | null;
  createdAt: number;
  seen: boolean;
  equipped: boolean;
  /** Where it is equipped: 0 both sides, 2 T, 3 CT (empty when it is not). */
  equippedSides: LoadoutTeam[];
  /** The one side that uses this weapon, or null when both do. */
  side: 2 | 3 | null;
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

/** A loadout side: 0 both, 2 T, 3 CT (CS2's team numbers). */
export type LoadoutTeam = 0 | 2 | 3;

const T_ONLY = new Set([
  'weapon_ak47',
  'weapon_galilar',
  'weapon_glock',
  'weapon_tec9',
  'weapon_sg556',
  'weapon_g3sg1',
  'weapon_mac10',
  'weapon_sawedoff',
]);
const CT_ONLY = new Set([
  'weapon_m4a1',
  'weapon_m4a1_silencer',
  'weapon_famas',
  'weapon_usp_silencer',
  'weapon_hkp2000',
  'weapon_fiveseven',
  'weapon_aug',
  'weapon_scar20',
  'weapon_mp9',
  'weapon_mag7',
]);

/** The one side that buys a weapon (2 T, 3 CT), or null when both do (knives and gloves too). */
export function sideOf(weapon: string): 2 | 3 | null {
  if (T_ONLY.has(weapon)) return 2;
  if (CT_ONLY.has(weapon)) return 3;
  return null;
}

/** The side a skin is equipped for: a one-side weapon is always "both" (its side is the only one). */
export function equipTeam(weapon: string, wanted: unknown): LoadoutTeam {
  if (sideOf(weapon) !== null) return 0;
  return wanted === 2 || wanted === 3 ? wanted : 0;
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
export interface RarityOdds {
  rarity: Rarity;
  /** Percent of drop options that come out this rarity. */
  chance: number;
  /** How many skins share it. */
  skins: number;
  /** Percent of drop options that are one exact skin of this rarity. */
  perSkin: number;
}

/**
 * The odds a drop option has, from the rarity weights and how many skins
 * each rarity has: a rarity with no skins never comes up, so the others
 * share its weight; within a rarity every skin is as likely.
 */
export function dropOdds(
  weights: Record<Rarity, number>,
  counts: Partial<Record<Rarity, number>>
): RarityOdds[] {
  const live = RARITIES.filter((r) => (counts[r] ?? 0) > 0 && Math.max(0, weights[r] ?? 0) > 0);
  const total = live.reduce((sum, r) => sum + weights[r], 0);
  return RARITIES.map((rarity) => {
    const skins = counts[rarity] ?? 0;
    const chance = total > 0 && live.includes(rarity) ? (weights[rarity] / total) * 100 : 0;
    return { rarity, chance, skins, perSkin: skins > 0 ? chance / skins : 0 };
  });
}

export function rollRarity(weights: Record<Rarity, number>): Rarity | null {
  const entries = RARITIES.map((r) => [r, Math.max(0, weights[r] ?? 0)] as const).filter(
    ([, w]) => w > 0
  );
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

function toRow(row: SkinRow, equipped: Map<number, LoadoutTeam[]> | Set<number>): OwnedSkin {
  const sides =
    equipped instanceof Map
      ? (equipped.get(row.id) ?? [])
      : equipped.has(row.id)
        ? [0 as const]
        : [];
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
    equipped: sides.length > 0,
    equippedSides: sides,
    side: sideOf(row.weapon),
  };
}

function normalizeConfig(raw: Partial<SkinsConfig>): SkinsConfig {
  const weights = { ...DEFAULT_CONFIG.rarityWeights };
  for (const r of RARITIES) {
    const value = raw.rarityWeights?.[r];
    if (typeof value === 'number' && Number.isFinite(value))
      weights[r] = Math.max(0, Math.min(1000, value));
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
      seeds: Array.isArray(r.seeds)
        ? r.seeds.filter((s) => Number.isInteger(s) && s >= 0 && s <= 1000).slice(0, 100)
        : [],
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
    modeChances: (['2v2', '1v1'] as const).reduce(
      (out, mode) => {
        const given = raw.modeChances?.[mode];
        const pct = (v: unknown, fallback: number) =>
          typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : fallback;
        out[mode] = {
          win: pct(given?.win, DEFAULT_CONFIG.modeChances[mode].win),
          play: pct(given?.play, DEFAULT_CONFIG.modeChances[mode].play),
        };
        return out;
      },
      {} as SkinsConfig['modeChances']
    ),
    tournamentMatchDrops: raw.tournamentMatchDrops !== false,
    levelUpDrops: raw.levelUpDrops !== false,
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
  const special = skins.filter(
    (s) => slotOf(s.weapon) === 'knife' || slotOf(s.weapon) === 'gloves'
  );
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
  const row = await db.queryOneAsync<{ uid: string }>('SELECT uid FROM players WHERE id = ?', [
    steamId,
  ]);
  return row?.uid ?? null;
}

export interface LoadoutRow {
  weapon: string;
  paint_kit: number;
  float_value: number;
  pattern: number;
  slot: string;
  team: number;
}

export interface LoadoutPayload {
  paints: Array<{ team: LoadoutTeam; defindex: number; paint: number; wear: number; seed: number }>;
  knife?: Array<{ team: LoadoutTeam; defindex: number }>;
  gloves?: Array<{ team: LoadoutTeam; defindex: number }>;
}

/**
 * Equipped rows as Ready Up's `skins.loadout` items: a paint per row with its
 * side, and the knife and gloves named per side so the plugin swaps them in.
 * Null with nothing it can paint.
 */
export function loadoutPayload(rows: LoadoutRow[]): LoadoutPayload | null {
  // One row per side: the plugin uses a side's own (2 T, 3 CT) over "both" (0).
  const paints: Array<{
    team: LoadoutTeam;
    defindex: number;
    paint: number;
    wear: number;
    seed: number;
  }> = [];
  const knife: Array<{ team: LoadoutTeam; defindex: number }> = [];
  const gloves: Array<{ team: LoadoutTeam; defindex: number }> = [];
  for (const row of rows) {
    const defindex = WEAPON_DEFINDEX[row.weapon];
    if (!defindex || !row.paint_kit) continue;
    const team = ([0, 2, 3].includes(Number(row.team)) ? Number(row.team) : 0) as LoadoutTeam;
    paints.push({
      team,
      defindex,
      paint: row.paint_kit,
      wear: Math.max(0, Math.min(1, Number(row.float_value))),
      seed: Math.max(0, Math.min(1000, row.pattern)),
    });
    if (row.slot === 'knife') knife.push({ team, defindex });
    if (row.slot === 'gloves') gloves.push({ team, defindex });
  }
  if (!paints.length) return null;
  return { paints, ...(knife.length ? { knife } : {}), ...(gloves.length ? { gloves } : {}) };
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
          signal: controller.signal as unknown as NonNullable<
            Parameters<typeof fetch>[1]
          >['signal'],
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        body = (await response.json()) as { skins?: CatalogSkin[] };
      } finally {
        clearTimeout(timer);
      }
      const skins = withPriceRarity(
        (body.skins ?? []).filter(
          (s) =>
            s &&
            typeof s.weapon === 'string' &&
            RARITIES.includes(s.rarity) &&
            typeof s.image === 'string'
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

  /**
   * Gives a player one skin, rolled like a case unless the reward pins it,
   * equips it if its slot is empty (never in place of one they chose), and
   * puts it first in their profile showcase.
   */
  async grant(
    playerUid: string,
    skin: CatalogSkin,
    source: { source: OwnedSkin['source']; label?: string; ref?: string; place?: number },
    roll: {
      floatMin?: number;
      floatMax?: number;
      seeds?: number[];
      float?: number;
      pattern?: number;
    } = {}
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
        roll.float ?? rollFloat(roll.floatMin ?? 0, roll.floatMax ?? 1),
        roll.pattern ?? rollPattern(roll.seeds),
        source.source,
        source.label ?? null,
        source.ref ?? null,
        source.place ?? null,
        variantOf(skin.paintKitName),
      ]
    );
    if (row?.id) {
      // A first skin for a slot goes on, for both sides; the showcase is the player's own pick.
      await db.runAsync(
        `INSERT INTO cs2_player_loadout (player_uid, slot, skin_id, team)
         SELECT ?, ?, ?, 0 WHERE NOT EXISTS (
           SELECT 1 FROM cs2_player_loadout WHERE player_uid = ? AND slot = ?)`,
        [playerUid, slotOf(skin.weapon), row.id, playerUid, slotOf(skin.weapon)]
      );
    }
    // The reveal shows at once on any page the player has open.
    const player = await db.queryOneAsync<{ id: string }>('SELECT id FROM players WHERE uid = ?', [
      playerUid,
    ]);
    if (player) {
      emitSkinsChanged(player.id);
      if (row?.id) {
        await notificationService.notify(
          player.id,
          'skin',
          {
            skinId: row.id,
            name: skin.name,
            weapon: skin.weaponName,
            rarity: skin.rarity,
            image: skin.image,
            source: source.label ?? source.source,
          },
          `skin:${row.id}`
        );
      }
    }
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
   * A finished matchmaking or tournament game: each player who played it may
   * get a drop to pick from, with the mode's chance (winners likelier), less
   * for a repeat against the same opponents within a day. A game someone
   * abandoned, or one over before MIN_DROP_ROUNDS rounds (walkover, early
   * end), drops nothing. Never throws; a failed drop only logs.
   */
  async rollMatchDrops(
    matchSlug: string,
    winnerSteamIds: string[],
    otherSteamIds: string[],
    mapLabel?: string,
    game: { source?: 'matchmaking' | 'tournament'; teamSize?: number } = {}
  ): Promise<void> {
    try {
      const config = await this.config();
      const source = game.source ?? 'matchmaking';
      if (!config.enabled) return;
      if (source === 'matchmaking' ? !config.matchmakingDrops : !config.tournamentMatchDrops)
        return;
      const lobby = await db.queryOneAsync<{ id: string; mode: string }>(
        'SELECT id, mode FROM mm_lobbies WHERE match_slug = ?',
        [matchSlug]
      );
      const abandoned = lobby
        ? Boolean(
            await db.queryOneAsync(
              "SELECT 1 FROM mm_penalties WHERE lobby_id = ? AND kind = 'abandon' LIMIT 1",
              [lobby.id]
            )
          )
        : false;
      // Who played, and how long the game went (the stats rows are written first).
      const rounds = new Map(
        (
          await db.queryAsync<{ player_id: string; rounds_played: number | null }>(
            'SELECT player_id, rounds_played FROM player_match_stats WHERE match_slug = ?',
            [matchSlug]
          )
        ).map((r) => [r.player_id, Number(r.rounds_played ?? 0)])
      );
      const maxRounds = Math.max(0, ...rounds.values());
      if (abandoned || maxRounds < MIN_DROP_ROUNDS) return;
      const dayAgo = Math.floor(Date.now() / 1000) - 86400;
      const players = [
        ...winnerSteamIds.map((steamId) => ({ steamId, won: true, opponents: otherSteamIds })),
        ...otherSteamIds.map((steamId) => ({
          steamId,
          won: false,
          opponents: winnerSteamIds.length ? winnerSteamIds : otherSteamIds,
        })),
      ];
      for (const { steamId, won, opponents } of players) {
        const uid = await uidOf(steamId);
        if (!uid) continue;
        if (!dropEligible({ abandoned, maxRounds, playerRounds: rounds.get(steamId) ?? 0 }))
          continue;
        const others = opponents.filter((id) => id !== steamId);
        const repeats = others.length
          ? Number(
              (
                await db.queryOneAsync<{ n: number }>(
                  `SELECT COUNT(DISTINCT s.match_slug)::int AS n
                     FROM player_match_stats s
                     JOIN player_match_stats o ON o.match_slug = s.match_slug AND o.team <> s.team
                     JOIN matches m ON m.slug = s.match_slug
                    WHERE s.player_id = ? AND s.match_slug <> ? AND s.created_at > ?
                      AND (m.source = 'matchmaking' OR (m.source IS NULL AND m.round > 0))
                      AND o.player_id IN (${others.map(() => '?').join(', ')})`,
                  [steamId, matchSlug, dayAgo, ...others]
                )
              )?.n ?? 0
            )
          : 0;
        const mode = lobby?.mode ?? modeForTeamSize(game.teamSize);
        const chance = matchDropChance(config, mode, won, repeats);
        if (chance <= 0 || randomInt(0, 10000) >= chance * 100) continue;
        // A choice of three, each with its own rarity roll: the player keeps one.
        const options = await this.pickOptions(() => this.pick(null, config.rarityWeights));
        if (!options.length) continue;
        await this.offerChoice(uid, options, {
          source,
          label: mapLabel,
          ref: matchSlug,
        });
      }
    } catch (error) {
      log.warn('[Skins] Match drops failed', { matchSlug, error: (error as Error).message });
    }
  },

  /**
   * A new matchmaking level: a drop to pick from, once per level (the
   * choice's `source_ref` is `level:<n>`). Never throws.
   */
  async levelUpDrop(steamId: string, level: number): Promise<void> {
    try {
      const config = await this.config();
      if (!config.enabled || !config.levelUpDrops || level < 2) return;
      const uid = await uidOf(steamId);
      if (!uid) return;
      const ref = `level:${level}`;
      const already = await db.queryOneAsync(
        'SELECT 1 FROM cs2_skin_choices WHERE player_uid = ? AND source_ref = ? LIMIT 1',
        [uid, ref]
      );
      if (already) return;
      const options = await this.pickOptions(() => this.pick(null, config.rarityWeights));
      if (!options.length) return;
      await this.offerChoice(uid, options, { source: 'level', label: `Level ${level}`, ref });
    } catch (error) {
      log.warn('[Skins] Level-up drop failed', { steamId, level, error: (error as Error).message });
    }
  },

  /** What players may see of the drops: the odds per rarity and per skin, and when drops happen. */
  async odds() {
    const config = await this.config();
    const counts: Partial<Record<Rarity, number>> = {};
    for (const skin of await this.catalog()) counts[skin.rarity] = (counts[skin.rarity] ?? 0) + 1;
    return {
      enabled: config.enabled,
      optionsPerDrop: CHOICE_COUNT,
      rarities: dropOdds(config.rarityWeights, counts),
      matchmakingDrops: config.matchmakingDrops,
      tournamentMatchDrops: config.tournamentMatchDrops,
      levelUpDrops: config.levelUpDrops,
      chances: {
        '5v5': { win: config.dropChance, play: config.playDropChance },
        ...config.modeChances,
      },
      tournamentRewards: config.tournamentRewards
        ? config.rewards.map((r) => ({
            place: r.place,
            mode: r.mode,
            rarity: r.rarity ?? null,
            weapon: r.weapon ?? null,
            name: r.name ?? null,
          }))
        : [],
    };
  },

  /**
   * What a finished tournament's top three got: per player, the skin they
   * kept (or that their choice is still open). Placement rewards only.
   */
  async tournamentRewards(tournamentId: number): Promise<
    Array<{
      place: number;
      player: { steamId: string; name: string; avatar: string | null };
      skin: { weaponName: string; name: string; rarity: Rarity; imageUrl: string } | null;
      choosing: boolean;
    }>
  > {
    const ref = `tournament:${tournamentId}:%`;
    const choices = await db.queryAsync<{
      place: number;
      player_id: string;
      name: string;
      avatar_url: string | null;
      chosen_skin_id: number | null;
    }>(
      `SELECT c.place, p.id AS player_id, p.name, p.avatar_url, c.chosen_skin_id
         FROM cs2_skin_choices c JOIN players p ON p.uid::text = c.player_uid::text
        WHERE c.source = 'tournament' AND c.place IS NOT NULL AND c.source_ref LIKE ?`,
      [ref]
    );
    const granted = await db.queryAsync<
      SkinRow & { player_id: string; player_name: string; avatar_url: string | null }
    >(
      `SELECT s.*, p.id AS player_id, p.name AS player_name, p.avatar_url
         FROM cs2_player_skins s JOIN players p ON p.uid::text = s.player_uid::text
        WHERE s.source = 'tournament' AND s.place IS NOT NULL AND s.source_ref LIKE ?`,
      [ref]
    );
    const byId = new Map(granted.map((g) => [g.id, g]));
    const view = (g: SkinRow) => ({
      weaponName: g.weapon_name,
      name: g.variant ? `${g.name} (${g.variant})` : g.name,
      rarity: g.rarity,
      imageUrl: `${SKIN_IMAGES_BASE}/${g.image}`,
    });
    const out = choices.map((c) => {
      const kept = c.chosen_skin_id ? byId.get(c.chosen_skin_id) : undefined;
      return {
        place: Number(c.place),
        player: { steamId: c.player_id, name: c.name, avatar: c.avatar_url },
        skin: kept ? view(kept) : null,
        choosing: !c.chosen_skin_id,
      };
    });
    // Rewards given straight away (an exact skin): not from a choice.
    const fromChoices = new Set(choices.map((c) => c.chosen_skin_id).filter(Boolean));
    for (const g of granted) {
      if (fromChoices.has(g.id)) continue;
      out.push({
        place: Number(g.place),
        player: { steamId: g.player_id, name: g.player_name, avatar: g.avatar_url },
        skin: view(g),
        choosing: false,
      });
    }
    return out.sort((a, b) => a.place - b.place || a.player.name.localeCompare(b.player.name));
  },

  /** Three different catalogue skins from `roll` (fewer when the catalogue cannot give three). */
  async pickOptions(
    roll: () => Promise<CatalogSkin | null>,
    count = CHOICE_COUNT
  ): Promise<CatalogSkin[]> {
    const out: CatalogSkin[] = [];
    for (let tries = 0; out.length < count && tries < count * 6; tries++) {
      const skin = await roll();
      if (skin && !out.some((o) => o.weapon === skin.weapon && o.paintKit === skin.paintKit))
        out.push(skin);
    }
    return out;
  },

  /**
   * A drop as a choice: the options are rolled now (wear and pattern, so what
   * the player sees is what they keep) and wait in cs2_skin_choices until the
   * player keeps one (choose). The reveal shows them on any open page.
   */
  async offerChoice(
    playerUid: string,
    options: CatalogSkin[],
    source: { source: OwnedSkin['source']; label?: string; ref?: string; place?: number },
    roll: { floatMin?: number; floatMax?: number; seeds?: number[] } = {}
  ): Promise<number> {
    const rolled: ChoiceOption[] = options.map((skin) => ({
      ...skin,
      float: rollFloat(roll.floatMin ?? 0, roll.floatMax ?? 1),
      pattern: rollPattern(roll.seeds),
    }));
    const row = await db.queryOneAsync<{ id: number }>(
      `INSERT INTO cs2_skin_choices (player_uid, source, source_label, source_ref, place, options, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [
        playerUid,
        source.source,
        source.label ?? null,
        source.ref ?? null,
        source.place ?? null,
        JSON.stringify(rolled),
        Math.floor(Date.now() / 1000),
      ]
    );
    const player = await db.queryOneAsync<{ id: string }>('SELECT id FROM players WHERE uid = ?', [
      playerUid,
    ]);
    if (player && row?.id) {
      emitSkinsChanged(player.id);
      await notificationService.notify(
        player.id,
        'skin',
        {
          choiceId: row.id,
          name: rolled.map((o) => o.name).join(' · '),
          weapon: '',
          rarity: rolled[0]!.rarity,
          image: rolled[0]!.image,
          source: source.label ?? source.source,
        },
        `skin-choice:${row.id}`
      );
    }
    return row?.id ?? 0;
  },

  /** The player's choices still waiting for a pick, oldest first. */
  async openChoices(playerUid: string): Promise<SkinChoice[]> {
    const rows = await db.queryAsync<{
      id: number;
      source: OwnedSkin['source'];
      source_label: string | null;
      place: number | null;
      options: string;
      created_at: number;
    }>(
      'SELECT id, source, source_label, place, options, created_at FROM cs2_skin_choices WHERE player_uid = ? AND chosen_at IS NULL ORDER BY id',
      [playerUid]
    );
    return rows.map((r) => ({
      id: r.id,
      source: r.source,
      sourceLabel: r.source_label,
      place: r.place,
      createdAt: Number(r.created_at),
      options: (JSON.parse(r.options) as ChoiceOption[]).map((o) => ({
        weapon: o.weapon,
        weaponName: o.weaponName,
        name: o.name,
        rarity: o.rarity,
        image: o.image,
        float: o.float,
        pattern: o.pattern,
      })),
    }));
  },

  /** Keep option `index` of a waiting choice; the others are gone. The new skin's id. */
  async choose(playerUid: string, choiceId: number, index: number): Promise<number> {
    const row = await db.queryOneAsync<{
      source: OwnedSkin['source'];
      source_label: string | null;
      source_ref: string | null;
      place: number | null;
      options: string;
    }>(
      'SELECT source, source_label, source_ref, place, options FROM cs2_skin_choices WHERE id = ? AND player_uid = ? AND chosen_at IS NULL',
      [choiceId, playerUid]
    );
    if (!row) throw new SkinError(404, 'That choice is not waiting for you.');
    const options = JSON.parse(row.options) as ChoiceOption[];
    const option = options[index];
    if (!Number.isInteger(index) || !option) throw new SkinError(400, 'Pick one of the options.');
    // Claim it first: a double click keeps one skin, not two.
    const claimed = await db.runAsync(
      'UPDATE cs2_skin_choices SET chosen_at = ?, chosen_index = ? WHERE id = ? AND chosen_at IS NULL',
      [Math.floor(Date.now() / 1000), index, choiceId]
    );
    if (!claimed?.changes) throw new SkinError(409, 'That choice was already made.');
    const skinId = await this.grant(
      playerUid,
      option,
      {
        source: row.source,
        label: row.source_label ?? undefined,
        ref: row.source_ref ?? undefined,
        place: row.place ?? undefined,
      },
      { float: option.float, pattern: option.pattern }
    );
    await db.runAsync('UPDATE cs2_skin_choices SET chosen_skin_id = ? WHERE id = ?', [
      skinId,
      choiceId,
    ]);
    return skinId;
  },

  /**
   * A finished tournament: every player of the teams placed 1st, 2nd and 3rd
   * who played in it gets that place's reward. Runs once per tournament
   * (`source_ref`).
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
      const already = await db.queryOneAsync(
        'SELECT id FROM cs2_player_skins WHERE source_ref = ? LIMIT 1',
        [ref]
      );
      if (already) return;
      // Only the people who played: a roster's placeholder players and bots never join a
      // server, so they have no rounds in the tournament's matches.
      const rostered = placements.flatMap((p) => p.steamIds);
      const played = new Set(
        rostered.length
          ? (
              await db.queryAsync<{ player_id: string }>(
                `SELECT DISTINCT s.player_id FROM player_match_stats s
                   JOIN matches m ON m.slug = s.match_slug
                  WHERE m.tournament_id = ? AND COALESCE(s.rounds_played, 0) > 0
                    AND s.player_id IN (${rostered.map(() => '?').join(', ')})`,
                [tournamentId, ...rostered]
              )
            ).map((r) => r.player_id)
          : []
      );
      const catalog = await this.catalog();
      for (const { place, steamIds } of placements) {
        const reward = config.rewards.find((r) => r.place === place);
        if (!reward) continue;
        for (const steamId of steamIds) {
          if (!played.has(steamId)) continue;
          const uid = await uidOf(steamId);
          if (!uid) continue;
          let skin: CatalogSkin | null = null;
          if (reward.mode === 'skin' && reward.weapon && reward.name) {
            // One name can be several paint kits (Doppler's phases): one at random, like a case.
            const variants = catalog.filter(
              (s) => s.weapon === reward.weapon && s.name === reward.name
            );
            skin = variants.length ? variants[randomInt(0, variants.length)] : null;
          } else {
            // A rarity reward is a choice of three of that rarity: the player keeps one.
            const options = await this.pickOptions(() => this.pick(reward.rarity ?? 'rare'));
            if (options.length) {
              await this.offerChoice(
                uid,
                options,
                { source: 'tournament', label: tournamentName, ref, place },
                { floatMin: reward.floatMin, floatMax: reward.floatMax, seeds: reward.seeds }
              );
            }
            continue;
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
      log.warn('[Skins] Tournament rewards failed', {
        tournamentId,
        error: (error as Error).message,
      });
    }
  },

  async inventory(playerUid: string): Promise<OwnedSkin[]> {
    const rows = await db.queryAsync<SkinRow>(
      'SELECT * FROM cs2_player_skins WHERE player_uid = ? ORDER BY created_at DESC, id DESC',
      [playerUid]
    );
    const equipped = await db.queryAsync<{ skin_id: number; team: number }>(
      'SELECT skin_id, team FROM cs2_player_loadout WHERE player_uid = ?',
      [playerUid]
    );
    const sides = new Map<number, LoadoutTeam[]>();
    for (const e of equipped) {
      sides.set(e.skin_id, [...(sides.get(e.skin_id) ?? []), Number(e.team) as LoadoutTeam]);
    }
    return rows.map((row) => toRow(row, sides));
  },

  /**
   * Equips a skin in its slot for a side (0 both, 2 T, 3 CT), replacing what
   * that side had. "Both" also clears the slot's one-side picks. A weapon
   * only one side buys is always equipped for both.
   */
  async equip(playerUid: string, skinId: number, team: unknown = 0): Promise<void> {
    const skin = await db.queryOneAsync<SkinRow>(
      'SELECT * FROM cs2_player_skins WHERE id = ? AND player_uid = ?',
      [skinId, playerUid]
    );
    if (!skin) throw new SkinError(404, 'That skin is not in your inventory.');
    const slot = slotOf(skin.weapon);
    const side = equipTeam(skin.weapon, team);
    if (side === 0) {
      await db.runAsync(
        'DELETE FROM cs2_player_loadout WHERE player_uid = ? AND slot = ? AND team <> 0',
        [playerUid, slot]
      );
    }
    await db.runAsync(
      `INSERT INTO cs2_player_loadout (player_uid, slot, skin_id, team) VALUES (?, ?, ?, ?)
       ON CONFLICT (player_uid, slot, team) DO UPDATE SET skin_id = EXCLUDED.skin_id`,
      [playerUid, slot, skinId, side]
    );
  },

  /** Empties a slot: one side's pick (2, 3), or every side's (no team). */
  async unequip(playerUid: string, slot: string, team?: unknown): Promise<void> {
    if (team === 0 || team === 2 || team === 3) {
      await db.runAsync(
        'DELETE FROM cs2_player_loadout WHERE player_uid = ? AND slot = ? AND team = ?',
        [playerUid, slot, team]
      );
      return;
    }
    await db.runAsync('DELETE FROM cs2_player_loadout WHERE player_uid = ? AND slot = ?', [
      playerUid,
      slot,
    ]);
  },

  async markSeen(playerUid: string, ids: number[]): Promise<void> {
    if (!ids.length) return;
    await db.runAsync(
      'UPDATE cs2_player_skins SET seen = TRUE WHERE player_uid = ? AND id = ANY(?::int[])',
      [playerUid, ids]
    );
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

  /**
   * A new skin goes first in the showcase, big for a knife or gloves; the
   * showcase keeps eight, so the last one drops off. A player who never
   * arranged theirs starts from what the profile showed: their equipped
   * skins, knife and gloves first.
   */
  async addToShowcase(playerUid: string, skinId: number, slot: string): Promise<void> {
    const saved = await db.queryOneAsync<{ items: string }>(
      'SELECT items FROM cs2_player_skin_showcase WHERE player_uid = ?',
      [playerUid]
    );
    let items = await this.showcase(playerUid);
    if (!saved) {
      const equipped = (await this.inventory(playerUid)).filter(
        (s) => s.equipped && s.id !== skinId
      );
      const isBig = (s: { slot: string }) => s.slot === 'knife' || s.slot === 'gloves';
      items = [...equipped.filter(isBig), ...equipped.filter((s) => !isBig(s))].map((s) => ({
        skinId: s.id,
        big: isBig(s),
      }));
    }
    const next = [
      { skinId, big: slot === 'knife' || slot === 'gloves' },
      ...items.filter((i) => i.skinId !== skinId),
    ];
    await this.setShowcase(playerUid, next);
  },

  async setShowcase(
    playerUid: string,
    items: Array<{ skinId: number; big: boolean }>
  ): Promise<void> {
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
    paints: Array<{
      team: LoadoutTeam;
      defindex: number;
      paint: number;
      wear: number;
      seed: number;
    }>;
    knife?: Array<{ team: LoadoutTeam; defindex: number }>;
    gloves?: Array<{ team: LoadoutTeam; defindex: number }>;
  } | null> {
    if (!(await this.config()).enabled) return null;
    const uid = await uidOf(steamId);
    if (!uid) return null;
    const rows = await db.queryAsync<{
      weapon: string;
      paint_kit: number;
      float_value: number;
      pattern: number;
      slot: string;
      team: number;
    }>(
      `SELECT s.weapon, s.paint_kit, s.float_value, s.pattern, l.slot, l.team
         FROM cs2_player_loadout l JOIN cs2_player_skins s ON s.id = l.skin_id
        WHERE l.player_uid = ?`,
      [uid]
    );
    return loadoutPayload(rows);
  },

  /** Admin: the numbers at the top of the Skins page. */
  async adminStats() {
    const weekAgo = Math.floor(Date.now() / 1000) - 7 * 24 * 3600;
    const counts = await db.queryOneAsync<{
      given: number;
      week: number;
      owners: number;
      players: number;
    }>(
      `SELECT (SELECT COUNT(*)::int FROM cs2_player_skins) AS given,
              (SELECT COUNT(*)::int FROM cs2_player_skins WHERE created_at > ?) AS week,
              (SELECT COUNT(DISTINCT player_uid)::int FROM cs2_player_skins) AS owners,
              (SELECT COUNT(*)::int FROM players) AS players`,
      [weekAgo]
    );
    // The rarest skin anyone owns: highest rarity, the newest of those.
    const rarest = await db.queryOneAsync<{
      weapon_name: string;
      name: string;
      rarity: Rarity;
      image: string;
      owner: string | null;
    }>(
      `SELECT s.weapon_name, s.name, s.rarity, s.image, p.name AS owner
         FROM cs2_player_skins s
         LEFT JOIN players p ON p.uid = s.player_uid
        ORDER BY array_position(ARRAY[${RARITIES.map((r) => `'${r}'`).join(',')}]::text[], s.rarity) DESC NULLS LAST, s.created_at DESC, s.id DESC
        LIMIT 1`
    );
    return {
      given: counts?.given ?? 0,
      givenThisWeek: counts?.week ?? 0,
      playersWithSkins: counts?.owners ?? 0,
      players: counts?.players ?? 0,
      rarest: rarest
        ? {
            weaponName: rarest.weapon_name,
            name: rarest.name,
            rarity: rarest.rarity,
            imageUrl: `${SKIN_IMAGES_BASE}/${rarest.image}`,
            owner: rarest.owner,
          }
        : null,
    };
  },

  /** Admin: players by name or Steam ID, with how many skins they own. */
  async adminFindPlayers(query: string) {
    const q = query.trim();
    return db.queryAsync<{
      id: string;
      name: string;
      avatar_url: string | null;
      skins: number;
      best_weapon: string | null;
      best_name: string | null;
      best_rarity: Rarity | null;
    }>(
      `SELECT p.id, p.name, p.avatar_url,
              (SELECT COUNT(*)::int FROM cs2_player_skins s WHERE s.player_uid = p.uid) AS skins,
              best.weapon_name AS best_weapon, best.name AS best_name, best.rarity AS best_rarity
         FROM players p
         LEFT JOIN LATERAL (
           SELECT s.weapon_name, s.name, s.rarity FROM cs2_player_skins s
            WHERE s.player_uid = p.uid
            ORDER BY array_position(ARRAY[${RARITIES.map((r) => `'${r}'`).join(',')}]::text[], s.rarity) DESC NULLS LAST, s.id DESC
            LIMIT 1
         ) best ON TRUE
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
    const skin = (await this.catalog()).find(
      (s) => s.weapon === input.weapon && s.paintKit === input.paintKit
    );
    if (!skin) throw new SkinError(400, 'That skin is not in the catalogue.');
    const float =
      typeof input.float === 'number' && Number.isFinite(input.float)
        ? Math.max(0, Math.min(1, input.float))
        : null;
    const pattern =
      typeof input.pattern === 'number' &&
      Number.isInteger(input.pattern) &&
      input.pattern >= 0 &&
      input.pattern <= 1000
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
    const row = await db.queryOneAsync<{ id: number }>(
      'SELECT id FROM cs2_player_skins WHERE id = ?',
      [skinId]
    );
    if (!row) throw new SkinError(404, 'No such skin.');
    await db.runAsync('DELETE FROM cs2_player_skins WHERE id = ?', [skinId]);
  },

  /** One skin with its owner, for the inspect dialog. */
  async one(skinId: number) {
    const row = await db.queryOneAsync<
      SkinRow & { owner_id: string; owner_name: string; owner_avatar: string | null }
    >(
      `SELECT s.*, p.id AS owner_id, p.name AS owner_name, p.avatar_url AS owner_avatar
         FROM cs2_player_skins s JOIN players p ON p.uid = s.player_uid WHERE s.id = ?`,
      [skinId]
    );
    if (!row) throw new SkinError(404, 'No such skin.');
    const equipped = await db.queryOneAsync('SELECT 1 FROM cs2_player_loadout WHERE skin_id = ?', [
      skinId,
    ]);
    return {
      skin: toRow(row, new Set(equipped ? [skinId] : [])),
      owner: { steamId: row.owner_id, name: row.owner_name, avatar: row.owner_avatar },
    };
  },
};
