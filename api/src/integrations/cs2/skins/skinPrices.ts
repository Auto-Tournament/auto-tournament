/* global AbortController */
/**
 * Market prices for every skin, per finish and wear, from Skinport's public
 * API (no key, https://docs.skinport.com/items). A skin's rarity is the price
 * band of its finish and wear (PRICE_BANDS): a Battle-Scarred glove can be
 * worth less than a Factory New rifle, and its rarity says so.
 *
 * One request returns every CS2 item (about 37,000 rows, ~1 MB brotli). We
 * keep each finish's price per wear (no StatTrak™, no Souvenir: those price
 * the counter and the sticker), and store it in `app_settings` for a day, so
 * a restart does not ask again. Skinport allows a few requests per five
 * minutes; we make one a day per instance.
 */

import { brotliDecompressSync } from 'zlib';
import fetch from 'node-fetch';
import { db } from '../../../config/database';
import { log } from '../../../utils/logger';

const ITEMS_URL = 'https://api.skinport.com/v1/items?app_id=730&currency=USD&tradable=0';
// v2: per wear, every skin (v1 was one median per knife and glove finish).
const SETTING_KEY = 'skins_prices_v2';
const TTL_MS = 24 * 60 * 60 * 1000;
/** After a failed fetch, wait this long before trying again. */
const RETRY_MS = 30 * 60 * 1000;

interface SkinportItem {
  market_hash_name: string;
  version: string | null;
  median_price: number | null;
  suggested_price: number | null;
  min_price: number | null;
}

/** CS2's wears, by float. */
export const WEARS = [
  { key: 'fn', name: 'Factory New', min: 0, max: 0.07 },
  { key: 'mw', name: 'Minimal Wear', min: 0.07, max: 0.15 },
  { key: 'ft', name: 'Field-Tested', min: 0.15, max: 0.38 },
  { key: 'ww', name: 'Well-Worn', min: 0.38, max: 0.45 },
  { key: 'bs', name: 'Battle-Scarred', min: 0.45, max: 1 },
] as const;
export type Wear = (typeof WEARS)[number]['key'];

/** The wear a float is in. */
export function wearOf(float: number): Wear {
  return (WEARS.find((w) => float < w.max) ?? WEARS[WEARS.length - 1]).key;
}

/**
 * The lower bound (USD) of each rarity above common, about ×4 a step: common
 * under $1, uncommon $1–5, rare $5–25, mythical $25–100, legendary $100–400,
 * ancient $400–1,500, immortal from $1,500. On 2026-11-05 every band held 147
 * (immortal) to 2,161 finish-and-wear entries.
 */
export const PRICE_BANDS = [1, 5, 25, 100, 400, 1500] as const;

/** The rarity index (0 = common) a price falls in. */
export function bandOf(price: number): number {
  return PRICE_BANDS.filter((low) => price >= low).length;
}

/** A finish's price per wear (USD); a wear nobody sells is missing. */
export type WearPrices = Partial<Record<Wear, number>>;

interface StoredPrices {
  at: number;
  /** `priceKey()` → its price per wear. */
  prices: Record<string, WearPrices>;
}

let memory: StoredPrices | null = null;
let lastFailure = 0;
let inflight: Promise<StoredPrices | null> | null = null;

/** "karambit|doppler|sapphire": the weapon's and finish's display names, and the phase. */
export function priceKey(
  weaponName: string,
  name: string,
  variant: string | null | undefined
): string {
  return [weaponName, name, variant ?? ''].map((part) => part.trim().toLowerCase()).join('|');
}

const WEAR_BY_NAME = new Map<string, Wear>(WEARS.map((w) => [w.name, w.key]));

/**
 * "★ Karambit | Doppler (Factory New)" → weapon "Karambit", finish "Doppler",
 * wear "fn"; "AK-47 | Redline (Field-Tested)" likewise. Null for anything
 * without a wear (stickers, agents, cases, a vanilla knife) and for StatTrak™
 * and Souvenir copies.
 */
