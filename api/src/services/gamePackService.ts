/**
 * Game packs: a game this instance runs because an admin imported a file for
 * it, rather than because a module shipped it.
 *
 * A pack is **data**. It carries a name, the settings a manually reported game
 * needs, and the path of its tile, and it runs on an engine that is already
 * installed —
 * `engine`, which today is always the manual-reporting module. Nothing in a
 * pack executes. That is the whole point: a file describing Rocket League can
 * be passed around, reviewed in a pull request and imported by a stranger,
 * the way a Pelican egg can, precisely because importing it cannot run
 * anything.
 *
 * A game the platform *watches* — CS2, reading rounds off a server — is not
 * expressible as data and is not a pack. That needs code, and code is a
 * different kind of module with a different set of problems.
 *
 * ## Where a pack shows up
 *
 * `gameCatalogService.builtinGames()` lists installed modules' catalogue
 * entries, then packs, then the popular titles. First claim wins, so a pack
 * can never take a slug a module owns: `counter-strike-2` stays CS2's however
 * the pack is written.
 *
 * Nothing in the integration registry changes. The manual-reporting module
 * already declares `runsAnyCatalogGame`, so a tournament created for a pack's
 * slug resolves to it the same way a tournament for a game found through IGDB
 * search does.
 *
 * ## The tile is a file next to the pack, not a string inside it
 *
 * `icon` is a path — `../icons/call-of-duty.svg` — resolved against wherever
 * the pack file came from. A tile is a few hundred KB of flat facets, and a
 * pack with one baked into it is a JSON file nobody can read, diff or review.
 * So the pack names its art and the art stays a file.
 *
 * The markup therefore arrives *beside* the definition: fetched from the
 * index alongside the pack, or picked by the admin along with the JSON. It is
 * stored in the `game_packs.icon` column either way, because the instance has
 * to serve it whether or not the place it came from is still reachable.
 *
 * ## The app icon is a file too
 *
 * `appIcon` names a second, smaller picture: the square icon players know the
 * game by — the one on their phone, their desktop, their launcher. The tile
 * is our art for the Modules page and the setup wizard; the app icon is the
 * game's own, for the 20 px game pills where a player picks out *their*
 * game at a glance. It is a raster (PNG or WebP), at most 25 KB, square,
 * checked by its bytes rather than its name, and stored beside the tile.
 *
 * ## Trust
 *
 * The blast radius of a bad pack is wrong data and a wrong picture, with one
 * exception: the tile. Pack tiles are served from our own origin and inlined
 * into the page by `ModuleIcon`, so an `onload=` on a `<path>` would be a
 * stored cross-site script. Every tile is therefore checked against a strict
 * allowlist on import and **rejected** — not stripped — if it contains
 * anything outside it. A pack that will not import is a pack someone can fix;
 * a pack quietly rewritten on the way in is a pack nobody can reason about.
 */

import fs from 'fs/promises';
import path from 'path';
import { db } from '../config/database';
import { BUNDLED_PACKS_DIR } from '../config/publicPaths';
import { listIntegrations } from '../integrations/registry';
import { log } from '../utils/logger';
import {
  installedPack,
  installedPacks,
  refreshPackCache,
  type GamePackDefinition,
  type InstalledPack,
  type PackSource,
  type PackStatField,
} from './packCache';

// The read side moved to `./packCache` so an integration can import it
// without reaching the registry. Re-exported so nothing that already imports
// it from here has to change.
export {
  installedPack,
  installedPacks,
  refreshPackCache,
  type GamePackDefinition,
  type InstalledPack,
  type PackSource,
  type PackStatField,
} from './packCache';

/** How many packs one instance may hold. A guard, not a design limit. */
const MAX_PACKS = 200;
/** Tiles are a few hundred KB of flat facets; 1 MB is generous. */
const MAX_ICON_BYTES = 1_000_000;
const MAX_STAT_FIELDS = 40;
/** An app icon is a 128 px square; 25 KB leaves room for a detailed one. */
export const MAX_APP_ICON_BYTES = 25 * 1024;
const MIN_APP_ICON_PX = 32;
const MAX_APP_ICON_PX = 512;

export const PACK_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// The tile allowlist
// ---------------------------------------------------------------------------

