/**
 * The installed game packs, in memory, for the code that reads them on every
 * request.
 *
 * Split out of `gamePackService` for one reason: this file must not import the
 * integration registry. `gamePackService` does — validating a pack means
 * asking which modules are installed — and an integration may not import the
 * registry, directly or through a service that does
 * (`eslint-rules/integration-boundaries.mjs`, rule 2: the registry imports
 * every integration, so that would be a cycle). But the manual-reporting
 * module has to know which games it runs, and those are packs. So the read
 * side lives here, with nothing between it and the database, and the module
 * can import it.
 *
 * Writes — install, remove, seed — stay in `gamePackService`, which calls
 * `refreshPackCache` after each one.
 */

import { db } from '../config/database';
import { log } from '../utils/logger';

export interface PackStatField {
  key: string;
  label: string;
  type: 'integer' | 'decimal' | 'text';
  scope: 'player' | 'team';
  required?: boolean;
}

export interface GamePackDefinition {
  schema: number;
  slug: string;
  name: string;
  /**
   * The game's numeric IGDB id, kept for linking a `games` row stored while
   * IGDB search existed to this pack by it first, so the pill draws the
   * pack's app icon even where IGDB's slug is not the pack's
   * (`trackmania--2`).
   */
  igdbId?: number;
  engine: string;
  aliases?: string[];
  version?: string;
  description?: string;
  /**
   * Where the square tile lives, relative to the pack file — normally
   * `../icons/<slug>.svg`. Never the markup itself, and never a URL.
   */
  icon?: string;
  /**
   * Where the game's square app icon lives, relative to the pack file —
   * normally `../app-icons/<slug>.webp`. The picture players know the game
   * by (the one on their phone or launcher), for the small game pills. A
   * PNG or WebP, never a URL.
   */
  appIcon?: string;
  report?: {
    confirmation?: 'opponent' | 'admin';
    confirmTimeoutMin?: number;
  };
  stats?: PackStatField[];
}

export type PackSource = 'bundled' | 'index' | 'uploaded';

export interface InstalledPack {
  slug: string;
  name: string;
  engine: string;
  version: string | null;
  /**
   * `bundled` shipped with the image (`api/bundled-packs`), `index` came from
   * the community list, `uploaded` was a file an admin picked. Only `bundled`
   * packs are ever changed by the instance itself — see `seedBundledPacks`.
   */
  source: PackSource;
  origin: string | null;
  hasIcon: boolean;
  hasAppIcon: boolean;
  installedAt: number;
  definition: GamePackDefinition;
}

interface PackRow {
  slug: string;
  name: string;
  engine: string;
  version: string | null;
  source: string;
  origin: string | null;
  definition: string;
  icon: string | null;
  app_icon: string | null;
  installed_at: number;
}

/**
 * Installed packs, by slug.
 *
 * `builtinGames()` is synchronous and called on every catalogue read, so the
 * packs it merges cannot come from a query. They are loaded once at startup
 * and refreshed by every write that goes through this file.
 */
let cache = new Map<string, InstalledPack>();

function toPack(row: PackRow): InstalledPack | null {
  try {
    return {
      slug: row.slug,
      name: row.name,
      engine: row.engine,
      version: row.version,
      source: row.source === 'bundled' || row.source === 'index' ? row.source : 'uploaded',
      origin: row.origin,
      hasIcon: Boolean(row.icon),
      hasAppIcon: Boolean(row.app_icon),
      installedAt: row.installed_at,
      definition: JSON.parse(row.definition) as GamePackDefinition,
    };
  } catch (error) {
    log.error(`[PACKS] Pack '${row.slug}' has unreadable JSON and was skipped`, error);
    return null;
  }
}

export async function refreshPackCache(): Promise<void> {
  const rows = await db.getAllAsync<PackRow>('game_packs');
  const next = new Map<string, InstalledPack>();
  for (const row of rows) {
    const pack = toPack(row);
    if (pack) next.set(pack.slug, pack);
  }
  cache = next;
}

/** Every installed pack. Synchronous, from the cache. */
/**
 * Replace the cache with packs that did not come from the database.
 *
 * For code that has the packs but no database to read them from: the
 * in-process specs in `tests/api`, which load the bundled snapshot so a
 * module's behaviour is checked against the real games rather than none.
 * Nothing in the running server calls it.
 */
export function setInstalledPacks(packs: InstalledPack[]): void {
  cache = new Map(packs.map((pack) => [pack.slug, pack]));
}

export function installedPacks(): InstalledPack[] {
  return [...cache.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function installedPack(slug: string): InstalledPack | undefined {
  return cache.get(slug.trim().toLowerCase());
}
