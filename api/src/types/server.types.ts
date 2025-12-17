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
  matchzy_config?: string | null; // JSON blob with per-server MatchZy ConVar overrides
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
  matchzyConfig?: MatchzyServerConfigInput;
}

export interface UpdateServerInput {
  name?: string;
  host?: string;
  port?: number;
  password?: string;
  enabled?: boolean;
  matchzyConfig?: MatchzyServerConfigInput | null;
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
  matchzyConfig: MatchzyServerConfig | null;
  created_at: number;
  updated_at: number;
}

/**
 * Per-server MatchZy configuration (backend representation)
 * This is intentionally a small, opinionated subset of all possible ConVars.
 */
export interface MatchzyServerConfig {
  // Override core settings if desired (otherwise fall back to global app settings)
  chatPrefix?: string | null;
  adminChatPrefix?: string | null;
  knifeEnabledDefault?: boolean | null;

  // Common operational toggles (all optional; null/undefined = do not touch)
  minimumReadyRequired?: number | null;
  pauseAfterRestore?: boolean | null;
  stopCommandAvailable?: boolean | null;
  stopCommandNoDamage?: boolean | null;
  whitelistEnabledDefault?: boolean | null;
  kickWhenNoMatchLoaded?: boolean | null;
  playoutEnabledDefault?: boolean | null;
  resetCvarsOnSeriesEnd?: boolean | null;
  usePauseCommandForTacticalPause?: boolean | null;
  autostartMode?: 'enabled' | 'disabled' | 'ready_check' | null;

  // Demo / logging settings
  demoPath?: string | null;
  demoNameFormat?: string | null;
  demoUploadUrl?: string | null;
}

/**
 * Shape accepted from API clients (frontend) – same as MatchzyServerConfig for now.
 * Defined separately in case we want stricter validation later.
 */
export type MatchzyServerConfigInput = MatchzyServerConfig;

export interface BatchOperationResult {
  success: boolean;
  serverId: string;
  error?: string;
}
