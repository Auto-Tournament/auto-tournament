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
  at_config?: string | null; // JSON blob with per-server Auto Tournament CS2 ConVar overrides
  persistent_config_sent?: number | null; // Unix timestamp when persistent config was last sent
  plugin_version?: string | null; // Auto Tournament CS2 version (e.g., "1.3.6")
  hostname?: string | null; // CS2 server hostname (from hostname convar)
  last_seen?: number | null; // Unix timestamp of last event received (heartbeat)
  status?: string | null; // 'online', 'offline', 'unknown'
  /** If set, the server has reported a CS2 update is required (Steam required_version). */
  cs2_required_version?: number | null;
  /** Best-effort: phase of the update signal ('available'|'shutdown'). */
  cs2_update_phase?: string | null;
  /** Unix timestamp when update was last reported. */
  cs2_update_required_at?: number | null;
  /** Unix timestamp when MAT last checked UpToDateCheck for this server. */
  cs2_update_checked_at?: number | null;
  /** Best-effort: CS2 server build ID parsed from `version` output. */
  cs2_build_id?: number | null;
  /** Best-effort: `version` output (display-only; may include multiple lines). */
  cs2_version_string?: string | null;
  /** Unix timestamp when version/build was last fetched via RCON. */
  cs2_version_fetched_at?: number | null;
  /** Best-effort: Auto Tournament CS2 plugin DB reachable (1/0). */
  at_db_ok?: number | null;
  /** Best-effort: 'sqlite' | 'mysql'. */
  at_db_type?: string | null;
  /** Best-effort: last DB error message (if any). */
  at_db_error?: string | null;
  /** Unix timestamp when DB was last reported OK. */
  at_db_last_ok_at?: number | null;
  /** Unix timestamp when DB health was last reported. */
  at_db_last_seen_at?: number | null;
  /** Unix timestamp when server last successfully sent any event to /api/events. */
  server_can_reach_api_at?: number | null;
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
  atConfig?: AtServerConfigInput;
}

export interface UpdateServerInput {
  name?: string;
  host?: string;
  port?: number;
  password?: string;
  enabled?: boolean;
  atConfig?: AtServerConfigInput | null;
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
  atConfig: AtServerConfig | null;
  created_at: number;
  updated_at: number;
  // Server tracking fields (from Auto Tournament CS2 server_configured event)
  pluginVersion?: string | null; // Auto Tournament CS2 version (e.g., "1.3.6")
  hostname?: string | null; // CS2 server hostname (from hostname convar)
  lastSeen?: number | null; // Unix timestamp of last event received (heartbeat)
  status?: string | null; // 'online', 'offline', 'unknown'
  /** Unix timestamp when we last sent persistent config via RCON. Set before Auto Tournament CS2 sends events. */
  persistentConfigSent?: number | null;
  /** If set, the server has reported a CS2 update is required (Steam required_version). */
  cs2RequiredVersion?: number | null;
  /** Best-effort: phase of the update signal ('available'|'shutdown'). */
  cs2UpdatePhase?: string | null;
  /** Unix timestamp when update was last reported. */
  cs2UpdateRequiredAt?: number | null;
  /** Unix timestamp when MAT last checked UpToDateCheck for this server. */
  cs2UpdateCheckedAt?: number | null;
  /** Best-effort: CS2 server build ID parsed from `version` output. */
  cs2BuildId?: number | null;
  /** Best-effort: `version` output (display-only; may include multiple lines). */
  cs2VersionString?: string | null;
  /** Unix timestamp when version/build was last fetched via RCON. */
  cs2VersionFetchedAt?: number | null;
  /** Best-effort: Auto Tournament CS2 plugin DB reachable. */
  atDbOk?: boolean | null;
  /** Best-effort: 'sqlite' | 'mysql'. */
  atDbType?: string | null;
  /** Best-effort: last DB error message (if any). */
  atDbError?: string | null;
  /** Unix timestamp when DB was last reported OK. */
  atDbLastOkAt?: number | null;
  /** Unix timestamp when DB health was last reported. */
  atDbLastSeenAt?: number | null;
  /** Unix timestamp when server last successfully sent any event to /api/events. */
  serverCanReachApiAt?: number | null;
}

/**
 * Per-server Auto Tournament CS2 configuration (backend representation)
 * This is intentionally a small, opinionated subset of all possible ConVars.
 * Note: Chat prefixes and knife round defaults are configured at the global/tournament/match level,
 * not per-server. Only server-specific operational settings are included here.
 */
export interface AtServerConfig {
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
  /**
   * Auto Tournament CS2 autostart mode:
   * 0 = idle/sleep, 1 = match mode, 2 = practice mode
   */
  autostartMode?: 0 | 1 | 2 | null;

  /** `''` leaves the server's own hostname alone. */
  hostnameFormat?: string | null;

  // Demo / logging settings
  demoPath?: string | null;
  demoNameFormat?: string | null;
  demoUploadUrl?: string | null;
}

/**
 * Shape accepted from API clients (frontend) – same as AtServerConfig for now.
 * Defined separately in case we want stricter validation later.
 */
export type AtServerConfigInput = AtServerConfig;

export interface BatchOperationResult {
  success: boolean;
  serverId: string;
  error?: string;
}
