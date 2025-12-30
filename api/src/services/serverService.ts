import { db } from '../config/database';
import {
  Server,
  CreateServerInput,
  UpdateServerInput,
  ServerResponse,
} from '../types/server.types';
import { log } from '../utils/logger';

/**
 * Server service for business logic
 */
export class ServerService {
  /**
   * Get all servers (optionally filter by enabled status)
   */
  async getAllServers(onlyEnabled = false): Promise<ServerResponse[]> {
    const servers = onlyEnabled
      ? await db.getAllAsync<Server>('servers', 'enabled = ?', [1])
      : await db.getAllAsync<Server>('servers');

    return servers.map(this.toResponse);
  }

  /**
   * Get server by ID
   */
  async getServerById(id: string): Promise<ServerResponse | null> {
    const server = await db.getOneAsync<Server>('servers', 'id = ?', [id]);
    return server ? this.toResponse(server) : null;
  }

  /**
   * Check if a server with the same host:port already exists
   */
  private async getServerByHostPort(host: string, port: number, excludeId?: string): Promise<Server | null> {
    const servers = await db.getAllAsync<Server>('servers', 'host = ? AND port = ?', [host, port]);

    // If excludeId is provided, filter it out (for updates)
    if (excludeId) {
      const filtered = servers.filter((s) => s.id !== excludeId);
      return filtered.length > 0 ? filtered[0] : null;
    }

    return servers.length > 0 ? servers[0] : null;
  }

  /**
   * Create a new server
   */
  async createServer(input: CreateServerInput, upsert = false): Promise<ServerResponse> {
    // Check if server with this ID already exists
    const existing = await this.getServerById(input.id);
    if (existing) {
      if (upsert) {
        // Update existing server instead of throwing error
        return await this.updateServer(input.id, {
          name: input.name,
          host: input.host,
          port: input.port,
          password: input.password,
        });
      }
      throw new Error(`Server with ID '${input.id}' already exists`);
    }

    // Check if server with same host:port already exists
    const duplicate = await this.getServerByHostPort(input.host, input.port);
    if (duplicate) {
      throw new Error(
        `A server with host:port '${input.host}:${input.port}' already exists (ID: ${duplicate.id}, Name: ${duplicate.name})`
      );
    }

    // Validate port
    if (input.port < 1 || input.port > 65535) {
      throw new Error('Port must be between 1 and 65535');
    }

    const matchzyConfig =
      input.matchzyConfig && Object.keys(input.matchzyConfig).length > 0
        ? JSON.stringify(input.matchzyConfig)
        : null;

    await db.insertAsync('servers', {
      id: input.id,
      name: input.name,
      host: input.host,
      port: input.port,
      password: input.password,
      enabled: input.enabled !== undefined ? (input.enabled ? 1 : 0) : 1,
      matchzy_config: matchzyConfig,
    });

    log.serverCreated(input.id, input.name);
    const result = await this.getServerById(input.id);
    if (!result) throw new Error('Failed to retrieve created server');
    return result;
  }

