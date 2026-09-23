/**
 * Game packs: a game this instance runs because an admin imported a file for
 * it, rather than because a module shipped it.
 *
 * A pack is **data**. It carries a name, a tile and the settings a manually
 * reported game needs, and it runs on an engine that is already installed —
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

import { db } from '../config/database';
import { listIntegrations } from '../integrations/registry';
import { log } from '../utils/logger';

/** How many packs one instance may hold. A guard, not a design limit. */
const MAX_PACKS = 200;
/** Tiles are a few hundred KB of flat facets; 1 MB is generous. */
const MAX_ICON_BYTES = 1_000_000;
const MAX_STAT_FIELDS = 40;

export const PACK_SCHEMA_VERSION = 1;

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
  engine: string;
  aliases?: string[];
  version?: string;
  description?: string;
  /** SVG markup for the square tile, in the `--at-*` palette. */
  icon?: string;
  report?: {
    confirmation?: 'opponent' | 'admin';
    confirmTimeoutMin?: number;
  };
  stats?: PackStatField[];
}

export interface InstalledPack {
  slug: string;
  name: string;
  engine: string;
  version: string | null;
  source: 'uploaded' | 'index';
  origin: string | null;
  hasIcon: boolean;
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
  installed_at: number;
}

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
    if (typeof raw.icon !== 'string') return fail('icon must be SVG markup');
    const problem = checkTileMarkup(raw.icon);
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
      ...(report ? { report } : {}),
      ...(stats.fields.length > 0 ? { stats: stats.fields } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Storage, and the cache the catalogue reads
// ---------------------------------------------------------------------------

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
      source: row.source === 'index' ? 'index' : 'uploaded',
      origin: row.origin,
      hasIcon: Boolean(row.icon),
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
export function installedPacks(): InstalledPack[] {
  return [...cache.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function installedPack(slug: string): InstalledPack | undefined {
  return cache.get(slug.trim().toLowerCase());
}

export async function packIcon(slug: string): Promise<string | null> {
  const row = await db.getOneAsync<{ icon: string | null }>(
    'game_packs',
    'slug = ?',
    [slug.trim().toLowerCase()]
  );
  return row?.icon ?? null;
}

export async function installPack(
  definition: GamePackDefinition,
  options: { source?: 'uploaded' | 'index'; origin?: string | null; installedBy?: string | null } = {}
): Promise<InstalledPack> {
  const existing = cache.get(definition.slug);
  if (!existing && cache.size >= MAX_PACKS) {
    throw new Error(`This instance already holds ${MAX_PACKS} game packs`);
  }

  const now = Math.floor(Date.now() / 1000);
  const stored = { ...definition };
  const icon = stored.icon ?? null;
  // The tile is a column of its own: it is most of the file's bytes and the
  // only part served on its own URL.
  delete stored.icon;

  await db.runAsync(
    `INSERT INTO game_packs
       (slug, name, engine, version, source, origin, definition, icon, installed_by, installed_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (slug) DO UPDATE SET
       name = EXCLUDED.name,
       engine = EXCLUDED.engine,
       version = EXCLUDED.version,
       source = EXCLUDED.source,
       origin = EXCLUDED.origin,
       definition = EXCLUDED.definition,
       icon = EXCLUDED.icon,
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
      options.installedBy ?? null,
      existing?.installedAt ?? now,
      now,
    ]
  );

  await refreshPackCache();
  const pack = cache.get(definition.slug);
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
