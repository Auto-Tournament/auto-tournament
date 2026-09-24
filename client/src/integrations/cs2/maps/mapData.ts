/**
 * CS2 Map data with images.
 *
 * This module's copy of `client/src/constants/maps.ts`: the `de_*` list is
 * CS2's data, and a module built on its own cannot reach core's copy
 * (DESIGN-module-client-api.md §2.4). Core keeps its own while its pages
 * still use it (item 10).
 */

import type { CS2MapData } from '../cs2.types';

// Map images from Auto-Tournament/cs2-server-manager
// Full-size webp images are used for large hero/background displays.
// Thumbnails (with `_thumb` suffix) are used for smaller cards/lists.
const MAP_IMAGE_BASE =
  'https://raw.githubusercontent.com/Auto-Tournament/cs2-server-manager/master/map_thumbnails';

const getFullImageUrl = (mapName: string): string =>
  `${MAP_IMAGE_BASE}/${mapName}.webp`;

const getThumbnailUrl = (mapName: string): string =>
  `${MAP_IMAGE_BASE}/${mapName}_thumb.webp`;

export const CS2_MAPS: CS2MapData[] = [
  {
    name: 'de_ancient',
    displayName: 'Ancient',
    image: getFullImageUrl('de_ancient'),
    thumbnail: getThumbnailUrl('de_ancient'),
  },
  {
    name: 'de_anubis',
    displayName: 'Anubis',
    image: getFullImageUrl('de_anubis'),
    thumbnail: getThumbnailUrl('de_anubis'),
  },
  {
    name: 'de_dust2',
    displayName: 'Dust II',
    image: getFullImageUrl('de_dust2'),
    thumbnail: getThumbnailUrl('de_dust2'),
  },
  {
    name: 'de_inferno',
    displayName: 'Inferno',
    image: getFullImageUrl('de_inferno'),
    thumbnail: getThumbnailUrl('de_inferno'),
  },
  {
    name: 'de_mirage',
    displayName: 'Mirage',
    image: getFullImageUrl('de_mirage'),
    thumbnail: getThumbnailUrl('de_mirage'),
  },
  {
    name: 'de_nuke',
    displayName: 'Nuke',
    image: getFullImageUrl('de_nuke'),
    thumbnail: getThumbnailUrl('de_nuke'),
  },
  {
    name: 'de_vertigo',
    displayName: 'Vertigo',
    image: getFullImageUrl('de_vertigo'),
    thumbnail: getThumbnailUrl('de_vertigo'),
  },
];

export const getMapData = (mapName: string): CS2MapData | undefined => {
  return CS2_MAPS.find((m) => m.name === mapName);
};

/**
 * Title-cased fallback for maps that aren't in CS2_MAPS (workshop maps, maps
 * added to the pool later): "de_train" -> "Train", not "train".
 */
const titleCaseMapName = (mapName: string): string =>
  mapName
    .replace(/^(de|cs|ar|dz)_/, '')
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

export const getMapDisplayName = (mapName: string): string => {
  if (!mapName) return mapName;
  const mapData = getMapData(mapName);
  return mapData?.displayName || titleCaseMapName(mapName) || mapName;
};

