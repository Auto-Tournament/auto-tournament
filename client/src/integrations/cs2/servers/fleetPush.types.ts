/** The server-level push API (`/api/fleet/admins`, `/settings`, `/servers/:id/push`, …). */

export interface FleetAdminEntry {
  steamid64: string;
  name: string;
}

export interface FleetAdminsResponse {
  success: boolean;
  rev: number;
  admins: FleetAdminEntry[];
  extras: FleetAdminEntry[];
  dropped: number;
  servers: Array<{
    serverId: string;
    name: string;
    online: boolean;
    rev: number | null;
    acked: boolean;
    at: number | null;
  }>;
}

export interface FleetConfigSettings {
  chat_prefix?: string;
  admin_chat_prefix?: string;
  hostname_format?: string;
  demo?: { path?: string; name_format?: string };
  series_end_kick_delay?: { no_demo?: number; demo_no_upload?: number; demo_upload?: number };
  offline_pause_minutes?: number;
  scrim_when_idle?: boolean;
  scrim_knife?: boolean;
  warmup?: { message_html?: string; respawn?: boolean; money?: number };
  status_http?: { token?: string };
}

export type FleetMatchSettings = Partial<Record<string, boolean | number>>;

export interface FleetSettingsValue {
  config: FleetConfigSettings;
  match: FleetMatchSettings;
  statusTokenSet?: boolean;
}

export interface FleetSettingsResponse {
  success: boolean;
  rev: number;
  settings: FleetSettingsValue;
  matchSettings: string[];
}

export interface FleetPushStatus {
  at: number;
  rev: number | null;
  acked: boolean;
  status: 'pending' | 'ok' | 'rejected' | 'failed' | 'expired' | null;
  errorCode: string | null;
  message: string | null;
  output: string | null;
}

export interface FleetServerPushResponse {
  success: boolean;
  serverId: string;
  online: boolean;
  settingsRev: number;
  override: FleetSettingsValue | null;
  effective: FleetSettingsValue;
  whitelist: { enabled: boolean; steamids: string[] } | null;
  practice: boolean | null;
  plugins: { enable: string[]; disable: string[] } | null;
  pushed: {
    admins: FleetPushStatus | null;
    serverConfig: FleetPushStatus | null;
    settings: FleetPushStatus | null;
    whitelist: FleetPushStatus | null;
    practice: FleetPushStatus | null;
    plugins: FleetPushStatus | null;
  };
}

export interface FleetCommandAnswer {
  success: boolean;
  command: {
    id: string;
    delivered: boolean;
    status: 'pending' | 'ok' | 'rejected' | 'failed' | 'expired';
    errorCode: string | null;
    message: string | null;
    output: string | null;
  };
}
