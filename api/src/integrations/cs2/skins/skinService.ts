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
import {
  emitSkinsChanged,
  emitSocialChanged,
  onlinePlayerIds,
} from '../../../services/socketService';
import { WEAPON_DEFINDEX } from './skinDefindex';
import { prefetchSkinImages } from '../routes/images';
import { knifeAndGlovePrices, priceFor, priceKey, rarityIndexByPrice } from './skinPrices';
import type { Untrusted } from '../../../utils/untrusted';

/** Full-size skin pictures, served by the platform (routes/images.ts). */
export const SKIN_IMAGES_BASE = '/api/game/cs2/img/skins';
export const SKINS_JSON_URL =
  'https://raw.githubusercontent.com/Auto-Tournament/cs2-server-manager/master/skin_images/skins.json';

/** The worn looks per light image (from the catalogue), for skinImageUrl. */
const wearLooks = new Map<string, { medium?: string; heavy?: string }>();

/**
 * A skin's picture for its float: the game ships three looks per finish,
 * light (Factory New, Minimal Wear: below 0.15), medium (Field-Tested: below
 * 0.38) and heavy (Well-Worn, Battle-Scarred). Without a float, or a look the
 * catalogue lacks, the light one.
 */
/** Keep the catalogue's worn looks for skinImageUrl (the catalogue load calls it). */
export function rememberWearLooks(skins: CatalogSkin[]): void {
  wearLooks.clear();
  for (const sk of skins) {
    if (sk.imageMedium || sk.imageHeavy)
      wearLooks.set(sk.image, { medium: sk.imageMedium, heavy: sk.imageHeavy });
  }
}

export function skinImageUrl(image: string, float?: number | null): string {
  if (/^https?:\/\//.test(image)) return image;
  let file = image;
  if (typeof float === 'number' && Number.isFinite(float) && float >= 0.15) {
    const looks = wearLooks.get(image);
    file = (float >= 0.38 ? (looks?.heavy ?? looks?.medium) : looks?.medium) ?? image;
  }
  return `${SKIN_IMAGES_BASE}/${file}`;
}

/** The background fetch of every full-size skin picture runs once per process. */
let prefetchStarted = false;

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
  /** A StatTrak copy (rolled with the option, like its wear). */
  stattrak?: boolean;
}