export function parseMarketName(
  name: string
): { weaponName: string; finish: string; wear: Wear } | null {
  if (name.includes('StatTrak') || name.startsWith('Souvenir ')) return null;
  const match =
    /^(?:★ )?(.+?) \| (.+?) \((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)$/.exec(
      name
    );
  const wear = match && WEAR_BY_NAME.get(match[3]);
  return match && wear ? { weaponName: match[1], finish: match[2], wear } : null;
}

/** Each finish's price per wear: the wear's median sale price (else Skinport's suggested, else the lowest listing). */
export function pricesFromItems(items: SkinportItem[]): Record<string, WearPrices> {
  const prices: Record<string, WearPrices> = {};
  for (const item of items) {
    const parsed = parseMarketName(item.market_hash_name);
    if (!parsed) continue;
    const price = item.median_price ?? item.suggested_price ?? item.min_price;
    if (typeof price !== 'number' || !(price > 0)) continue;
    const key = priceKey(parsed.weaponName, parsed.finish, item.version);
    (prices[key] ??= {})[parsed.wear] = Math.round(price * 100) / 100;
  }
  return prices;
}

async function download(): Promise<Record<string, WearPrices>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    // Skinport answers only with brotli, which node-fetch 2 does not unpack.
    const response = await fetch(ITEMS_URL, {
      headers: { 'Accept-Encoding': 'br' },
      compress: false,
      // node-fetch 2 declares its own AbortSignal type; Node's has the same shape.
      // eslint-disable-next-line no-restricted-syntax -- node-fetch 2's AbortSignal type does not overlap Node's for tsc
      signal: controller.signal as unknown as NonNullable<Parameters<typeof fetch>[1]>['signal'],
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const raw = await response.buffer();
    const body =
      response.headers.get('content-encoding') === 'br' ? brotliDecompressSync(raw) : raw;
    const items = JSON.parse(body.toString('utf8')) as SkinportItem[];
    if (!Array.isArray(items)) throw new Error('not a list');
    return pricesFromItems(items);
  } finally {
    clearTimeout(timer);
  }
}

async function refresh(): Promise<StoredPrices | null> {
  try {
    const prices = await download();
    if (Object.keys(prices).length === 0) throw new Error('no skin prices');
    const next = { at: Date.now(), prices };
    await db.setAppSettingAsync(SETTING_KEY, JSON.stringify(next));
    memory = next;
    log.info('[Skins] Skin prices updated from Skinport', {
      finishes: Object.keys(prices).length,
    });
    return next;
  } catch (error) {
    lastFailure = Date.now();
    log.warn('[Skins] Could not read Skinport prices', { error: (error as Error).message });
    return null;
  }
}

/**
 * Every finish's price per wear (USD, by `priceKey`), at most a day old when
 * Skinport answers; the last ones stored when it does not; empty when there
 * never were any. Never throws.
 */
export async function skinPrices(): Promise<Record<string, WearPrices>> {
  if (!memory) {
    const raw = await db.getAppSettingAsync(SETTING_KEY).catch(() => null);
    if (raw) {
      try {
        memory = JSON.parse(raw) as StoredPrices;
      } catch {
        memory = null;
      }
    }
  }
  const stale = !memory || Date.now() - memory.at > TTL_MS;
  if (stale && Date.now() - lastFailure > RETRY_MS) {
    inflight ??= refresh().finally(() => {
      inflight = null;
    });
    // The first time ever, wait for it; after that, stale prices do until it lands.
    if (!memory) await inflight;
  }
  return memory?.prices ?? {};
}

/**
 * The price per wear for `key`, or for a phase nobody is selling right now (a
 * Black Pearl, an Emerald) the dearest listed phase of the same finish, per
 * wear: those are the rarest phases, so the top of the finish's range is the
 * honest guess.
 */
export function priceFor(prices: Record<string, WearPrices>, key: string): WearPrices | undefined {
  if (prices[key] !== undefined) return prices[key];
  const [weapon, finish, variant] = key.split('|');
  if (!variant) return undefined;
  const prefix = `${weapon}|${finish}|`;
  const siblings = Object.keys(prices).filter((k) => k.startsWith(prefix) && k !== prefix);
  if (!siblings.length) return undefined;
  const out: WearPrices = {};
  for (const k of siblings)
    for (const [wear, price] of Object.entries(prices[k]) as Array<[Wear, number]>)
      out[wear] = Math.max(out[wear] ?? 0, price);
  return out;
}

/** A finish's one price for lists: the median of its wears' prices. */
export function finishPrice(wears: WearPrices | undefined): number | undefined {
  const values = Object.values(wears ?? {}).sort((a, b) => a - b);
  if (!values.length) return undefined;
  const mid = Math.floor(values.length / 2);
  return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}
