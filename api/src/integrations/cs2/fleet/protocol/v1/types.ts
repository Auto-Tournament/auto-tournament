/**
 * Fleet protocol v1 (server channel), as TypeScript. Hand-written next to the
 * JSON Schemas in this folder, which are normative (FLEET.md D18): Ready Up's
 * and csm's CI copy the `*.json` files and validate against them, and
 * `tests/api/fleet-protocol.spec.ts` checks that the examples below still
 * pass the schemas.
 *
 * Step 1 covers the envelope, the handshake (hello / welcome), heartbeat
 * (ping / pong), standalone ack, error, token rotation (auth.rotate /
 * auth.rotated) and a placeholder server.config. Everything else in FLEET.md
 * §7-§8 comes in later steps.
 */

export const FLEET_PROTOCOL_VERSION = 1 as const;
/** The protocol majors this platform speaks (FLEET.md §14.1). */
export const FLEET_PROTOCOL_SUPPORTED = { min: 1, max: 1 } as const;

/** Reserved tenant id (D4). */
export type TenantId = 'default';
/** ULID string. */
export type Ulid = string;
/** SteamID64 as a decimal string. */
export type U64s = string;

export interface Envelope<T extends string = string, P = Record<string, unknown>> {
  v: 1;
  type: T;
  id: Ulid;
  /** Present on reliable messages only. */
  seq?: number;
  /** Highest contiguous peer seq durably processed. */
  ack?: number;
  /** Sender clock, ms since Unix epoch. */
  ts: number;
  /** Id of the message this answers. */
  ref?: string | null;
  /** Assignment epoch; required on match-scoped messages. */
  epoch?: number;
  payload: P;
}

export type Availability = 'available' | 'busy' | 'draining' | 'error';

export interface Versions {
  core: string;
  plugin_api: string;
  plugins: Record<string, string>;
  cs2_build?: number;
  cs2_patch?: string;
}

export interface HostInfo {
  hostname: string;
  game_port: number;
  tv_port?: number;
  public_addr?: string;
  status_port?: number;
}

// --- server -> platform ----------------------------------------------------

export interface HelloPayload {
  server_id: string;
  install_id: string;
  tenant_id: TenantId;
  protocol: { min: number; max: number };
  versions: Versions;
  capabilities: string[];
  host: HostInfo;
  boot_id: Ulid;
  stream: { id: string; last_tx_seq: number; last_rx_seq: number };
  /** MatchState (§9); null or absent when idle. */
  state?: Record<string, unknown> | null;
  availability: Availability;
  selftest?: { pass: boolean; passed: number; total: number; failures: string[] };
}

export type AuthRotatedPayload = Record<string, never>;

// --- platform -> server ----------------------------------------------------

export interface WelcomePayload {
  session_id: Ulid;
  protocol: number;
  heartbeat: { interval_ms: number; timeout_ms: number };
  resume: { result: 'resumed' | 'reset'; platform_last_rx_seq: number };
  server_config_rev: number;
  admins_rev: number;
  assignment: { match_id: string; epoch: number } | null;
}

export interface AuthRotatePayload {
  /** The new `rus_…` token. */
  token: string;
  /** When the old token stops working, ms since Unix epoch. */
  old_valid_until: number;
}

/** Placeholder in step 1 (FLEET.md §7.5); not sent yet. */
export interface ServerConfigPayload {
  rev: number;
  settings: {
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
  };
}

// --- both directions -------------------------------------------------------

export interface PingPayload {
  t: number;
  health?: { players?: number; tick_ms_p99?: number; spool_msgs?: number; uptime_s?: number };
}

export interface PongPayload {
  t: number;
}

export type AckPayload = Record<string, never>;

export interface ErrorPayload {
  code: string;
  message?: string;
  type?: string;
}

/** Every step-1 message type, its payload, direction and reliability. */
export interface FleetMessages {
  hello: HelloPayload;
  welcome: WelcomePayload;
  ping: PingPayload;
  pong: PongPayload;
  ack: AckPayload;
  error: ErrorPayload;
  'server.config': ServerConfigPayload;
  'auth.rotate': AuthRotatePayload;
  'auth.rotated': AuthRotatedPayload;
}

export type FleetMessageType = keyof FleetMessages;

export type Direction = 'server_to_platform' | 'platform_to_server' | 'both';

export const FLEET_MESSAGES: Record<FleetMessageType, { direction: Direction; reliable: boolean }> = {
  hello: { direction: 'server_to_platform', reliable: false },
  welcome: { direction: 'platform_to_server', reliable: false },
  ping: { direction: 'both', reliable: false },
  pong: { direction: 'both', reliable: false },
  ack: { direction: 'both', reliable: false },
  error: { direction: 'both', reliable: false },
  'server.config': { direction: 'platform_to_server', reliable: true },
  'auth.rotate': { direction: 'platform_to_server', reliable: true },
  'auth.rotated': { direction: 'server_to_platform', reliable: true },
};

// --- HTTP ------------------------------------------------------------------

export interface EnrollRequest {
  code?: string;
  key?: string;
  install_id: string;
  tenant_id?: TenantId;
  name?: string;
  host: HostInfo;
  versions?: Versions;
  cs2_build?: number;
}

export interface EnrollResponse {
  success: true;
  server_id: string;
  tenant_id: TenantId;
  name?: string;
  token: string;
  ws_url: string;
  reenrolled: boolean;
}

/** WebSocket close codes (FLEET.md §6.3). */
export const FLEET_CLOSE = {
  NORMAL: 1000,
  GOING_AWAY: 1001,
  PROTOCOL_ERROR: 4400,
  BAD_TOKEN: 4401,
  REVOKED: 4403,
  REPLACED: 4409,
  UNSUPPORTED_PROTOCOL: 4426,
  RATE_LIMITED: 4429,
  DRAINING: 4503,
} as const;