/** A drop waiting for the player to keep one option. */
export interface SkinChoice {
  id: number;
  source: OwnedSkin['source'];
  sourceLabel: string | null;
  /** The match slug for a match drop, `level:<n>`, or the tournament prize's ref. */
  sourceRef: string | null;
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
  /** The game's worn looks (csm's export): Field-Tested, and Well-Worn / Battle-Scarred. */
  imageMedium?: string;
  imageHeavy?: string;
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

/** A tournament place with a reward: 1–4, and 0 for everyone else who played. */
export type RewardPlace = 0 | 1 | 2 | 3 | 4;
export const REWARD_PLACES: readonly RewardPlace[] = [1, 2, 3, 4, 0];
/** The `place` an MVP prize is stored with (skins and choices), apart from the placings. */
export const MVP_PLACE = 99;

export interface TournamentReward {
  /** 1 = winners, 2 = runners-up, 3 = third, 4 = fourth; 0 = everyone else who played. */
  place: RewardPlace;
  /** random: a choice of three of `rarity`; skin: that skin; none: no reward for this place. */
  mode: 'random' | 'skin' | 'none';
  /** Random mode: the rarity to draw from. */
  rarity?: Rarity;
  /** Random mode: 'one' gives one skin at random; absent, the player picks 1 of 3. */
  pick?: 'one';
  /** Skin mode: the weapon and the skin's name (Doppler covers every phase). */
  weapon?: string;
  name?: string;
  floatMin?: number;
  floatMax?: number;
  /** Pattern seeds to draw from; empty means any seed. */
  seeds?: number[];
}

export type SmallMode = '2v2' | '1v1';

/** A finished game counts for drops from this many rounds on (a walkover or a game ended this early looks like farming). */
export const MIN_DROP_ROUNDS = 8;

/**
 * The rounds a game must go to drop, for a format of `maxRounds` (MR6 is 6):
 * MIN_DROP_ROUNDS, or a short format's win count (first to 4 in MR6), since a
 * full MR6 or wingman game can end in 4 rounds (2026-10-15: MR6 never dropped).
 */
export function minDropRounds(maxRounds: number | null | undefined): number {
  if (!maxRounds || !Number.isFinite(maxRounds) || maxRounds <= 0) return MIN_DROP_ROUNDS;
  return Math.min(MIN_DROP_ROUNDS, Math.floor(maxRounds / 2) + 1);
}

/**
 * One player's drop chance (0–100) for a finished matchmaking game: the
 * mode's win or play chance. With repeatOpponentCut on, much less from the
 * third game against the same opponents in a day (no farming one friend);
 * a second game is fine (a small platform plays the same people).
 */
export function matchDropChance(
  config: Pick<SkinsConfig, 'dropChance' | 'playDropChance' | 'modeChances'> &
    Partial<Pick<SkinsConfig, 'repeatOpponentCut'>>,
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
  if (config.repeatOpponentCut === false) return base;
  return base / Math.pow(1 + Math.max(0, repeats - 1), 2);
}

/**
 * Whether a finished game can drop for one player: it went MIN_DROP_ROUNDS
 * rounds, the player played in it, and they did not leave it (the ones who
 * stayed when someone left still roll).
 */
export function dropEligible(game: {
  left: boolean;
  maxRounds: number;
  playerRounds: number;
  /** The format's max rounds (minDropRounds); absent: MIN_DROP_ROUNDS. */
  formatMaxRounds?: number | null;
}): boolean {
  return (
    !game.left && game.maxRounds >= minDropRounds(game.formatMaxRounds) && game.playerRounds > 0
  );
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
  /** Trade-up contracts: `count` skins of one grade for one of the next (tradeUpRule). */
  tradeUp: { enabled: boolean; count: number };
  /** Chance a dropped weapon or knife is StatTrak, 0–100 (CS2 cases: 10). */
  statTrakChance: number;
  /** Drops much less from the third game against the same opponents in a day (off: small platforms). */
  repeatOpponentCut: boolean;
  /** With the scaler on, keep one Skin tryout server (fleet/autoscale/tryoutKeeper.ts). Off by default: it takes a license seat. */
  tryoutServer: boolean;
}

/** A reward list as stored (site config or a tournament's own): bad entries dropped; null when not a list. */
export function parseRewards(raw: Untrusted): TournamentReward[] | null {
  if (!Array.isArray(raw)) return null;
  return (raw as Array<Partial<TournamentReward> | null>)
    .filter(
      (r): r is TournamentReward =>
        Boolean(r) && (REWARD_PLACES as readonly number[]).includes(Number(r!.place))
    )
    .map((r) => ({
      place: Number(r.place) as RewardPlace,
      mode: r.mode === 'skin' ? 'skin' : r.mode === 'none' ? 'none' : 'random',
      rarity: RARITIES.includes(r.rarity as Rarity) ? r.rarity : undefined,
      ...(r.pick === 'one' ? { pick: 'one' } : {}),
      weapon: typeof r.weapon === 'string' ? r.weapon : undefined,
      name: typeof r.name === 'string' ? r.name : undefined,
      floatMin: typeof r.floatMin === 'number' ? Math.max(0, Math.min(1, r.floatMin)) : undefined,
      floatMax: typeof r.floatMax === 'number' ? Math.max(0, Math.min(1, r.floatMax)) : undefined,
      seeds: Array.isArray(r.seeds)
        ? r.seeds.filter((x) => Number.isInteger(x) && x >= 0 && x <= 1000).slice(0, 100)
        : [],
    })) as TournamentReward[];
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
  // The best place gets the rarest grade that has skins to choose from (Immortal holds about one),
  // each place after it one grade lower, and everyone else who played something too.
  rewards: [
    { place: 1, mode: 'random', rarity: 'ancient' },
    { place: 2, mode: 'random', rarity: 'legendary' },
    { place: 3, mode: 'random', rarity: 'mythical' },
    { place: 4, mode: 'random', rarity: 'rare' },
    { place: 0, mode: 'random', rarity: 'uncommon' },
  ],
  tradeUp: { enabled: true, count: 5 },
  statTrakChance: 10,
  repeatOpponentCut: true,
  tryoutServer: false,
};

/** How many skins a trade-up may take: CS2's contract is ten; five by default here. */
export const TRADE_UP_MIN = 3;
export const TRADE_UP_MAX = 10;

/** The grade a trade-up of `rarity` gives; null for the top weapon grade and above (no contraband). */
export function nextRarity(rarity: Rarity): Rarity | null {
  const i = RARITIES.indexOf(rarity);
  // Ancient (covert) is the top a contract reaches; immortal is the one-off contraband tier.
  return i >= 0 && i < RARITIES.indexOf('ancient') ? RARITIES[i + 1] : null;
}

/** Knives and gloves are never traded up, nor given by a contract. */
export function tradeUpWeapon(weapon: string): boolean {
  const slot = slotOf(weapon);
  return slot !== 'knife' && slot !== 'gloves';
}

/**
 * Whether these skins make a trade-up contract (pure: tested on its own):
 * exactly `count` distinct skins, the player's own, all weapons (no knife or
 * gloves), all of one grade below the top. Returns the error to show, or the
 * grade they give.
 */
export function tradeUpRule(
  skins: ReadonlyArray<{ id: number; rarity: Rarity; weapon: string }>,
  requested: readonly number[],
  count: number
): { ok: true; from: Rarity; to: Rarity } | { ok: false; error: string } {
  const ids = [...new Set(requested)];
  if (ids.length !== count) return { ok: false, error: `A trade-up takes exactly ${count} skins.` };
  if (skins.length !== ids.length) return { ok: false, error: 'Those skins are not all yours.' };
  if (skins.some((s) => !tradeUpWeapon(s.weapon)))
    return { ok: false, error: 'Knives and gloves cannot be traded up.' };
  const grades = new Set(skins.map((s) => s.rarity));
  if (grades.size !== 1) return { ok: false, error: 'The skins must all be of one grade.' };
  const from = skins[0].rarity;
  const to = nextRarity(from);
  if (!to) return { ok: false, error: 'This grade is the top a trade-up reaches.' };
  return { ok: true, from, to };
}

/** The new skin's wear: the inputs' average, as in CS2. */
export function tradeUpFloat(floats: readonly number[]): number {
  if (floats.length === 0) return rollFloat();
  const avg = floats.reduce((a, b) => a + b, 0) / floats.length;
  return Math.max(0, Math.min(1, avg));
}

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
  source: 'matchmaking' | 'tournament' | 'admin' | 'level' | 'tradeup';
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
  /** A StatTrak skin's kill count; null for a plain one. */
  stattrak: number | null;
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
  stattrak?: number | null;
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
export function equipTeam(weapon: string, wanted: Untrusted): LoadoutTeam {
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
    imageUrl: skinImageUrl(row.image, Number(row.float_value)),
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
    stattrak: row.stattrak === null || row.stattrak === undefined ? null : Number(row.stattrak),
  };
}

