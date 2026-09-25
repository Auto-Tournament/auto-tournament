/**
 * Map types for database and API
 */

/** A map's type: `defusal`, `hostage`, `wingman`, `armsrace`, `deathmatch` or `other` (integrations/cs2/maps/mapModes.ts). */
export type MapGameMode = 'defusal' | 'hostage' | 'wingman' | 'armsrace' | 'deathmatch' | 'other';

export interface DbMapRow {
  id: string;
  display_name: string;
  image_url: string | null;
  /** The map's type; NULL when not known. */
  game_mode?: string | null;
  /** 1: seeded from maps.json and not edited since, so a sync may update it. */
  system_managed?: number;
  created_at: number;
  updated_at: number;
}

export interface Map {
  id: string;
  displayName: string;
  imageUrl: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CreateMapInput {
  id: string;
  displayName: string;
  imageUrl?: string | null;
  /** The map's type; left out, it comes from the id prefix (`de_`, `cs_`, `ar_`). */
  gameMode?: MapGameMode | null;
}

export interface UpdateMapInput {
  displayName?: string;
  imageUrl?: string | null;
  /** null clears it (no type). */
  gameMode?: MapGameMode | null;
}

export interface MapResponse {
  id: string;
  displayName: string;
  imageUrl: string | null;
  /** The map's type; null when not known. */
  gameMode: MapGameMode | null;
  /** Seeded from maps.json and not edited since: a map sync keeps its name and image current. */
  systemManaged: boolean;
  createdAt: number;
  updatedAt: number;
}
