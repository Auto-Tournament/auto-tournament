import { db } from '../config/database';
import {
  DbMapPoolRow,
  CreateMapPoolInput,
  UpdateMapPoolInput,
  MapPoolResponse,
} from '../types/mapPool.types';
import { log } from '../utils/logger';

/**
 * Map pool service for business logic
 */
export class MapPoolService {
  /**
   * Get all map pools
   */
  async getAllMapPools(): Promise<MapPoolResponse[]> {
    const pools = await db.getAllAsync<DbMapPoolRow>('map_pools', undefined, undefined);
    // Sort: default first, then by name
    pools.sort((a, b) => {
      if (a.is_default !== b.is_default) {
        return b.is_default - a.is_default; // Default first
      }
      return a.name.localeCompare(b.name);
    });
    return pools.map(this.toResponse);
  }

  /**
   * Get map pool by ID
   */
  async getMapPoolById(id: number): Promise<MapPoolResponse | null> {
    const pool = await db.getOneAsync<DbMapPoolRow>('map_pools', 'id = $1', [id]);
    return pool ? this.toResponse(pool) : null;
  }

  /**
   * Get map pool by name
   */
  async getMapPoolByName(name: string): Promise<MapPoolResponse | null> {
    const pool = await db.getOneAsync<DbMapPoolRow>('map_pools', 'name = $1', [name]);
    return pool ? this.toResponse(pool) : null;
  }

  /**
   * Get default map pool
   */
  async getDefaultMapPool(): Promise<MapPoolResponse | null> {
    const pool = await db.getOneAsync<DbMapPoolRow>('map_pools', 'is_default = $1', [1]);
    return pool ? this.toResponse(pool) : null;
  }

  /**
   * Create a new map pool
   */
  async createMapPool(input: CreateMapPoolInput, upsert = false): Promise<MapPoolResponse> {
    // Check if map pool with this name already exists
    const existing = await this.getMapPoolByName(input.name);
    if (existing) {
      if (upsert) {
        // Update existing map pool instead of throwing error
        return await this.updateMapPool(existing.id, {
          name: input.name,
          mapIds: input.mapIds,
        });
      }
      throw new Error(`Map pool with name '${input.name}' already exists`);
    }

    if (!input.name.trim()) {
      throw new Error('Map pool name is required');
    }

    if (!Array.isArray(input.mapIds) || input.mapIds.length === 0) {
      throw new Error('Map pool must contain at least one map');
    }

    await db.insertAsync('map_pools', {
      name: input.name.trim(),
      map_ids: JSON.stringify(input.mapIds),
      is_default: 0,
    });

    log.success(`Map pool created: ${input.name}`);
    const result = await this.getMapPoolByName(input.name);
    if (!result) throw new Error('Failed to retrieve created map pool');
    return result;
  }

  /**
   * Update a map pool
   */
  async updateMapPool(id: number, input: UpdateMapPoolInput): Promise<MapPoolResponse> {
    const existing = await this.getMapPoolById(id);
    if (!existing) {
      throw new Error(`Map pool with ID ${id} not found`);
    }

    // Check if name is being changed and if it conflicts with another pool
    if (input.name !== undefined && input.name !== existing.name) {
      const nameConflict = await this.getMapPoolByName(input.name);
      if (nameConflict && nameConflict.id !== id) {
        throw new Error(`Map pool with name '${input.name}' already exists`);
      }
    }

    if (input.name !== undefined && !input.name.trim()) {
      throw new Error('Map pool name cannot be empty');
    }

    if (input.mapIds !== undefined && (!Array.isArray(input.mapIds) || input.mapIds.length === 0)) {
      throw new Error('Map pool must contain at least one map');
    }

    const updateData: Record<string, unknown> = {
      updated_at: Math.floor(Date.now() / 1000),
    };

    if (input.name !== undefined) updateData.name = input.name.trim();
    if (input.mapIds !== undefined) updateData.map_ids = JSON.stringify(input.mapIds);

    await db.updateAsync('map_pools', updateData, 'id = $1', [id]);

    log.success(`Map pool updated: ${input.name || existing.name}`);
    const result = await this.getMapPoolById(id);
    if (!result) throw new Error('Failed to retrieve updated map pool');
    return result;
  }

  /**
   * Set a map pool as the default
   * This will unset the current default and set the new one
   */
  async setDefaultMapPool(id: number): Promise<MapPoolResponse> {
    const pool = await this.getMapPoolById(id);
    if (!pool) {
      throw new Error(`Map pool with ID ${id} not found`);
    }

    // Unset current default
    await db.updateAsync('map_pools', { is_default: 0 }, 'is_default = $1', [1]);

    // Set new default
    await db.updateAsync('map_pools', { is_default: 1, updated_at: Math.floor(Date.now() / 1000) }, 'id = $1', [id]);

    log.success(`Default map pool set to: ${pool.name}`);
    const result = await this.getMapPoolById(id);
    if (!result) throw new Error('Failed to retrieve updated map pool');
    return result;
  }

  /**
   * Delete a map pool
   */
  async deleteMapPool(id: number): Promise<void> {
    const existing = await this.getMapPoolById(id);
    if (!existing) {
      throw new Error(`Map pool with ID ${id} not found`);
    }

    if (existing.isDefault) {
      throw new Error('Cannot delete default map pool');
    }

    await db.deleteAsync('map_pools', 'id = $1', [id]);
    log.success(`Map pool deleted: ${existing.name}`);
  }

  /**
   * Convert database row to response
   */
  private toResponse(pool: DbMapPoolRow): MapPoolResponse {
    let mapIds: string[] = [];
    try {
      mapIds = JSON.parse(pool.map_ids);
    } catch {
      // If parsing fails, return empty array
      mapIds = [];
    }

    return {
      id: pool.id,
      name: pool.name,
      mapIds,
      isDefault: pool.is_default === 1,
      createdAt: pool.created_at,
      updatedAt: pool.updated_at,
    };
  }
}

export const mapPoolService = new MapPoolService();