function normalizeConfig(raw: Partial<SkinsConfig>): SkinsConfig {
  const weights = { ...DEFAULT_CONFIG.rarityWeights };
  for (const r of RARITIES) {
    const value = raw.rarityWeights?.[r];
    if (typeof value === 'number' && Number.isFinite(value))
      weights[r] = Math.max(0, Math.min(1000, value));
  }
  // A place the stored list doesn't name (4th and everyone else came later) gets the default.
  const stored = parseRewards(raw.rewards) ?? [];
  const rewards = REWARD_PLACES.map(
    (place) =>
      stored.find((r) => r.place === place) ??
      DEFAULT_CONFIG.rewards.find((r) => r.place === place)!
  );
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
        const pct = (v: Untrusted, fallback: number) =>
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
    repeatOpponentCut: raw.repeatOpponentCut !== false,
    tryoutServer: raw.tryoutServer === true,
    rarityWeights: weights,
    tournamentRewards: raw.tournamentRewards !== false,
    rewards,
    tradeUp: {
      enabled: raw.tradeUp?.enabled !== false,
      count:
        typeof raw.tradeUp?.count === 'number' && Number.isInteger(raw.tradeUp.count)
          ? Math.max(TRADE_UP_MIN, Math.min(TRADE_UP_MAX, raw.tradeUp.count))
          : DEFAULT_CONFIG.tradeUp.count,
    },
    statTrakChance:
      typeof raw.statTrakChance === 'number' && Number.isFinite(raw.statTrakChance)
        ? Math.max(0, Math.min(100, raw.statTrakChance))
        : DEFAULT_CONFIG.statTrakChance,
  };
}

/** Weapons and knives can be StatTrak in CS2; gloves (and agents, music) cannot. */
export function statTrakCapable(weapon: string): boolean {
  return slotOf(weapon) !== 'gloves';
}

