/**
 * Map pool types for database and API
 */

export interface DbMapPoolRow {
  id: number;
  name: string;
  map_ids: string; // JSON array of map IDs
  is_default: number; // 0 or 1
  created_at: number;
  updated_at: number;
}

export interface MapPool {
  id: number;
  name: string;
  mapIds: string[];
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface CreateMapPoolInput {
  name: string;
  mapIds: string[];
}

export interface UpdateMapPoolInput {
  name?: string;
  mapIds?: string[];
}

export interface MapPoolResponse {
  id: number;
  name: string;
  mapIds: string[];
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
}

