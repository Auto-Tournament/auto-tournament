import { db } from '../../../config/database';
import {
  DbMapRow,
  CreateMapInput,
  UpdateMapInput,
  MapResponse,
  MapGameMode,
} from '../../../types/map.types';
import { log } from '../../../utils/logger';
import {
  forgetMapMode,
  isMapMode,
  modeFromMapName,
  normalizeMapMode,
  rememberMapModes,
} from './mapModes';

/** A request's `gameMode`: undefined when not sent, null to clear; throws on an unknown type. */
function requestedMode(value: unknown): MapGameMode | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const mode = normalizeMapMode(value);
  if (!mode || !isMapMode(mode)) {
    throw new Error(
      'gameMode must be one of defusal, hostage, wingman, armsrace, deathmatch, other'
    );
  }
  return mode;
}

/**
 * Map service for business logic
 */
export class MapService {
  /**
   * Get all maps
   */
  async getAllMaps(): Promise<MapResponse[]> {
    const maps = await db.getAllAsync<DbMapRow>('cs2_maps', undefined, undefined);
    // Sort by display_name
    maps.sort((a, b) => a.display_name.localeCompare(b.display_name));
    const out = maps.map(this.toResponse);
    rememberMapModes(out, true);
    return out;
  }

  /**
   * Get map by ID
   */
  async getMapById(id: string): Promise<MapResponse | null> {
    const map = await db.getOneAsync<DbMapRow>('cs2_maps', 'id = ?', [id]);
    const out = map ? this.toResponse(map) : null;
    if (out) rememberMapModes([out]);
    return out;
  }

  /**
   * Create a new map
   */
  async createMap(input: CreateMapInput, upsert = false): Promise<MapResponse> {
    // Check if map with this ID already exists
    const existing = await this.getMapById(input.id);
    if (existing) {
      if (upsert) {
        // Update existing map instead of throwing error
        return await this.updateMap(input.id, {
          displayName: input.displayName,
          imageUrl: input.imageUrl,
          ...(input.gameMode !== undefined ? { gameMode: input.gameMode } : {}),
        });
      }
      throw new Error(`Map with ID '${input.id}' already exists`);
    }

    // Validate ID format (should be like de_dust2)
    if (!/^[a-z0-9_]+$/.test(input.id)) {
      throw new Error('Map ID must contain only lowercase letters, numbers, and underscores');
    }

    if (!input.displayName.trim()) {
      throw new Error('Display name is required');
    }
    const gameMode = requestedMode(input.gameMode);

    await db.insertAsync('cs2_maps', {
      id: input.id,
      display_name: input.displayName.trim(),
      image_url: input.imageUrl || null,
      game_mode: gameMode === undefined ? modeFromMapName(input.id) : gameMode,
    });

    log.success(`Map created: ${input.displayName} (${input.id})`);
    const result = await this.getMapById(input.id);
    if (!result) throw new Error('Failed to retrieve created map');
    return result;
  }

  /**
   * Update a map
   */
  async updateMap(id: string, input: UpdateMapInput): Promise<MapResponse> {
    const existing = await this.getMapById(id);
    if (!existing) {
      throw new Error(`Map with ID '${id}' not found`);
    }

    if (input.displayName !== undefined && !input.displayName.trim()) {
      throw new Error('Display name cannot be empty');
    }

    const updateData: Record<string, unknown> = {
      updated_at: Math.floor(Date.now() / 1000),
    };

    if (input.displayName !== undefined) updateData.display_name = input.displayName.trim();
    if (input.imageUrl !== undefined) updateData.image_url = input.imageUrl || null;
    const gameMode = requestedMode(input.gameMode);
    if (gameMode !== undefined) updateData.game_mode = gameMode;
    // An admin's edit: a map sync no longer renames it or swaps its image.
    if (
      (updateData.display_name !== undefined && updateData.display_name !== existing.displayName) ||
      (updateData.image_url !== undefined && updateData.image_url !== existing.imageUrl)
    ) {
      updateData.system_managed = 0;
    }

    await db.updateAsync('cs2_maps', updateData, 'id = ?', [id]);

    log.success(`Map updated: ${input.displayName || existing.displayName} (${id})`);
    const result = await this.getMapById(id);
    if (!result) throw new Error('Failed to retrieve updated map');
    return result;
  }

  /**
   * Delete a map
   */
  async deleteMap(id: string): Promise<void> {
    const existing = await this.getMapById(id);
    if (!existing) {
      throw new Error(`Map with ID '${id}' not found`);
    }

    await db.deleteAsync('cs2_maps', 'id = ?', [id]);
    forgetMapMode(id);
    log.success(`Map deleted: ${existing.displayName} (${id})`);
  }

  /**
   * Convert database row to response
   */
  private toResponse(map: DbMapRow): MapResponse {
    return {
      id: map.id,
      displayName: map.display_name,
      imageUrl: map.image_url,
      gameMode: normalizeMapMode(map.game_mode),
      systemManaged: map.system_managed === 1,
      createdAt: map.created_at,
      updatedAt: map.updated_at,
    };
  }
}

export const mapService = new MapService();
