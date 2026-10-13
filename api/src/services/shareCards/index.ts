/**
 * Share cards: per-page link previews (Open Graph / Twitter tags and a
 * 1200×630 image) for match, team, player and tournament pages, and the pages
 * game modules add (CS2: clips and reels).
 *
 * - `sharePageTags(path)`: the tags for a page path, or null (the generic
 *   ones stay). The image URL carries the card's version, so a changed score
 *   or picture is a new URL that chat apps fetch again.
 * - `shareCardPng(kind, key)`: the card, drawn on request and kept on disk
 *   under DATA_DIR/share-cards by the hash of what it shows.
 */

import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { DATA_DIR } from '../../config/dataDir';
import { listIntegrations } from '../../integrations/registry';
import { log } from '../../utils/logger';
import { settingsService } from '../settingsService';
import { CORE_SHARE_KINDS } from './core';
import { renderCard } from './render';
import type { CardData, ShareKind, ShareMeta } from './types';

export type { CardData, ShareKind, ShareMeta } from './types';

const CACHE_DIR = path.join(DATA_DIR, 'share-cards');
/** Cards kept on disk; the oldest go first past this. */
const MAX_FILES = 2000;
const KEY_RE = /^[A-Za-z0-9_.:~-]{1,200}$/;

function kinds(): ShareKind[] {
  const fromModules = listIntegrations().flatMap((i) => i.shareCards ?? []);
  return [...fromModules, ...CORE_SHARE_KINDS];
}

function kindOf(kind: string): ShareKind | null {
  return kinds().find((k) => k.kind === kind) ?? null;
}

export interface SharePageTags extends ShareMeta {
  kind: string;
  key: string;
  /** Path of the card image, with its version: `/og/<kind>/<key>.png?v=…`. */
  imagePath: string;
}

/** The tags for a page path, or null when no kind covers it (or the thing is gone). */
export async function sharePageTags(pathname: string): Promise<SharePageTags | null> {
  for (const k of kinds()) {
    const key = k.match(pathname);
    if (!key || !KEY_RE.test(key)) continue;
    try {
      const meta = await k.meta(key);
      if (!meta) return null;
      return {
        ...meta,
        kind: k.kind,
        key,
        imagePath: `/og/${encodeURIComponent(k.kind)}/${encodeURIComponent(key)}.png?v=${encodeURIComponent(meta.version)}`,
      };
    } catch (error) {
      log.warn('[SHARE] Could not describe a page', { pathname, error: (error as Error).message });
      return null;
    }
  }
  return null;
}

/** What a card shows, as a hash: pictures by their bytes. */
export function cardHash(card: CardData): string {
  const json = JSON.stringify(card, (_k, v: unknown) =>
    v &&
    typeof v === 'object' &&
    'data' in (v as object) &&
    Buffer.isBuffer((v as { data: unknown }).data)
      ? createHash('sha1')
          .update((v as { data: Buffer }).data)
          .digest('hex')
      : v
  );
  return createHash('sha1').update(json).digest('hex');
}

function trimCache(): void {
  try {
    const files = fs
      .readdirSync(CACHE_DIR)
      .map((f) => ({ f, at: fs.statSync(path.join(CACHE_DIR, f)).mtimeMs }))
      .sort((a, b) => a.at - b.at);
    for (const { f } of files.slice(0, Math.max(0, files.length - MAX_FILES))) {
      fs.rmSync(path.join(CACHE_DIR, f), { force: true });
    }
  } catch {
    // A full or read-only disk: the cards still come out, just not kept.
  }
}

const inFlight = new Map<string, Promise<Buffer | null>>();

/** The card PNG for `kind`/`key`, or null when there is no such page. */
export async function shareCardPng(kind: string, key: string): Promise<Buffer | null> {
  const k = kindOf(kind);
  if (!k || !KEY_RE.test(key)) return null;
  const card = await k.card(key);
  if (!card) return null;
  const site = await settingsService.getSiteName();
  const hash = cardHash(card) + createHash('sha1').update(site).digest('hex').slice(0, 8);
  const file = path.join(CACHE_DIR, `${hash}.png`);
  try {
    return fs.readFileSync(file);
  } catch {
    // Not drawn yet.
  }
  const running = inFlight.get(hash);
  if (running) return running;
  const job = (async () => {
    const png = await renderCard(card, { site });
    try {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      fs.writeFileSync(file, png);
      trimCache();
    } catch (error) {
      log.warn('[SHARE] Could not keep a card on disk', { error: (error as Error).message });
    }
    return png;
  })().finally(() => inFlight.delete(hash));
  inFlight.set(hash, job);
  return job;
}
