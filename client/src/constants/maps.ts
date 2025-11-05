/**
 * CS2 Map data with images
 */

import type { CS2MapData } from '../types/veto.types';

// Map images - using ghostcap-gaming/cs2-map-images for better quality
const MAP_IMAGE_BASE = 'https://raw.githubusercontent.com/ghostcap-gaming/cs2-map-images/main/cs2';

export const CS2_MAPS: CS2MapData[] = [
  {
    name: 'de_ancient',
    displayName: 'Ancient',
    image: `${MAP_IMAGE_BASE}/de_ancient.png`,
  },
  {
    name: 'de_anubis',
    displayName: 'Anubis',
    image: `${MAP_IMAGE_BASE}/de_anubis.png`,
  },
  {
    name: 'de_dust2',
    displayName: 'Dust II',
    image: `${MAP_IMAGE_BASE}/de_dust2.png`,
  },
  {
    name: 'de_inferno',
    displayName: 'Inferno',
    image: `${MAP_IMAGE_BASE}/de_inferno.png`,
  },
  {
    name: 'de_mirage',
    displayName: 'Mirage',
    image: `${MAP_IMAGE_BASE}/de_mirage.png`,
  },
  {
    name: 'de_nuke',
    displayName: 'Nuke',
    image: `${MAP_IMAGE_BASE}/de_nuke.png`,
  },
  {
    name: 'de_vertigo',
    displayName: 'Vertigo',
    image: `${MAP_IMAGE_BASE}/de_vertigo.png`,
  },
];

export const getMapData = (mapName: string): CS2MapData | undefined => {
  return CS2_MAPS.find((m) => m.name === mapName);
};

export const getMapDisplayName = (mapName: string): string => {
  const mapData = getMapData(mapName);
  return mapData?.displayName || mapName.replace('de_', '');
};

