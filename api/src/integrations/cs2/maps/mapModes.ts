/**
 * A map's type (`cs2_maps.game_mode`): what the Maps page groups by, the pill
 * on a map card, and what a tournament's `settings.cs2.mapMode` restricts its
 * maps to (a wingman tournament only plays wingman maps).
 *
 * Where it comes from:
 * - maps.json (`CatalogMap.mode`, the game files) for the platform's own maps;
 * - the Steam Workshop tags ("Classic", "Wingman", …) for a Workshop map;
 * - the id prefix (`de_`, `cs_`, `ar_`) when neither says;
 * - an admin, on the map's edit dialog.
 * NULL is "not known": such a map shows under "No type" and no tournament
 * rule refuses it.
 */

export const MAP_MODES = [
  'defusal',
  'hostage',
  'wingman',
  'armsrace',
  'deathmatch',
  'other',
] as const;
export type MapMode = (typeof MAP_MODES)[number];

export function isMapMode(value: unknown): value is MapMode {
  return typeof value === 'string' && (MAP_MODES as readonly string[]).includes(value);
}

/** A mode as a request, maps.json or an older row spells it; null when it is none of ours. */
export function normalizeMapMode(value: unknown): MapMode | null {
  if (typeof value !== 'string') return null;
  const v = value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
  if (v === 'defusal' || v === 'bomb' || v === 'classic' || v === 'competitive' || v === 'casual')
    return 'defusal';
  if (v === 'hostage' || v === 'hostagerescue') return 'hostage';
  if (v === 'wingman') return 'wingman';
  if (v === 'armsrace' || v === 'gungame') return 'armsrace';
  if (v === 'deathmatch' || v === 'dm') return 'deathmatch';
  if (v === 'other' || v === 'custom') return 'other';
  return null;
}

/** From the id or name alone: `de_` defusal, `cs_` hostage, `ar_` arms race. */
export function modeFromMapName(name: string): MapMode | null {
  const n = name.trim().toLowerCase();
  if (n.startsWith('de_')) return 'defusal';
  if (n.startsWith('cs_')) return 'hostage';
  if (n.startsWith('ar_')) return 'armsrace';
  return null;
}

/** A catalogue map's type: maps.json's `mode`, else its id. */
export function modeFromCatalog(mode: string | null | undefined, id: string): MapMode | null {
  return normalizeMapMode(mode) ?? modeFromMapName(id);
}

/**
 * A Workshop map's type from its Steam tags (GetPublishedFileDetails `tags`)
 * and title. Wingman wins over Classic (a wingman map is a small bomb map);
 * a Classic map is hostage when its title or a tag says so, else defusal.
 */
export function modeFromWorkshopTags(tags: readonly string[], title = ''): MapMode | null {
  const set = new Set(
    tags.map((tag) =>
      tag
        .trim()
        .toLowerCase()
        .replace(/[\s_-]+/g, '')
    )
  );
  const t = title.trim().toLowerCase();
  const hostage =
    set.has('hostage') || set.has('hostagerescue') || t.startsWith('cs_') || /\bhostage/.test(t);
  if (set.has('wingman')) return 'wingman';
  if (hostage) return 'hostage';
  if (set.has('classic') || set.has('defusal') || set.has('bomb') || set.has('competitive'))
    return 'defusal';
  if (set.has('armsrace') || set.has('gungame')) return 'armsrace';
  if (set.has('deathmatch')) return 'deathmatch';
  return modeFromMapName(t);
}

// ---------------------------------------------------------------------------
// The type of each map, for the synchronous tournament validation
// (validateTournamentSettings has no database access). Kept by mapService on
// every read and write, and warmed when the module starts.
// ---------------------------------------------------------------------------

const knownModes = new Map<string, MapMode | null>();

export function rememberMapModes(
  rows: ReadonlyArray<{ id: string; gameMode: MapMode | null }>,
  replace = false
): void {
  if (replace) knownModes.clear();
  for (const row of rows) knownModes.set(row.id, row.gameMode);
}

export function forgetMapMode(id: string): void {
  knownModes.delete(id);
}

/** The maps in `mapIds` whose known type is not `mode` (unknown types pass), with their type. */
export function mapsOfOtherModes(
  mapIds: readonly string[],
  mode: MapMode
): Array<{ id: string; mode: MapMode }> {
  const out: Array<{ id: string; mode: MapMode }> = [];
  for (const id of mapIds) {
    const known = knownModes.get(id);
    if (known && known !== mode) out.push({ id, mode: known });
  }
  return out;
}
