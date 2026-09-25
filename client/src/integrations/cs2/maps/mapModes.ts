/**
 * A map's type, as the API stores it (`gameMode`): the pill on a map card,
 * the sections of the Maps page, and a tournament's map-type rule
 * (`settings.cs2.mapMode`). The module's own copy of the API's
 * `integrations/cs2/maps/mapModes.ts` (a module does not import core).
 */
import type { Map as MapType, MapGameMode } from '../cs2.types';

export const MAP_MODES: readonly MapGameMode[] = [
  'defusal',
  'wingman',
  'hostage',
  'armsrace',
  'deathmatch',
  'other',
];

export function isMapMode(value: unknown): value is MapGameMode {
  return typeof value === 'string' && (MAP_MODES as readonly string[]).includes(value);
}

/** From the id alone: `de_` defusal, `cs_` hostage, `ar_` arms race. */
export function modeFromMapName(name: string): MapGameMode | null {
  const n = name.trim().toLowerCase();
  if (n.startsWith('de_')) return 'defusal';
  if (n.startsWith('cs_')) return 'hostage';
  if (n.startsWith('ar_')) return 'armsrace';
  return null;
}

/** A map's type: the stored one, else its id prefix; null when neither says. */
export function mapModeOf(
  map: Pick<MapType, 'id' | 'gameMode'> | undefined,
  id = map?.id ?? ''
): MapGameMode | null {
  return map?.gameMode ?? modeFromMapName(id);
}

/**
 * A Workshop map's type from its Steam tags and title. Wingman wins over
 * Classic; a Classic map is hostage when its title or a tag says so.
 */
export function modeFromWorkshopTags(tags: readonly string[], title = ''): MapGameMode | null {
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

export type MapModeChipColor = 'default' | 'primary' | 'secondary' | 'success' | 'info' | 'warning';

export function mapModeColor(mode: MapGameMode | null): MapModeChipColor {
  switch (mode) {
    case 'defusal':
      return 'primary';
    case 'wingman':
      return 'info';
    case 'hostage':
      return 'secondary';
    case 'armsrace':
      return 'success';
    case 'deathmatch':
      return 'warning';
    default:
      return 'default';
  }
}

/** The translation key of a type's name (`mapModes.none` for no type). */
export function mapModeKey(mode: MapGameMode | null): string {
  return `mapModes.${mode ?? 'none'}`;
}

/** Whether `map` may be played under the tournament map type `mode` (no type set, or an unknown map type, passes). */
export function fitsMapMode(
  map: Pick<MapType, 'id' | 'gameMode'> | undefined,
  id: string,
  mode: MapGameMode | undefined
): boolean {
  if (!mode) return true;
  const own = mapModeOf(map, id);
  return own === null || own === mode;
}
