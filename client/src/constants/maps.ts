/**
 * CS2 Map data with images
 */

import type { CS2MapData } from '../types/veto.types';

// Map images - using sivert-io/cs2-server-manager
// Full-size webp images are used for large hero/background displays.
// Thumbnails (with `_thumb` suffix) are used for smaller cards/lists.
const MAP_IMAGE_BASE =
  'https://raw.githubusercontent.com/sivert-io/cs2-server-manager/master/map_thumbnails';

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

export const getMapDisplayName = (mapName: string): string => {
  const mapData = getMapData(mapName);
  return mapData?.displayName || mapName.replace('de_', '');
};

