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
  getAllServers(onlyEnabled = false): ServerResponse[] {
    const servers = onlyEnabled
      ? db.getAll<Server>('servers', 'enabled = ?', [1])
      : db.getAll<Server>('servers');

    return servers.map(this.toResponse);
  }

  /**
   * Get server by ID
   */
  getServerById(id: string): ServerResponse | null {
    const server = db.getOne<Server>('servers', 'id = ?', [id]);
    return server ? this.toResponse(server) : null;
  }

  /**
   * Create a new server
   */
  createServer(input: CreateServerInput, upsert = false): ServerResponse {
    // Check if server with this ID already exists
    const existing = this.getServerById(input.id);
    if (existing) {
      if (upsert) {
        // Update existing server instead of throwing error
        return this.updateServer(input.id, {
          name: input.name,
          host: input.host,
          port: input.port,
          password: input.password,
        });
      }
      throw new Error(`Server with ID '${input.id}' already exists`);
    }

    // Validate port
    if (input.port < 1 || input.port > 65535) {
      throw new Error('Port must be between 1 and 65535');
    }

    db.insert('servers', {
      id: input.id,
      name: input.name,
      host: input.host,
      port: input.port,
      password: input.password,
      enabled: 1,
    });

    log.serverCreated(input.id, input.name);
    return this.getServerById(input.id)!;
  }

  /**
   * Update a server
   */
  updateServer(id: string, input: UpdateServerInput): ServerResponse {
    const existing = this.getServerById(id);
    if (!existing) {
      throw new Error(`Server with ID '${id}' not found`);
    }

    // Validate port if provided
    if (input.port !== undefined && (input.port < 1 || input.port > 65535)) {
      throw new Error('Port must be between 1 and 65535');
    }

    const updateData: Record<string, unknown> = {
      updated_at: Math.floor(Date.now() / 1000),
    };

    if (input.name !== undefined) updateData.name = input.name;
    if (input.host !== undefined) updateData.host = input.host;
    if (input.port !== undefined) updateData.port = input.port;
    if (input.password !== undefined) updateData.password = input.password;

    db.update('servers', updateData, 'id = ?', [id]);

    log.serverUpdated(id, input.name || existing.name);
    return this.getServerById(id)!;
  }

  /**
   * Delete a server
   */
  deleteServer(id: string): void {
    const existing = this.getServerById(id);
    if (!existing) {
      throw new Error(`Server with ID '${id}' not found`);
    }

    db.delete('servers', 'id = ?', [id]);
    log.serverDeleted(id, existing.name);
  }

  /**
   * Enable/disable a server
   */
  setServerEnabled(id: string, enabled: boolean): ServerResponse {
    const existing = this.getServerById(id);
    if (!existing) {
      throw new Error(`Server with ID '${id}' not found`);
    }

    db.update(
      'servers',
      {
        enabled: enabled ? 1 : 0,
        updated_at: Math.floor(Date.now() / 1000),
      },
      'id = ?',
      [id]
    );

    log.success(`Server ${enabled ? 'enabled' : 'disabled'}: ${existing.name} (${id})`);
    return this.getServerById(id)!;
  }

  /**
   * Create multiple servers at once
   */
  createServers(
    inputs: CreateServerInput[],
    upsert = false
  ): {
    successful: ServerResponse[];
    failed: Array<{ id: string; error: string }>;
  } {
    const successful: ServerResponse[] = [];
    const failed: Array<{ id: string; error: string }> = [];

    for (const input of inputs) {
      try {
        const server = this.createServer(input, upsert);
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
  updateServers(updates: Array<{ id: string; updates: UpdateServerInput }>): {
    successful: ServerResponse[];
    failed: Array<{ id: string; error: string }>;
  } {
    const successful: ServerResponse[] = [];
    const failed: Array<{ id: string; error: string }> = [];

    for (const item of updates) {
      try {
        const server = this.updateServer(item.id, item.updates);
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
    return {
      id: server.id,
      name: server.name,
      host: server.host,
      port: server.port,
      password: server.password,
      enabled: server.enabled === 1,
      created_at: server.created_at,
      updated_at: server.updated_at,
    };
  }
}

export const serverService = new ServerService();