/** Roll StatTrak for one dropped skin: `chance` percent, for a skin that can have it. */
export function rollStatTrak(weapon: string, chance: number): boolean {
  return statTrakCapable(weapon) && chance > 0 && randomInt(0, 10000) < chance * 100;
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

/** Who an admin drop goes to. */
export type DropTarget =
  | { kind: 'player'; id: string }
  | { kind: 'online' }
  | { kind: 'team'; id: string }
  | { kind: 'match'; id: string }
  | { kind: 'tournament'; id: string };

export interface LoadoutRow {
  /** The StatTrak count, or null for a plain skin. */
  stattrak?: number | null;
  weapon: string;
  paint_kit: number;
  float_value: number;
  pattern: number;
  slot: string;
  team: number;
}

export interface LoadoutPayload {
  paints: Array<{
    team: LoadoutTeam;
    defindex: number;
    paint: number;
    wear: number;
    seed: number;
    stattrak?: number;
  }>;
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
  const paints: LoadoutPayload['paints'] = [];
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
      ...(row.stattrak === null || row.stattrak === undefined
        ? {}
        : { stattrak: Math.max(0, Number(row.stattrak)) }),
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
          // eslint-disable-next-line no-restricted-syntax -- node-fetch 2's AbortSignal type does not overlap Node's for tsc
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
      rememberWearLooks(skins);
      if (!prefetchStarted) {
        prefetchStarted = true;
        void prefetchSkinImages(
          skins
            .flatMap((sk) => [sk.image, sk.imageMedium, sk.imageHeavy])
            .filter((f): f is string => typeof f === 'string' && !/^https?:\/\//.test(f))
        );
      }
      return skins;
    } catch (error) {
      log.warn('[Skins] Could not read the skin catalogue', { error: (error as Error).message });
      return catalogCache?.skins ?? [];
    }
  },

  /**
   * Gives a player one skin, rolled like a case unless the reward pins it. An
   * admin's gift goes on if its slot is empty (never in place of one they
   * chose); a drop, prize, level reward or trade-up only lands in the
   * inventory, and the reveal's Equip buttons put it on. (Drops went on by
   * themselves, and players at NTLAN, 2026-10-16, took the reveal's OK for the
   * button that equipped them.)
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
      /** StatTrak or not; unset rolls it with the config's chance. */
      stattrak?: boolean;
    } = {},
    /** notify: false for a skin the player just picked themselves (the reveal is the alert). */
    opts: { notify?: boolean } = {}
  ): Promise<number> {
    const stattrak =
      roll.stattrak ?? rollStatTrak(skin.weapon, (await this.config()).statTrakChance);
    const float = roll.float ?? rollFloat(roll.floatMin ?? 0, roll.floatMax ?? 1);
    const row = await db.queryOneAsync<{ id: number }>(
      `INSERT INTO cs2_player_skins
         (player_uid, weapon, weapon_name, paint_kit, name, rarity, image, float_value, pattern, source, source_label, source_ref, place, variant, stattrak)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [
        playerUid,
        skin.weapon,
        skin.weaponName,
        skin.paintKit,
        skin.name,
        skin.rarity,
        skin.image,
        float,
        roll.pattern ?? rollPattern(roll.seeds),
        source.source,
        source.label ?? null,
        source.ref ?? null,
        source.place ?? null,
        variantOf(skin.paintKitName),
        stattrak && statTrakCapable(skin.weapon) ? 0 : null,
      ]
    );
    if (row?.id && source.source === 'admin' && opts.notify !== false) {
      // An admin's gift is a first skin for a slot: on, for both sides. The showcase is the player's own pick.
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
      if (row?.id && opts.notify !== false) {
        await notificationService.notify(
          player.id,
          'skin',
          {
            skinId: row.id,
            name: skin.name,
            weapon: skin.weaponName,
            rarity: skin.rarity,
            // The full URL: the bell shows it as the notice's picture.
            image: skinImageUrl(skin.image, float),
            source: source.label ?? source.source,
            // Opens the inventory on this skin (InventoryPage reads #skin-<id>).
            url: `/inventory#skin-${row.id}`,
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
   * from the third game against the same opponents in a day. A player who
   * left the game gets nothing (the rest still roll); a game over before
   * MIN_DROP_ROUNDS rounds (walkover, early end) drops nothing. Never
   * throws; a failed drop only logs.
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
      // Who left it (a matchmaking abandon penalty): only they lose their roll.
      const leavers = new Set(
        lobby
          ? (
              await db.queryAsync<{ player_id: string }>(
                "SELECT player_id FROM mm_penalties WHERE lobby_id = ? AND kind = 'abandon'",
                [lobby.id]
              )
            ).map((r) => r.player_id)
          : []
      );
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
      const cfg = await db.queryOneAsync<{ config: string | null }>(
        'SELECT config FROM matches WHERE slug = ?',
        [matchSlug]
      );
      let formatMaxRounds: number | null = null;
      try {
        const c = cfg?.config
          ? (JSON.parse(cfg.config) as {
              maxRounds?: number;
              cvars?: { mp_maxrounds?: number | string };
            })
          : {};
        const cv = c.cvars ?? {};
        formatMaxRounds = Number(c.maxRounds ?? cv.mp_maxrounds) || null;
      } catch {
        formatMaxRounds = null;
      }
      if (maxRounds < minDropRounds(formatMaxRounds)) return;
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
        if (
          !dropEligible({
            left: leavers.has(steamId),
            maxRounds,
            playerRounds: rounds.get(steamId) ?? 0,
            formatMaxRounds,
          })
        )
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

  /**
   * Who an admin's drop goes to: one player, everyone with the site open, a
   * team's members, or a match's players. Player uids with their names.
   */
  async dropTargets(target: DropTarget): Promise<Array<{ uid: string; name: string }>> {
    let rows: Array<{ uid: string; name: string }> = [];
    if (target.kind === 'player') {
      rows = await db.queryAsync('SELECT uid, name FROM players WHERE id = ?', [target.id]);
    } else if (target.kind === 'online') {
      const ids = onlinePlayerIds();
      if (ids.length)
        rows = await db.queryAsync(
          `SELECT uid, name FROM players WHERE id IN (${ids.map(() => '?').join(', ')})`,
          ids
        );
    } else if (target.kind === 'team') {
      rows = await db.queryAsync(
        `SELECT p.uid, p.name FROM team_members m JOIN players p ON p.uid::text = m.account_uid::text
          WHERE m.team_id = ?`,
        [target.id]
      );
    } else if (target.kind === 'match') {
      const match = await db.queryOneAsync<{
        config: string | null;
        team1_id: string | null;
        team2_id: string | null;
      }>('SELECT config, team1_id, team2_id FROM matches WHERE slug = ?', [target.id]);
      if (match) {
        // The match's own lineups (bots have no account), else its teams' members.
        let steamIds: string[] = [];
        try {
          const config = JSON.parse(match.config ?? '{}') as {
            team1?: { players?: Record<string, string> };
            team2?: { players?: Record<string, string> };
          };
          steamIds = [config.team1, config.team2].flatMap((t) => Object.keys(t?.players ?? {}));
        } catch {
          steamIds = [];
        }
        if (steamIds.length) {
          rows = await db.queryAsync(
            `SELECT uid, name FROM players WHERE id IN (${steamIds.map(() => '?').join(', ')})`,
            steamIds
          );
        } else {
          const teams = [match.team1_id, match.team2_id].filter((t): t is string => !!t);
          if (teams.length)
            rows = await db.queryAsync(
              `SELECT p.uid, p.name FROM team_members m JOIN players p ON p.uid::text = m.account_uid::text
                WHERE m.team_id IN (${teams.map(() => '?').join(', ')})`,
              teams
            );
        }
      }
    } else if (target.kind === 'tournament') {
      // Everyone who took part: the lineups of its matches, and its teams' members.
      const matches = await db.queryAsync<{
        config: string | null;
        team1_id: string | null;
        team2_id: string | null;
      }>('SELECT config, team1_id, team2_id FROM matches WHERE tournament_id = ?', [
        Number(target.id),
      ]);
      const steamIds = new Set<string>();
      const teams = new Set<string>();
      for (const m of matches) {
        if (m.team1_id) teams.add(m.team1_id);
        if (m.team2_id) teams.add(m.team2_id);
        try {
          const config = JSON.parse(m.config ?? '{}') as {
            team1?: { players?: Record<string, string> };
            team2?: { players?: Record<string, string> };
          };
          for (const t of [config.team1, config.team2])
            for (const id of Object.keys(t?.players ?? {})) steamIds.add(id);
        } catch {
          // A match without a stored config: its teams' members below.
        }
      }
      const ids = [...steamIds];
      const byLineup = ids.length
        ? await db.queryAsync<{ uid: string; name: string }>(
            `SELECT uid, name FROM players WHERE id IN (${ids.map(() => '?').join(', ')})`,
            ids
          )
        : [];
      const teamIds = [...teams];
      const byTeam = teamIds.length
        ? await db.queryAsync<{ uid: string; name: string }>(
            `SELECT p.uid, p.name FROM team_members m JOIN players p ON p.uid::text = m.account_uid::text
              WHERE m.team_id IN (${teamIds.map(() => '?').join(', ')})`,
            teamIds
          )
        : [];
      rows = [...byLineup, ...byTeam];
    }
    const seen = new Set<string>();
    return rows.filter((r) => r.uid && !seen.has(String(r.uid)) && seen.add(String(r.uid)));
  },

  /**
   * An admin's drop: a choice of three for each player, queued behind any they
   * have not opened yet. Returns how many were given.
   */
  /** `rarity`: all three options of that rarity (the catalogue's own tiers); else the drop odds. */
  async adminDrop(
    uids: string[],
    label: string | null,
    rarity: Rarity | null = null
  ): Promise<number> {
    const config = await this.config();
    if (!config.enabled) throw new SkinError(404, 'Skins are off.');
    let given = 0;
    for (const uid of uids) {
      const options = await this.pickOptions(() =>
        rarity ? this.pick(rarity) : this.pick(null, config.rarityWeights)
      );
      if (!options.length) continue;
      await this.offerChoice(uid, options, { source: 'admin', label: label ?? undefined });
      given += 1;
    }
    return given;
  },

  /**
   * Ready Up's `skins.stattrak`: kills on StatTrak weapons since its last
   * report. Each goes on the player's equipped StatTrak skin of that weapon
   * (the one equipped for both sides first). Unknown players and weapons
   * without an equipped StatTrak skin are skipped.
   */
  async addStatTrakKills(
    increments: Array<{ steamid64: string; defindex: number; kills: number }>
  ): Promise<number> {
    const byDefindex = new Map<number, string[]>();
    for (const [weapon, defindex] of Object.entries(WEAPON_DEFINDEX)) {
      byDefindex.set(defindex, [...(byDefindex.get(defindex) ?? []), weapon]);
    }
    let counted = 0;
    for (const inc of increments) {
      const kills = Math.floor(Number(inc.kills));
      const weapons = byDefindex.get(Number(inc.defindex));
      if (!weapons?.length || !Number.isFinite(kills) || kills <= 0) continue;
      const uid = await uidOf(String(inc.steamid64));
      if (!uid) continue;
      const skin = await db.queryOneAsync<{ id: number }>(
        `SELECT s.id FROM cs2_player_loadout l JOIN cs2_player_skins s ON s.id = l.skin_id
          WHERE l.player_uid = ? AND s.stattrak IS NOT NULL
            AND s.weapon IN (${weapons.map(() => '?').join(', ')})
          ORDER BY l.team ASC LIMIT 1`,
        [uid, ...weapons]
      );
      if (!skin) continue;
      await db.runAsync('UPDATE cs2_player_skins SET stattrak = stattrak + ? WHERE id = ?', [
        Math.min(kills, 1000),
        skin.id,
      ]);
      counted += 1;
    }
    return counted;
  },

  /** What players may see of the drops: the odds per rarity and per skin, and when drops happen. */
  /**
   * Every skin a drop can give, for the public skin list: each finish once
   * (each Doppler phase on its own), its rarity, and its chance per drop
   * option (the rarity's chance shared by its skins). Knives and gloves carry
   * the market price that set their rarity.
   */
  async publicCatalog() {
    const config = await this.config();
    const catalog = await this.catalog();
    const counts: Partial<Record<Rarity, number>> = {};
    for (const skin of catalog) counts[skin.rarity] = (counts[skin.rarity] ?? 0) + 1;
    const perSkin = new Map(
      dropOdds(config.rarityWeights, counts).map((r) => [r.rarity, r.perSkin])
    );
    return {
      enabled: config.enabled,
      skins: catalog.map((s) => ({
        weapon: s.weapon,
        weaponName: s.weaponName,
        name: s.name,
        variant: variantOf(s.paintKitName),
        paintKit: s.paintKit,
        rarity: s.rarity,
        slot: slotOf(s.weapon),
        image: `${SKIN_IMAGES_BASE}/${s.image}`,
        price: s.price ?? null,
        chance: perSkin.get(s.rarity) ?? 0,
      })),
    };
  },

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
      repeatOpponentCut: config.repeatOpponentCut,
      chances: {
        '5v5': { win: config.dropChance, play: config.playDropChance },
        ...config.modeChances,
      },
      tournamentRewards: config.tournamentRewards
        ? config.rewards
            .filter((r) => r.mode !== 'none')
            .map((r) => ({
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
    const chance = (await this.config()).statTrakChance;
    const rolled: ChoiceOption[] = options.map((skin) => ({
      ...skin,
      float: rollFloat(roll.floatMin ?? 0, roll.floatMax ?? 1),
      pattern: rollPattern(roll.seeds),
      stattrak: rollStatTrak(skin.weapon, chance),
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
    // No bell notice: the choice opens on every page until one is kept, and the
    // kept skin then gets its own notice (with its picture).
    if (player && row?.id) emitSkinsChanged(player.id);
    return row?.id ?? 0;
  },

  /** The player's choices still waiting for a pick, oldest first. */
  async openChoices(playerUid: string): Promise<SkinChoice[]> {
    const rows = await db.queryAsync<{
      id: number;
      source: OwnedSkin['source'];
      source_label: string | null;
      source_ref: string | null;
      place: number | null;
      options: string;
      created_at: number;
    }>(
      'SELECT id, source, source_label, source_ref, place, options, created_at FROM cs2_skin_choices WHERE player_uid = ? AND chosen_at IS NULL ORDER BY id',
      [playerUid]
    );
    return rows.map((r) => ({
      id: r.id,
      source: r.source,
      sourceLabel: r.source_label,
      sourceRef: r.source_ref,
      place: r.place,
      createdAt: Number(r.created_at),
      options: (JSON.parse(r.options) as ChoiceOption[]).map((o) => ({
        weapon: o.weapon,
        weaponName: o.weaponName,
        name: o.name,
        rarity: o.rarity,
        // Stored as the catalog's file name: the browser needs the full URL.
        image: skinImageUrl(o.image, o.float),
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
      { float: option.float, pattern: option.pattern, stattrak: option.stattrak === true },
      // They picked it in the picker and see it there: no notice in the bell.
      { notify: false }
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
    placements: Array<{ place: 1 | 2 | 3 | 4; steamIds: string[] }>,
    rewardsOff = false,
    /** The tournament's own rewards (settings.cs2.rewards); absent: the site's. */
    own: TournamentReward[] | null = null
  ): Promise<void> {
    try {
      const config = await this.config();
      if (!config.enabled || !config.tournamentRewards || rewardsOff) return;
      const ref = `tournament:${tournamentId}:${tournamentName}`;
      const already = await db.queryOneAsync(
        'SELECT id FROM cs2_player_skins WHERE source_ref = ? LIMIT 1',
        [ref]
      );
      // A 3-skin choice nobody has picked from yet has no player skin: check it too.
      const offered =
        already ??
        (await db.queryOneAsync('SELECT id FROM cs2_skin_choices WHERE source_ref = ? LIMIT 1', [
          ref,
        ]));
      if (offered) return;
      // Only the people who played: a roster's placeholder players and bots never join a
      // server, so they have no rounds in the tournament's matches.
      // Everyone who played a round in it (Steam accounts: bots and placeholders never do).
      const played = new Set(
        (
          await db.queryAsync<{ player_id: string }>(
            `SELECT DISTINCT s.player_id FROM player_match_stats s
               JOIN matches m ON m.slug = s.match_slug
              WHERE m.tournament_id = ? AND COALESCE(s.rounds_played, 0) > 0`,
            [tournamentId]
          )
        )
          .map((r) => r.player_id)
          .filter((id) => /^7656\d{13}$/.test(id))
      );
      const placed = new Set(placements.flatMap((p) => p.steamIds));
      const everyoneElse = [...played].filter((id) => !placed.has(id));
      const rewards = own ?? config.rewards;
      const catalog = await this.catalog();
      for (const { place, steamIds } of [
        ...placements,
        { place: 0 as const, steamIds: everyoneElse },
      ]) {
        const reward = rewards.find((r) => r.place === place);
        if (!reward || reward.mode === 'none') continue;
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
          } else if (reward.pick === 'one') {
            // One of that rarity at random, straight into the inventory.
            skin = await this.pick(reward.rarity ?? 'rare');
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

  /**
   * The tournament's MVP prize (settings.cs2.mvp): a choice of three of the
   * rarity, or one at random. Once per tournament: a second call does nothing.
   * Returns false when it was given before (or skins are off).
   */
  async awardMvp(
    tournamentId: number,
    tournamentName: string,
    steamId: string,
    prize: { rarity: string; pick?: 'one' }
  ): Promise<boolean> {
    const config = await this.config();
    if (!config.enabled) return false;
    const ref = `tournament:${tournamentId}:${tournamentName}:mvp`;
    const given =
      (await db.queryOneAsync('SELECT id FROM cs2_player_skins WHERE source_ref = ? LIMIT 1', [
        ref,
      ])) ??
      (await db.queryOneAsync('SELECT id FROM cs2_skin_choices WHERE source_ref = ? LIMIT 1', [
        ref,
      ]));
    if (given) return false;
    const uid = await uidOf(steamId);
    if (!uid) return false;
    const rarity = (
      RARITIES.includes(prize.rarity as Rarity) ? prize.rarity : 'legendary'
    ) as Rarity;
    const source = { source: 'tournament' as const, label: tournamentName, ref, place: MVP_PLACE };
    if (prize.pick === 'one') {
      const skin = await this.pick(rarity);
      if (!skin) return false;
      await this.grant(uid, skin, source, {});
      return true;
    }
    const options = await this.pickOptions(() => this.pick(rarity));
    if (!options.length) return false;
    await this.offerChoice(uid, options, source, {});
    return true;
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
  async equip(playerUid: string, skinId: number, team: Untrusted = 0): Promise<void> {
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
  async unequip(playerUid: string, slot: string, team?: Untrusted): Promise<void> {
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
    // The reveal was the alert: its notice leaves the bell.
    const player = await db.queryOneAsync<{ id: string }>('SELECT id FROM players WHERE uid = ?', [
      playerUid,
    ]);
    if (player) {
      for (const id of ids) await notificationService.withdraw(player.id, `skin:${id}`);
      emitSocialChanged([player.id]);
    }
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
   * A new knife or gloves goes first in the showcase, any other skin third
   * (after the two the profile shows big); the showcase keeps eight, so the
   * last one drops off. A player who never
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
    // The profile shows the first two big: a knife or gloves goes first, any
    // other skin right after those two.
    const big = slot === 'knife' || slot === 'gloves';
    const rest = items.filter((i) => i.skinId !== skinId);
    const at = big ? 0 : Math.min(2, rest.length);
    const next = [...rest.slice(0, at), { skinId, big }, ...rest.slice(at)];
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
      stattrak: number | null;
    }>(
      `SELECT s.weapon, s.paint_kit, s.float_value, s.pattern, s.stattrak, l.slot, l.team
         FROM cs2_player_loadout l JOIN cs2_player_skins s ON s.id = l.skin_id
        WHERE l.player_uid = ?`,
      [uid]
    );
    return loadoutPayload(rows);
  },

  /** Admin: the numbers at the top of the Skins page. */
  /** What a trade-up of this grade can give: every weapon skin of the next one, equally likely. */
  async tradeUpOutcomes(rarity: Rarity): Promise<{ to: Rarity | null; skins: CatalogSkin[] }> {
    const to = nextRarity(rarity);
    if (!to) return { to: null, skins: [] };
    const skins = (await this.catalog()).filter((s) => s.rarity === to && tradeUpWeapon(s.weapon));
    return { to, skins };
  },

  /**
   * A trade-up contract: the player's `count` skins of one grade (equipped or
   * shown ones too: they leave the loadout and the showcase) for one random
   * weapon skin of the next grade, with their average wear. The inputs go in
   * one transaction; the new skin is granted after (a reveal and a notice).
   */
  async tradeUp(
    playerUid: string,
    skinIds: Untrusted
  ): Promise<{ skinId: number; skin: CatalogSkin }> {
    const config = await this.config();
    if (!config.tradeUp.enabled) throw new SkinError(404, 'Trade-ups are off on this site.');
    const requested = Array.isArray(skinIds)
      ? skinIds.map(Number).filter((n) => Number.isInteger(n) && n > 0)
      : [];
    const ids = [...new Set(requested)];
    const owned = ids.length
      ? await db.queryAsync<{ id: number; rarity: Rarity; weapon: string; float_value: number }>(
          `SELECT id, rarity, weapon, float_value FROM cs2_player_skins
            WHERE player_uid = ? AND id IN (${ids.map(() => '?').join(', ')})`,
          [playerUid, ...ids]
        )
      : [];
    const rule = tradeUpRule(owned, requested, config.tradeUp.count);
    if (!rule.ok) throw new SkinError(400, rule.error);
    const { skins: pool } = await this.tradeUpOutcomes(rule.from);
    if (pool.length === 0) throw new SkinError(409, 'No skin of the next grade to give.');
    const skin = pool[randomInt(0, pool.length)];
    // The inputs, all or none: a second trade-up of the same skins finds them gone.
    const floats = await db.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        const gone = await client.query<{ float_value: number }>(
          `DELETE FROM cs2_player_skins WHERE player_uid = $1 AND id = ANY($2::int[]) RETURNING float_value`,
          [playerUid, ids]
        );
        if (gone.rowCount !== ids.length) {
          await client.query('ROLLBACK');
          throw new SkinError(409, 'Those skins changed meanwhile. Try again.');
        }
        await client.query('COMMIT');
        return gone.rows.map((r) => Number(r.float_value));
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      }
    });
    // Out of the showcase too (the loadout rows went with the skins).
    const showcase = await db.queryOneAsync<{ items: string }>(
      'SELECT items FROM cs2_player_skin_showcase WHERE player_uid = ?',
      [playerUid]
    );
    if (showcase) {
      try {
        const items = (JSON.parse(showcase.items) as Array<{ skinId: number }>).filter(
          (i) => !ids.includes(Number(i.skinId))
        );
        await db.runAsync('UPDATE cs2_player_skin_showcase SET items = ? WHERE player_uid = ?', [
          JSON.stringify(items),
          playerUid,
        ]);
      } catch {
        // A showcase that does not parse is the player's to fix; the trade-up stands.
      }
    }
    const skinId = await this.grant(
      playerUid,
      skin,
      {
        source: 'tradeup',
        label: `${ids.length} × ${rule.from.charAt(0).toUpperCase()}${rule.from.slice(1)}`,
      },
      { float: tradeUpFloat(floats) }
    );
    log.info(`[SKINS] ${playerUid}: traded up ${ids.length} ${rule.from} skins for ${skin.name}`);
    return { skinId, skin };
  },

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

  /** Admin: equip one of a player's skins (by Steam ID), as the player would (team: 0 both, 2 T, 3 CT). */
  async adminEquip(steamId: string, skinId: number, team: number): Promise<string> {
    const uid = await uidOf(steamId);
    if (!uid) throw new SkinError(404, 'No such player.');
    await this.equip(uid, skinId, team);
    return uid;
  },

  /** Admin: empty a slot of a player's loadout (one side, or every side). */
  async adminUnequip(steamId: string, slot: string, team?: number): Promise<string> {
    const uid = await uidOf(steamId);
    if (!uid) throw new SkinError(404, 'No such player.');
    await this.unequip(uid, slot, team);
    return uid;
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
  /**
   * Empty a player's skins: every skin, what is equipped, the showcase, open
   * choices and the skin notices in the bell. Returns what was removed.
   */
  async adminClearInventory(
    playerUid: string,
    playerId: string
  ): Promise<{ skins: number; choices: number; notices: number }> {
    await db.runAsync('DELETE FROM cs2_player_loadout WHERE player_uid = ?', [playerUid]);
    await db.runAsync('DELETE FROM cs2_player_skin_showcase WHERE player_uid = ?', [playerUid]);
    const choices = await db.runAsync(
      'DELETE FROM cs2_skin_choices WHERE player_uid = ? AND chosen_at IS NULL',
      [playerUid]
    );
    const skins = await db.runAsync('DELETE FROM cs2_player_skins WHERE player_uid = ?', [
      playerUid,
    ]);
    const notices = await db.runAsync(
      "DELETE FROM notifications WHERE player_id = ? AND kind = 'skin'",
      [playerId]
    );
    emitSkinsChanged(playerId);
    emitSocialChanged([playerId]);
    return {
      skins: skins?.changes ?? 0,
      choices: choices?.changes ?? 0,
      notices: notices?.changes ?? 0,
    };
  },

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
