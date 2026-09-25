/**
 * Map types for database and API
 */

export interface DbMapRow {
  id: string;
  display_name: string;
  image_url: string | null;
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
}

export interface UpdateMapInput {
  displayName?: string;
  imageUrl?: string | null;
}

export interface MapResponse {
  id: string;
  displayName: string;
  imageUrl: string | null;
  /** Seeded from maps.json and not edited since: a map sync keeps its name and image current. */
  systemManaged: boolean;
  createdAt: number;
  updatedAt: number;
}
