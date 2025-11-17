/**
 * Server types
 */

export interface Server {
  id: string;
  name: string;
  host: string;
  port: number;
  password: string;
  enabled: number; // PostgreSQL stores boolean as 0/1 in INTEGER column
  created_at: number;
  updated_at: number;
}

export interface CreateServerInput {
  id: string;
  name: string;
  host: string;
  port: number;
  password: string;
  enabled?: boolean; // Optional, defaults to true
}

export interface UpdateServerInput {
  name?: string;
  host?: string;
  port?: number;
  password?: string;
  enabled?: boolean;
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