const ALLOWED_ELEMENTS = new Set([
  'svg',
  'g',
  'defs',
  'title',
  'desc',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'clippath',
  'mask',
  'use',
  'lineargradient',
  'radialgradient',
  'stop',
]);

const ALLOWED_ATTRIBUTES = new Set([
  'class',
  'clip-path',
  'clip-rule',
  'cx',
  'cy',
  'd',
  'fill',
  'fill-opacity',
  'fill-rule',
  'gradienttransform',
  'gradientunits',
  'height',
  'href',
  'id',
  'mask',
  'offset',
  'opacity',
  'points',
  'r',
  'rx',
  'ry',
  'stop-color',
  'stop-opacity',
  'stroke',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-opacity',
  'stroke-width',
  'style',
  'transform',
  'viewbox',
  'width',
  'x',
  'x1',
  'x2',
  'xlink:href',
  'xmlns',
  'xmlns:xlink',
  'y',
  'y1',
  'y2',
]);

/**
 * Reject a tile that is anything other than flat vector art.
 *
 * Deliberately conservative: this reads the markup with a tokeniser rather
 * than a parser, so anything it cannot account for is refused. The failure
 * mode is "your icon was rejected", which someone can act on. The failure
 * mode of being clever here is a script in every admin's browser.
 */