  /**
   * Update a server
   */
  async updateServer(id: string, input: UpdateServerInput): Promise<ServerResponse> {
    const existing = await this.getServerById(id);
    if (!existing) {
      throw new Error(`Server with ID '${id}' not found`);
    }

    // Validate port if provided
    if (input.port !== undefined && (input.port < 1 || input.port > 65535)) {
      throw new Error('Port must be between 1 and 65535');
    }

    // Check for duplicate host:port if either is being changed
    const newHost = input.host !== undefined ? input.host : existing.host;
    const newPort = input.port !== undefined ? input.port : existing.port;

    // Only check if host or port is actually changing
    if (input.host !== undefined || input.port !== undefined) {
      const duplicate = await this.getServerByHostPort(newHost, newPort, id);
      if (duplicate) {
        throw new Error(
          `A server with host:port '${newHost}:${newPort}' already exists (ID: ${duplicate.id}, Name: ${duplicate.name})`
        );
      }
    }

    const updateData: Record<string, unknown> = {
      updated_at: Math.floor(Date.now() / 1000),
    };

    if (input.name !== undefined) updateData.name = input.name;
    if (input.host !== undefined) updateData.host = input.host;
    if (input.port !== undefined) updateData.port = input.port;
    if (input.password !== undefined) updateData.password = input.password;
    if (input.enabled !== undefined) updateData.enabled = input.enabled ? 1 : 0;

    if (input.matchzyConfig !== undefined) {
      const hasKeys =
        input.matchzyConfig && Object.keys(input.matchzyConfig).length > 0;
      updateData.matchzy_config = hasKeys ? JSON.stringify(input.matchzyConfig) : null;
    }

    await db.updateAsync('servers', updateData, 'id = ?', [id]);

    log.serverUpdated(id, input.name || existing.name);
    const result = await this.getServerById(id);
    if (!result) throw new Error('Failed to retrieve updated server');
    return result;
  }

  /**
   * Delete a server
   */
  async deleteServer(id: string): Promise<void> {
    const existing = await this.getServerById(id);
    if (!existing) {
      throw new Error(`Server with ID '${id}' not found`);
    }

    await db.deleteAsync('servers', 'id = ?', [id]);
    log.serverDeleted(id, existing.name);
  }

  /**
   * Enable/disable a server
   */
  async setServerEnabled(id: string, enabled: boolean): Promise<ServerResponse> {
    const existing = await this.getServerById(id);
    if (!existing) {
      throw new Error(`Server with ID '${id}' not found`);
    }

    await db.updateAsync(
      'servers',
      {
        enabled: enabled ? 1 : 0,
        updated_at: Math.floor(Date.now() / 1000),
      },
      'id = ?',
      [id]
    );

    log.success(`Server ${enabled ? 'enabled' : 'disabled'}: ${existing.name} (${id})`);
    const result = await this.getServerById(id);
    if (!result) throw new Error('Failed to retrieve server after enable/disable');
    return result;
  }

  /**
   * Create multiple servers at once
   */
  async createServers(
    inputs: CreateServerInput[],
    upsert = false
  ): Promise<{
    successful: ServerResponse[];
    failed: Array<{ id: string; error: string }>;
  }> {
    const successful: ServerResponse[] = [];
    const failed: Array<{ id: string; error: string }> = [];

    for (const input of inputs) {
      try {
        const server = await this.createServer(input, upsert);
        successful.push(server);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        failed.push({ id: input.id, error: message });
        log.error(`Failed to create server ${input.id}`, error);
      }
    }

    return { successful, failed };
  }

  /**
   * Update multiple servers at once
   */
  async updateServers(updates: Array<{ id: string; updates: UpdateServerInput }>): Promise<{
    successful: ServerResponse[];
    failed: Array<{ id: string; error: string }>;
  }> {
    const successful: ServerResponse[] = [];
    const failed: Array<{ id: string; error: string }> = [];

    for (const item of updates) {
      try {
        const server = await this.updateServer(item.id, item.updates);
        successful.push(server);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        failed.push({ id: item.id, error: message });
        log.error(`Failed to update server ${item.id}`, error);
      }
    }

    return { successful, failed };
  }

  /**
   * Convert database row to response (includes password for RCON)
   */
  private toResponse(server: Server): ServerResponse {
    let matchzyConfig: ServerResponse['matchzyConfig'] = null;
    if (server.matchzy_config) {
      try {
        matchzyConfig = JSON.parse(server.matchzy_config);
      } catch {
        matchzyConfig = null;
        log.warn('Failed to parse matchzy_config for server', { id: server.id });
      }
    }

    return {
      id: server.id,
      name: server.name,
      host: server.host,
      port: server.port,
      password: server.password,
      enabled: server.enabled === 1,
      matchzyConfig,
      created_at: server.created_at,
      updated_at: server.updated_at,
    };
  }
}

export const serverService = new ServerService();
