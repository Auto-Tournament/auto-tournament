/**
 * Map types for database and API
 */

export interface DbMapRow {
  id: string;
  display_name: string;
  image_url: string | null;
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
  createdAt: number;
  updatedAt: number;
}
