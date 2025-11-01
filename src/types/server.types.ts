/**
 * Server types
 */

export interface Server {
  id: string;
  name: string;
  host: string;
  port: number;
  password: string;
  enabled: number; // SQLite uses 0/1 for boolean
  created_at: number;
  updated_at: number;
}

export interface CreateServerInput {
  id: string;
  name: string;
  host: string;
  port: number;
  password: string;
}

export interface UpdateServerInput {
  name?: string;
  host?: string;
  port?: number;
  password?: string;
}

export interface BatchUpdateInput {
  id: string;
  updates: UpdateServerInput;
}

export interface ServerResponse {
  id: string;
  name: string;
  host: string;
  port: number;
  password: string;
  enabled: boolean;
  created_at: number;
  updated_at: number;
}

export interface BatchOperationResult {
  success: boolean;
  serverId: string;
  error?: string;
}