export function checkTileMarkup(markup: string): string | null {
  if (Buffer.byteLength(markup, 'utf8') > MAX_ICON_BYTES) {
    return `icon is larger than ${Math.round(MAX_ICON_BYTES / 1000)} KB`;
  }
  if (!/^\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(markup)) {
    return 'icon must be an SVG document starting with <svg>';
  }
  if (/<!DOCTYPE/i.test(markup) || /<!ENTITY/i.test(markup)) {
    return 'icon must not declare a doctype or entities';
  }

  const withoutComments = markup.replace(/<!--[\s\S]*?-->/g, '');
  const tagRe = /<\s*(\/?)\s*([a-zA-Z_][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let tag: RegExpExecArray | null;
  let sawSvg = false;

  while ((tag = tagRe.exec(withoutComments)) !== null) {
    const [, closing, rawName, rawAttributes] = tag;
    const name = rawName.toLowerCase();
    if (!ALLOWED_ELEMENTS.has(name)) return `icon contains a <${rawName}> element`;
    if (name === 'svg') sawSvg = true;
    if (closing) continue;

    const attrRe = /([a-zA-Z_][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let attribute: RegExpExecArray | null;
    while ((attribute = attrRe.exec(rawAttributes)) !== null) {
      const attrName = attribute[1].toLowerCase();
      const value = attribute[3] ?? attribute[4] ?? '';

      if (attrName.startsWith('on')) return `icon contains an ${attribute[1]} handler`;
      if (!ALLOWED_ATTRIBUTES.has(attrName)) return `icon contains a ${attribute[1]} attribute`;
      if (/javascript:/i.test(value)) return 'icon contains a javascript: value';
      // A reference may only point inside the file. An external one is a
      // request to another host from inside our page.
      if ((attrName === 'href' || attrName === 'xlink:href') && !value.startsWith('#')) {
        return 'icon references something outside itself';
      }
      if (attrName === 'style' && /url\s*\(|expression\s*\(|@import/i.test(value)) {
        return 'icon contains a style that loads something';
      }
      if (attrName !== 'style' && /url\s*\(\s*['"]?(?!#)/i.test(value)) {
        return 'icon references something outside itself';
      }
    }
  }

  if (!sawSvg) return 'icon must be an SVG document';
  if (!/viewBox\s*=/i.test(markup)) return 'icon must have a viewBox so it can scale';
  return null;
}

/**
 * Reject an `icon` that is anything but a relative path to an SVG beside the
 * pack. A URL here would have the instance fetching from wherever a pack
 * file said to, which is the one thing importing data must never do.
 */
export function checkIconPath(value: string): string | null {
  if (!value.trim()) return 'icon must be a path to an SVG file';
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return 'icon must be a path, not a URL';
  if (value.startsWith('/') || value.startsWith('//')) return 'icon must be a relative path';
  if (!value.toLowerCase().endsWith('.svg')) return 'icon must be an .svg file';
  if (value.length > 200) return 'icon path is longer than 200 characters';
  // `..` is how a pack in `packs/` reaches `icons/`, so it is allowed — but
  // only as a whole segment, and `resolveIconUrl` still refuses anything that
  // climbs out of the index's own base.
  if (value.split('/').some((segment) => segment !== '..' && segment.includes('..'))) {
    return 'icon path is malformed';
  }
  return null;
}

/**
 * Reject an `appIcon` that is anything but a relative path to a PNG or WebP
 * beside the pack — the same rules as `icon`, for a raster file.
 */
export function checkAppIconPath(value: string): string | null {
  if (!value.trim()) return 'appIcon must be a path to a PNG or WebP file';
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return 'appIcon must be a path, not a URL';
  if (value.startsWith('/') || value.startsWith('//')) return 'appIcon must be a relative path';
  if (!/\.(png|webp)$/i.test(value)) return 'appIcon must be a .png or .webp file';
  if (value.length > 200) return 'appIcon path is longer than 200 characters';
  if (value.split('/').some((segment) => segment !== '..' && segment.includes('..'))) {
    return 'appIcon path is malformed';
  }
  return null;
}

export type AppIconType = 'image/png' | 'image/webp';

/** A checked app icon: the bytes as they arrived, and what they are. */
export interface AppIcon {
  data: Buffer;
  type: AppIconType;
}

/** Width and height from a PNG's IHDR or a WebP's VP8/VP8L/VP8X header, or null. */
function rasterSize(bytes: Buffer): { type: AppIconType; width: number; height: number } | null {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(png)) {
    if (bytes.toString('latin1', 12, 16) !== 'IHDR') return null;
    return { type: 'image/png', width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (
    bytes.length >= 30 &&
    bytes.toString('latin1', 0, 4) === 'RIFF' &&
    bytes.toString('latin1', 8, 12) === 'WEBP'
  ) {
    const chunk = bytes.toString('latin1', 12, 16);
    if (chunk === 'VP8 ') {
      // Lossy: a key frame's start code, then 14-bit width and height.
      if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
      return {
        type: 'image/webp',
        width: bytes.readUInt16LE(26) & 0x3fff,
        height: bytes.readUInt16LE(28) & 0x3fff,
      };
    }
    if (chunk === 'VP8L') {
      if (bytes[20] !== 0x2f) return null;
      const bits = bytes.readUInt32LE(21);
      return { type: 'image/webp', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8X') {
      return {
        type: 'image/webp',
        width: bytes.readUIntLE(24, 3) + 1,
        height: bytes.readUIntLE(27, 3) + 1,
      };
    }
  }
  return null;
}

/**
 * Check an app icon by its bytes: a PNG or WebP (whatever the file was
 * called), at most 25 KB, square, 32 to 512 px. Returns the icon, or why it
 * is not one. Like a tile, a bad one is refused, never fixed up.
 */
export function checkAppIcon(bytes: Buffer): AppIcon | string {
  if (bytes.length === 0) return 'appIcon is empty';
  if (bytes.length > MAX_APP_ICON_BYTES) {
    return `appIcon is larger than ${Math.round(MAX_APP_ICON_BYTES / 1024)} KB`;
  }
  const size = rasterSize(bytes);
  if (!size) return 'appIcon must be a PNG or WebP image';
  if (size.width !== size.height) return 'appIcon must be square';
  if (size.width < MIN_APP_ICON_PX || size.width > MAX_APP_ICON_PX) {
    return `appIcon must be between ${MIN_APP_ICON_PX} and ${MAX_APP_ICON_PX} px`;
  }
  return { data: bytes, type: size.type };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const KEY_RE = /^[a-z][a-z0-9_]*$/;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function validateStats(value: unknown): { fields: PackStatField[] } | string {
  if (value === undefined) return { fields: [] };
  if (!Array.isArray(value)) return 'stats must be a list';
  if (value.length > MAX_STAT_FIELDS) return `stats holds more than ${MAX_STAT_FIELDS} fields`;

  const fields: PackStatField[] = [];
  const keys = new Set<string>();
  for (const raw of value) {
    const field = asRecord(raw);
    if (!field) return 'every stat field must be an object';
    const { key, label, type, scope, required } = field;
    if (typeof key !== 'string' || !KEY_RE.test(key)) {
      return `stat field key '${String(key)}' must be lower case letters, digits and underscores`;
    }
    if (keys.has(key)) return `stat field '${key}' is declared twice`;
    keys.add(key);
    if (typeof label !== 'string' || !label.trim()) return `stat field '${key}' needs a label`;
    if (type !== 'integer' && type !== 'decimal' && type !== 'text') {
      return `stat field '${key}' must be integer, decimal or text`;
    }
    if (scope !== 'player' && scope !== 'team') {
      return `stat field '${key}' must have scope player or team`;
    }
    if (required !== undefined && typeof required !== 'boolean') {
      return `stat field '${key}' has a non-boolean 'required'`;
    }
    fields.push({ key, label: label.trim(), type, scope, ...(required ? { required } : {}) });
  }
  return { fields };
}

/**
 * Turn whatever was uploaded into a pack, or say why it is not one.
 *
 * Unknown top level keys are refused rather than ignored: a pack written for
 * a newer schema would otherwise import looking healthy and silently do less
 * than it says.
 */
export function validatePack(
  input: unknown
): { ok: true; pack: GamePackDefinition } | { ok: false; error: string } {
  const fail = (error: string) => ({ ok: false as const, error });

  const raw = asRecord(input);
  if (!raw) return fail('a pack must be a JSON object');

  const known = new Set([
    'schema',
    'slug',
    'name',
    'engine',
    'aliases',
    'version',
    'description',
    'icon',
    'appIcon',
    'report',
    'stats',
  ]);
  const unknown = Object.keys(raw).filter((key) => !known.has(key));
  if (unknown.length > 0) return fail(`unknown field(s): ${unknown.join(', ')}`);

  if (raw.schema !== PACK_SCHEMA_VERSION) {
    return fail(`schema must be ${PACK_SCHEMA_VERSION}, this instance does not read others`);
  }

  const slug = typeof raw.slug === 'string' ? raw.slug.trim().toLowerCase() : '';
  if (!SLUG_RE.test(slug)) return fail("slug must look like 'rocket-league'");
  if (slug.length > 64) return fail('slug is longer than 64 characters');

  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name) return fail('name is required');
  if (name.length > 100) return fail('name is longer than 100 characters');

  const engine = typeof raw.engine === 'string' ? raw.engine.trim().toLowerCase() : '';
  if (!engine) return fail('engine is required');

  // The engine has to be installed *and* be one that runs games it was not
  // written for. A pack naming CS2 as its engine is asking a module that
  // reads rounds off a game server to run a game it has never heard of.
  const integration = listIntegrations().find((candidate) => candidate.id === engine);
  if (!integration) return fail(`engine '${engine}' is not installed on this instance`);
  if (integration.runsAnyCatalogGame !== true) {
    return fail(`engine '${engine}' only runs the games it ships`);
  }

  // A module's own games are the module's. Refusing here means an admin finds
  // out on import rather than wondering why their pack never appears — the
  // catalogue's first-claim-wins would silently drop it.
  for (const installed of listIntegrations()) {
    const claimed = [
      ...(installed.catalog ? [installed.catalog.slug] : []),
      ...(installed.catalogEntries ?? []).map((entry) => entry.slug),
    ];
    if (claimed.includes(slug)) {
      return fail(`'${slug}' is already shipped by the ${installed.id} module`);
    }
  }

  let aliases: string[] = [];
  if (raw.aliases !== undefined) {
    if (!Array.isArray(raw.aliases) || raw.aliases.some((a) => typeof a !== 'string')) {
      return fail('aliases must be a list of strings');
    }
    aliases = (raw.aliases as string[]).map((alias) => alias.trim().toLowerCase()).filter(Boolean);
  }

  for (const [field, limit] of [
    ['version', 40],
    ['description', 300],
  ] as const) {
    const value = raw[field];
    if (value === undefined) continue;
    if (typeof value !== 'string') return fail(`${field} must be a string`);
    if (value.length > limit) return fail(`${field} is longer than ${limit} characters`);
  }

  if (raw.icon !== undefined) {
    if (typeof raw.icon !== 'string') return fail('icon must be a path to an SVG file');
    const problem = checkIconPath(raw.icon);
    if (problem) return fail(problem);
  }

  if (raw.appIcon !== undefined) {
    if (typeof raw.appIcon !== 'string') return fail('appIcon must be a path to a PNG or WebP file');
    const problem = checkAppIconPath(raw.appIcon);
    if (problem) return fail(problem);
  }

  let report: GamePackDefinition['report'];
  if (raw.report !== undefined) {
    const value = asRecord(raw.report);
    if (!value) return fail('report must be an object');
    const extra = Object.keys(value).filter(
      (key) => key !== 'confirmation' && key !== 'confirmTimeoutMin'
    );
    if (extra.length > 0) return fail(`unknown report field(s): ${extra.join(', ')}`);
    if (
      value.confirmation !== undefined &&
      value.confirmation !== 'opponent' &&
      value.confirmation !== 'admin'
    ) {
      return fail('report.confirmation must be opponent or admin');
    }
    const timeout = value.confirmTimeoutMin;
    if (timeout !== undefined) {
      if (typeof timeout !== 'number' || !Number.isInteger(timeout) || timeout < 1) {
        return fail('report.confirmTimeoutMin must be a whole number of minutes');
      }
      if (timeout > 60 * 24 * 7) return fail('report.confirmTimeoutMin is longer than a week');
    }
    report = {
      ...(value.confirmation ? { confirmation: value.confirmation as 'opponent' | 'admin' } : {}),
      ...(timeout !== undefined ? { confirmTimeoutMin: timeout as number } : {}),
    };
  }

  const stats = validateStats(raw.stats);
  if (typeof stats === 'string') return fail(stats);

  return {
    ok: true,
    pack: {
      schema: PACK_SCHEMA_VERSION,
      slug,
      name,
      engine,
      ...(aliases.length > 0 ? { aliases } : {}),
      ...(typeof raw.version === 'string' ? { version: raw.version } : {}),
      ...(typeof raw.description === 'string' ? { description: raw.description } : {}),
      ...(typeof raw.icon === 'string' ? { icon: raw.icon } : {}),
      ...(typeof raw.appIcon === 'string' ? { appIcon: raw.appIcon } : {}),
      ...(report ? { report } : {}),
      ...(stats.fields.length > 0 ? { stats: stats.fields } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Storage, and the cache the catalogue reads
// ---------------------------------------------------------------------------

export async function packIcon(slug: string): Promise<string | null> {
  const row = await db.getOneAsync<{ icon: string | null }>(
    'game_packs',
    'slug = ?',
    [slug.trim().toLowerCase()]
  );
  return row?.icon ?? null;
}

/** A pack's stored app icon, or null when it has none. */
export async function packAppIcon(slug: string): Promise<AppIcon | null> {
  const row = await db.getOneAsync<{ app_icon: string | null; app_icon_type: string | null }>(
    'game_packs',
    'slug = ?',
    [slug.trim().toLowerCase()]
  );
  if (!row?.app_icon) return null;
  return {
    data: Buffer.from(row.app_icon, 'base64'),
    type: row.app_icon_type === 'image/png' ? 'image/png' : 'image/webp',
  };
}

export async function installPack(
  definition: GamePackDefinition,
  options: {
    source?: PackSource;
    origin?: string | null;
    installedBy?: string | null;
    /** The tile's markup, already checked by `checkTileMarkup`. */
    tile?: string | null;
    /** The app icon, already checked by `checkAppIcon`. */
    appIcon?: AppIcon | null;
  } = {}
): Promise<InstalledPack> {
  const existing = installedPack(definition.slug);
  if (!existing && installedPacks().length >= MAX_PACKS) {
    throw new Error(`This instance already holds ${MAX_PACKS} game packs`);
  }

  const now = Math.floor(Date.now() / 1000);
  // The definition keeps the path it declared, which is a record of where the
  // art came from. The markup is a column of its own, because the instance
  // serves it on its own URL and must not depend on that path still
  // resolving to anything.
  const stored = { ...definition };
  const icon = options.tile ?? null;
  const appIcon = options.appIcon ?? null;

  await db.runAsync(
    `INSERT INTO game_packs
       (slug, name, engine, version, source, origin, definition, icon, app_icon, app_icon_type,
        installed_by, installed_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (slug) DO UPDATE SET
       name = EXCLUDED.name,
       engine = EXCLUDED.engine,
       version = EXCLUDED.version,
       source = EXCLUDED.source,
       origin = EXCLUDED.origin,
       definition = EXCLUDED.definition,
       icon = EXCLUDED.icon,
       app_icon = EXCLUDED.app_icon,
       app_icon_type = EXCLUDED.app_icon_type,
       updated_at = EXCLUDED.updated_at`,
    [
      definition.slug,
      definition.name,
      definition.engine,
      definition.version ?? null,
      options.source ?? 'uploaded',
      options.origin ?? null,
      JSON.stringify(stored),
      icon,
      appIcon ? appIcon.data.toString('base64') : null,
      appIcon ? appIcon.type : null,
      options.installedBy ?? null,
      existing?.installedAt ?? now,
      now,
    ]
  );

  await refreshPackCache();
  const pack = installedPack(definition.slug);
  if (!pack) throw new Error(`Pack '${definition.slug}' did not survive being stored`);
  log.info(`[PACKS] ${existing ? 'Updated' : 'Installed'} game pack '${definition.slug}'`);
  return pack;
}

export async function removePack(slug: string): Promise<boolean> {
  const wanted = slug.trim().toLowerCase();
  const { changes } = await db.deleteAsync('game_packs', 'slug = ?', [wanted]);
  if (changes > 0) {
    await refreshPackCache();
    log.info(`[PACKS] Removed game pack '${wanted}'`);
  }
  return changes > 0;
}

/**
 * Whether a tournament is running this pack's game, so removing it does not
 * leave a live tournament pointing at a game the instance no longer knows.
 */
export async function packIsInUse(slug: string): Promise<boolean> {
  const row = await db.queryOneAsync<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM tournament WHERE LOWER(game) = ?',
    [slug.trim().toLowerCase()]
  );
  return Number(row?.count ?? 0) > 0;
}

/** The URL a pack's tile is served on. Same origin, so `ModuleIcon` inlines it. */
export function packIconPath(slug: string): string {
  return `/api/packs/${encodeURIComponent(slug)}/icon.svg`;
}

/** The URL a game's app icon is served on: the installed pack's, else the snapshot's. */
export function packAppIconPath(slug: string): string {
  return `/api/packs/${encodeURIComponent(slug)}/app-icon`;
}

// ---------------------------------------------------------------------------
// Bundled packs
// ---------------------------------------------------------------------------

/**
 * `app_settings` key holding every bundled slug this instance has ever
 * installed. It is the difference between "never seeded" and "removed by an
 * admin", which the `game_packs` table alone cannot tell apart: both are a
 * missing row.
 */
const SEEN_SETTING = 'bundled_packs_seen';

/**
 * Test-only: forget that some bundled packs were ever seeded, so the next
 * seed installs them again as if on a fresh instance. Lets a spec that
 * removed a bundled game put it back *as bundled* — re-importing it by hand
 * would make it the admin's, which the seed then leaves alone for good.
 */
export async function forgetBundledPacks(slugs: string[]): Promise<void> {
  const seen = await readSeen();
  for (const slug of slugs) seen.delete(slug.trim().toLowerCase());
  await db.setAppSettingAsync(SEEN_SETTING, JSON.stringify([...seen].sort()));
}

export interface SeedReport {
  /** Preinstalled, because `PREINSTALL_PACKS` asked for them. */
  installed: string[];
  updated: string[];
  /** Removed by an admin at some point; left removed. */
  keptRemoved: string[];
  /** Replaced by an admin with their own pack of the same slug; left alone. */
  keptOverridden: string[];
  /** In the snapshot and not installed: offered in the catalog, nothing more. */
  available: string[];
  /** Did not validate. Logged; never fatal. */
  skipped: string[];
}

async function readSeen(): Promise<Set<string>> {
  try {
    const raw = await db.getAppSettingAsync(SEEN_SETTING);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

/** One entry of the snapshot's `index.json`. */
export interface BundledPackEntry {
  slug: string;
  name: string;
  version: string | null;
  engine: string;
  description: string | null;
  file: string;
  icon: string | null;
  /** The app icon's path relative to the snapshot, or null. */
  appIcon: string | null;
}

/**
 * Bundled slugs whose snapshot entry names an app icon, as of the last read
 * of the snapshot's index (boot reads it). `builtinGames()` is synchronous,
 * so it asks this rather than the file.
 */
let bundledAppIconSlugs = new Set<string>();

/** Whether the image's snapshot carries an app icon for this game. */
export function hasBundledAppIcon(slug: string): boolean {
  return bundledAppIconSlugs.has(slug);
}

/**
 * The entries of `api/bundled-packs/index.json`, or an empty list (and a
 * warning) when the snapshot is missing or unreadable: a build without it
 * ships no games, it is not broken.
 */
export async function bundledPackEntries(): Promise<BundledPackEntry[]> {
  let index: { schema?: unknown; packs?: Array<Record<string, unknown>> };
  try {
    index = JSON.parse(await fs.readFile(path.join(BUNDLED_PACKS_DIR, 'index.json'), 'utf8'));
  } catch (error) {
    log.warn(`[PACKS] No bundled packs at ${BUNDLED_PACKS_DIR}: ${(error as Error).message}`);
    return [];
  }
  if (index.schema !== 1 || !Array.isArray(index.packs)) {
    log.warn('[PACKS] Bundled index.json is not a schema 1 index');
    return [];
  }
  const text = (value: unknown): string | null =>
    typeof value === 'string' && value.trim() ? value.trim() : null;
  const entries: BundledPackEntry[] = [];
  for (const row of index.packs) {
    const slug = text(row.slug)?.toLowerCase();
    const file = text(row.file);
    if (!slug || !file) continue;
    entries.push({
      slug,
      name: text(row.name) ?? slug,
      version: text(row.version),
      engine: text(row.engine) ?? 'manual-report',
      description: text(row.description),
      file,
      icon: text(row.icon),
      appIcon: text(row.appIcon),
    });
  }
  bundledAppIconSlugs = new Set(entries.filter((entry) => entry.appIcon).map((entry) => entry.slug));
  return entries;
}

function insideSnapshot(file: string): string {
  const resolved = path.resolve(BUNDLED_PACKS_DIR, file);
  if (!resolved.startsWith(BUNDLED_PACKS_DIR + path.sep)) {
    throw new Error('the path points outside the bundled packs');
  }
  return resolved;
}

/**
 * A pack from the snapshot, validated exactly like an uploaded one, with its
 * tile. Throws with the reason when it does not validate.
 */
export async function readBundledPack(
  entry: Pick<BundledPackEntry, 'file'>
): Promise<{ definition: GamePackDefinition; tile: string | null; appIcon: AppIcon | null }> {
  const packPath = insideSnapshot(entry.file);
  const result = validatePack(JSON.parse(await fs.readFile(packPath, 'utf8')));
  if (!result.ok) throw new Error(result.error);
  const definition = result.pack;
  let tile: string | null = null;
  if (definition.icon) {
    const iconPath = path.resolve(path.dirname(packPath), definition.icon);
    if (!iconPath.startsWith(BUNDLED_PACKS_DIR + path.sep)) {
      throw new Error('icon points outside the bundled packs');
    }
    const markup = await fs.readFile(iconPath, 'utf8');
    const problem = checkTileMarkup(markup);
    if (problem) throw new Error(problem);
    tile = markup;
  }
  let appIcon: AppIcon | null = null;
  if (definition.appIcon) {
    const iconPath = path.resolve(path.dirname(packPath), definition.appIcon);
    if (!iconPath.startsWith(BUNDLED_PACKS_DIR + path.sep)) {
      throw new Error('appIcon points outside the bundled packs');
    }
    const checked = checkAppIcon(await fs.readFile(iconPath));
    if (typeof checked === 'string') throw new Error(checked);
    appIcon = checked;
  }
  return { definition, tile, appIcon };
}

/** The tile the snapshot's index names for a game, checked, or null. */
export async function bundledPackTile(slug: string): Promise<string | null> {
  const entry = (await bundledPackEntries()).find((candidate) => candidate.slug === slug);
  if (!entry?.icon) return null;
  try {
    const markup = await fs.readFile(insideSnapshot(entry.icon), 'utf8');
    return checkTileMarkup(markup) ? null : markup;
  } catch {
    return null;
  }
}

/** The app icon the snapshot's index names for a game, checked, or null. */
export async function bundledPackAppIcon(slug: string): Promise<AppIcon | null> {
  const entry = (await bundledPackEntries()).find((candidate) => candidate.slug === slug);
  if (!entry?.appIcon) return null;
  try {
    const checked = checkAppIcon(await fs.readFile(insideSnapshot(entry.appIcon)));
    return typeof checked === 'string' ? null : checked;
  } catch {
    return null;
  }
}

/**
 * Which snapshot packs to install on their own: `PREINSTALL_PACKS`, `all` or
 * a comma-separated list of slugs. Unset — the default — installs none: a
 * fresh install has no games until an admin picks them from the catalog
 * (DESIGN-modules §10.1). CI sets `all`, so the suite has its games.
 */
export function preinstallPacksSetting(value = process.env.PREINSTALL_PACKS): 'all' | Set<string> {
  const raw = (value ?? '').trim().toLowerCase();
  if (raw === 'all') return 'all';
  return new Set(
    raw
      .split(',')
      .map((slug) => slug.trim())
      .filter(Boolean)
  );
}

/**
 * Keep the snapshot's packs in step with the image — without ever adding a
 * game nobody asked for.
 *
 * The platform carries no list of games in its source, and since the game
 * catalog (DESIGN-modules §10) it installs none on its own either:
 * `api/bundled-packs` is offered in the catalog as "available", and an admin
 * installs what they want with one click, network or not. So the rules are:
 *
 * - **Not installed** → leave it available. Only `PREINSTALL_PACKS` (for an
 *   operator who wants games on first boot, and for CI) installs it, once:
 *   a preinstalled game an admin then removed stays removed.
 * - **Installed from here, and the image has a new version** → update it.
 *   That is how a release ships a fixed tile or a new stat field.
 * - **Installed from elsewhere** (uploaded, or from the feed) → the admin's
 *   own. Leave it alone, whatever the image carries.
 *
 * A bundled pack is validated exactly like an uploaded one. One that fails is
 * logged and skipped; a bad file in the snapshot must never stop the
 * instance from starting.
 *
 * Runs at boot and after a database wipe. Always ends by refreshing the cache
 * the catalogue reads.
 */
export async function seedBundledPacks(
  options: { preinstall?: 'all' | Set<string> } = {}
): Promise<SeedReport> {
  const report: SeedReport = {
    installed: [],
    updated: [],
    keptRemoved: [],
    keptOverridden: [],
    available: [],
    skipped: [],
  };

  await refreshPackCache();
  const entries = await bundledPackEntries();
  if (entries.length === 0) return report;

  const preinstall = options.preinstall ?? preinstallPacksSetting();
  const seen = await readSeen();

  for (const entry of entries) {
    let definition: GamePackDefinition;
    let tile: string | null;
    let appIcon: AppIcon | null;
    try {
      ({ definition, tile, appIcon } = await readBundledPack(entry));
    } catch (error) {
      log.warn(`[PACKS] Skipped bundled pack '${entry.slug}': ${(error as Error).message}`);
      report.skipped.push(entry.slug);
      continue;
    }

    const slug = definition.slug;
    const existing = installedPack(slug);

    if (existing && existing.source !== 'bundled') {
      report.keptOverridden.push(slug);
      seen.add(slug);
    } else if (existing) {
      if ((existing.version ?? null) !== (definition.version ?? null)) {
        await installPack(definition, { source: 'bundled', tile, appIcon });
        report.updated.push(slug);
      }
      seen.add(slug);
    } else if (preinstall === 'all' || preinstall.has(slug)) {
      if (seen.has(slug)) {
        report.keptRemoved.push(slug);
      } else {
        await installPack(definition, { source: 'bundled', tile, appIcon });
        report.installed.push(slug);
        seen.add(slug);
      }
    } else {
      report.available.push(slug);
    }
  }

  await db.setAppSettingAsync(SEEN_SETTING, JSON.stringify([...seen].sort()));
  await refreshPackCache();

  const changed = report.installed.length + report.updated.length;
  if (changed > 0 || report.skipped.length > 0) {
    log.info(
      `[PACKS] Bundled packs: ${report.installed.length} preinstalled, ${report.updated.length} updated, ` +
        `${report.keptRemoved.length} left removed, ${report.keptOverridden.length} left as the admin's, ` +
        `${report.available.length} available, ${report.skipped.length} skipped`
    );
  }
  return report;
}
