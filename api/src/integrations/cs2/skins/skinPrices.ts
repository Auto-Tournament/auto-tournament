/* global AbortController */
/**
 * Market prices for knives and gloves, from Skinport's public API (no key,
 * https://docs.skinport.com/items), so a knife's rarity follows what it is
 * worth: a Navaja Safari Mesh is common, a Karambit Sapphire is not.
 *
 * One request returns every CS2 item (about 25,000 rows, ~1 MB brotli). We
 * keep only knives and gloves (`★` names, no StatTrak™), take each finish's
 * median price per wear, then the median of those, and store the result in
 * `app_settings` for a day, so a restart does not ask again. Skinport allows
 * a few requests per five minutes; we make one a day per instance.
 */

import { brotliDecompressSync } from 'zlib';
import fetch from 'node-fetch';
import { db } from '../../../config/database';
import { log } from '../../../utils/logger';

const ITEMS_URL = 'https://api.skinport.com/v1/items?app_id=730&currency=USD&tradable=0';
const SETTING_KEY = 'skins_prices';
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

interface StoredPrices {
  at: number;
  /** `priceKey()` → USD. */
  prices: Record<string, number>;
}

let memory: StoredPrices | null = null;
let lastFailure = 0;
let inflight: Promise<StoredPrices | null> | null = null;

/** "karambit|doppler|sapphire": the weapon's and finish's display names, and the phase. */
export function priceKey(weaponName: string, name: string, variant: string | null | undefined): string {
  return [weaponName, name, variant ?? ''].map((part) => part.trim().toLowerCase()).join('|');
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * "★ Karambit | Doppler (Factory New)" → weapon "Karambit", finish "Doppler".
 * Null for anything that is not a knife or glove finish (and for StatTrak™
 * copies, which price the counter as much as the skin).
 */
export function parseMarketName(name: string): { weaponName: string; finish: string } | null {
  if (!name.startsWith('★ ') || name.includes('StatTrak')) return null;
  const match = /^★ (.+?) \| (.+?)(?: \((?:Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\))?$/.exec(name);
  return match ? { weaponName: match[1], finish: match[2] } : null;
}

/** Each knife and glove finish's price: the median over its wears of each wear's median sale price. */
export function pricesFromItems(items: SkinportItem[]): Record<string, number> {
  const perWear = new Map<string, number[]>();
  for (const item of items) {
    const parsed = parseMarketName(item.market_hash_name);
    if (!parsed) continue;
    const price = item.median_price ?? item.suggested_price ?? item.min_price;
    if (typeof price !== 'number' || !(price > 0)) continue;
    const key = priceKey(parsed.weaponName, parsed.finish, item.version);
    const list = perWear.get(key) ?? [];
    list.push(price);
    perWear.set(key, list);
  }
  const prices: Record<string, number> = {};
  for (const [key, list] of perWear) prices[key] = Math.round(median(list) * 100) / 100;
  return prices;
}

async function download(): Promise<Record<string, number>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    // Skinport answers only with brotli, which node-fetch 2 does not unpack.
    const response = await fetch(ITEMS_URL, {
      headers: { 'Accept-Encoding': 'br' },
      compress: false,
      // node-fetch 2 declares its own AbortSignal type; Node's has the same shape.
      signal: controller.signal as unknown as NonNullable<Parameters<typeof fetch>[1]>['signal'],
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const raw = await response.buffer();
    const body = response.headers.get('content-encoding') === 'br' ? brotliDecompressSync(raw) : raw;
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
    if (Object.keys(prices).length === 0) throw new Error('no knife or glove prices');
    const next = { at: Date.now(), prices };
    await db.setAppSettingAsync(SETTING_KEY, JSON.stringify(next));
    memory = next;
    log.info('[Skins] Knife and glove prices updated from Skinport', { finishes: Object.keys(prices).length });
    return next;
  } catch (error) {
    lastFailure = Date.now();
    log.warn('[Skins] Could not read Skinport prices', { error: (error as Error).message });
    return null;
  }
}

/**
 * Knife and glove prices (USD by `priceKey`), at most a day old when Skinport
 * answers; the last ones stored when it does not; empty when there never were
 * any. Never throws.
 */
export async function knifeAndGlovePrices(): Promise<Record<string, number>> {
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
 * The price for `key`, or for a phase nobody is selling right now (a Black
 * Pearl, an Emerald) the dearest listed phase of the same finish: those are
 * the rarest phases, so the top of the finish's range is the honest guess.
 */
export function priceFor(prices: Record<string, number>, key: string): number | undefined {
  if (prices[key] !== undefined) return prices[key];
  const [weapon, finish, variant] = key.split('|');
  if (!variant) return undefined;
  const prefix = `${weapon}|${finish}|`;
  const siblings = Object.keys(prices).filter((k) => k.startsWith(prefix) && k !== prefix).map((k) => prices[k]);
  return siblings.length ? Math.max(...siblings) : undefined;
}

/**
 * Rarity by price: the priced finishes sorted cheapest first and cut into as
 * many equal groups as there are rarities, so each rarity holds the same share
 * of knives and gloves. Returns `priceKey` → index into `rarities`.
 */
export function rarityIndexByPrice(prices: Record<string, number>, keys: string[], rarityCount: number): Map<string, number> {
  const priceOf = new Map<string, number>();
  for (const key of new Set(keys)) {
    const price = priceFor(prices, key);
    if (price !== undefined) priceOf.set(key, price);
  }
  const priced = [...priceOf.keys()].sort((a, b) => priceOf.get(a)! - priceOf.get(b)!);
  const result = new Map<string, number>();
  priced.forEach((key, i) => {
    result.set(key, Math.min(rarityCount - 1, Math.floor((i * rarityCount) / priced.length)));
  });
  return result;
}
