/**
 * The fleet **host channel** protocol v1 (FLEET.md §18, D17): csm (CS2 Server
 * Manager) as each machine's host agent, on `/api/fleet/host`.
 *
 * The `*.json` files next to this are the contract (D18). They were first
 * written by csm (Auto-Tournament/cs2-server-manager `protocol/host-v1/`,
 * PR #66) from the same §18 and are adopted here unchanged, so csm's CI can
 * copy them back from this folder. Same envelope and transport rules as the
 * server channel (§5, §6); only the identity (`rhs_` host tokens, `host_id`,
 * `machine_id`) and the messages differ. csm's additions to §18.2 are marked
 * in the schema descriptions (`server.create.enroll_key`, `expires_at`).
 */

import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020';
import defs from './defs.json';
import envelope from './envelope.json';
import enrollRequest from './http/enroll.request.json';
import enrollResponse from './http/enroll.response.json';
import hello from './messages/hello.json';
import welcome from './messages/welcome.json';
import ping from './messages/ping.json';
import pong from './messages/pong.json';
import ack from './messages/ack.json';
import error from './messages/error.json';
import authRotate from './messages/auth.rotate.json';
import authRotated from './messages/auth.rotated.json';
import serversList from './messages/host.servers.list.json';
import serverStart from './messages/server.start.json';
import serverStop from './messages/server.stop.json';
import serverRestart from './messages/server.restart.json';
import serverCreate from './messages/server.create.json';
import serverRemove from './messages/server.remove.json';
import serverSetLaunchArgs from './messages/server.set_launch_args.json';
import updateGame from './messages/host.update_game.json';
import updatePlugins from './messages/host.update_plugins.json';
import updatesHold from './messages/host.updates_hold.json';
import hostLicense from './messages/host.license.json';
import logsTail from './messages/logs.tail.json';
import logsStop from './messages/logs.stop.json';
import inventory from './messages/host.inventory.json';
import health from './messages/host.health.json';
import result from './messages/host.result.json';
import progress from './messages/host.progress.json';
import logsChunk from './messages/logs.chunk.json';

export const HOST_PROTOCOL_SUPPORTED = { min: 1, max: 1 } as const;

// --- payloads ------------------------------------------------------------------

export interface HostForce {
  /** The admin (Steam ID or token label) who confirmed it. */
  by: string;
  reason: string;
}

export interface HostHelloPayload {
  host_id: string;
  /** First 32 hex chars of sha256("auto-tournament-host:" + /etc/machine-id). */
  machine_id: string;
  tenant_id: 'default';
  protocol: { min: number; max: number };
  versions: { csm: string; os?: string };
  capabilities: string[];
  hostname: string;
  boot_id: string;
  stream: { id: string; last_tx_seq: number; last_rx_seq: number };
}

export interface HostWelcomePayload {
  session_id: string;
  protocol: number;
  heartbeat: { interval_ms: number; timeout_ms: number };
  resume: { result: 'resumed' | 'reset'; platform_last_rx_seq: number };
  host_id?: string;
}

export type ReadyUpHealth = 'ok' | 'failing' | 'no_response' | 'not_running';
export type UpdatesHoldMode = 'on' | 'off' | 'auto';

export interface HostInventoryServer {
  name: string;
  dir: string;
  game_port: number;
  tv_port?: number;
  status_port: number;
  process: {
    running: boolean;
    pid?: number;
    started_at?: number;
    restarts_24h: number;
    cpu_pct?: number;
    rss_mb?: number;
  };
  readyup: {
    installed: string | null;
    install_id?: string;
    server_id?: string;
    health: ReadyUpHealth;
    phase?: string;
    update_safe?: boolean;
  };
  cs2_build: number;
  launch_args: string[];
}

export interface HostInventoryPayload {
  host_id: string;
  hostname: string;
  csm_version: string;
  os: string;
  /** This machine's address (csm 1.21+): where its servers' players connect unless a server reports its own. */
  address?: string;
  resources: {
    cpus: number;
    load1: number;
    ram_mb: number;
    ram_free_mb: number;
    disk: Array<{ mount: string; total_gb: number; free_gb: number }>;
  };
  cs2: {
    master_build: number;
    master_patch?: string;
    update_available: boolean;
    updates_hold: UpdatesHoldMode;
  };
  servers: HostInventoryServer[];
}

export type HostHealthEvent = 'crashed' | 'exited' | 'hung' | 'recovered' | 'restarted';

export interface HostHealthPayload {
  server: string;
  event: HostHealthEvent;
  exit_code?: number;
  detail?: string;
}

export type HostResultStatus = 'ok' | 'rejected' | 'failed';

export interface HostResultPayload {
  status: HostResultStatus;
  error?: { code: string; message?: string };
  output?: string;
}

export interface HostProgressPayload {
  ref: string;
  step: string;
  pct?: number;
}

/** Every command may carry `expires_at` (unix ms): later, csm answers `rejected / expired` without running it. */
interface Expiring {
  expires_at?: number;
}

/** Platform → host commands and their payloads (FLEET.md §18.2, plus csm's additions). */
export interface HostCommands {
  'host.servers.list': Expiring;
  'server.start': Expiring & { server: string; launch_mode?: 'default' | 'alternate' | 'binary' };
  'server.stop': Expiring & { server: string; grace_s?: number; force?: HostForce };
  'server.restart': Expiring & { server: string; reason: string; force?: HostForce };
  'server.create': Expiring & {
    count?: number;
    /** csm only accepts "server-". */
    name_prefix?: string;
    /** csm only accepts the next +10 port. */
    game_port?: number;
    enroll: boolean;
    /** csm addition: the fleet key the new servers enroll with (minted per command at send time). */
    enroll_key?: string;
    /** csm addition: the Ready Up license use accepted on the platform (added at send time). */
    accept_license?: 'noncommercial' | 'commercial';
  };
  'server.remove': Expiring & { server: string; keep_files?: boolean; force?: HostForce };
  'server.set_launch_args': Expiring & { server: string; args: string[]; force?: HostForce };
  'host.update_game': Expiring & { servers?: string[]; force?: HostForce };
  'host.update_plugins': Expiring & {
    servers?: string[];
    readyup: { version: string; bundle: 'default' | 'skins' };
    force?: HostForce;
    /** csm addition: as on server.create. */
    accept_license?: 'noncommercial' | 'commercial';
  };
  'host.updates_hold': Expiring & { mode: UpdatesHoldMode };
  /** The platform's license for the servers it owns on the host (csm with the license.push capability). */
  'host.license': Expiring & {
    key: string | null;
    lease?: string;
    state?: { status: string; stops_on?: string; valid_until?: string };
    use?: 'noncommercial' | 'commercial';
    revision?: string;
  };
  'logs.tail': Expiring & {
    server?: string;
    source: 'console' | 'readyup' | 'csm' | 'monitor';
    lines?: number;
    follow?: boolean;
    max_s?: number;
  };
  'logs.stop': Expiring & { stream_id: string };
}

export type HostCommandType = keyof HostCommands;

export const HOST_COMMAND_TYPES: ReadonlyArray<HostCommandType> = [
  'host.servers.list',
  'server.start',
  'server.stop',
  'server.restart',
  'server.create',
  'server.remove',
  'server.set_launch_args',
  'host.update_game',
  'host.update_plugins',
  'host.updates_hold',
  'host.license',
  'logs.tail',
  'logs.stop',
];

/**
 * Commands that interrupt a match. Without `force`, csm refuses them for a
 * server whose `/status` says `update_safe: false` (§18.2), and the platform
 * refuses to send them for such a server in the first place.
 */
export const HOST_DISRUPTIVE_TYPES: ReadonlySet<HostCommandType> = new Set<HostCommandType>([
  'server.stop',
  'server.restart',
  'server.remove',
  'server.set_launch_args',
  'host.update_game',
  'host.update_plugins',
]);

export type HostDirection = 'host_to_platform' | 'platform_to_host' | 'both';

/** Every host-channel message: direction and whether the platform sends it reliably. */
export const HOST_MESSAGES: Record<string, { direction: HostDirection; reliable: boolean }> = {
  hello: { direction: 'host_to_platform', reliable: false },
  welcome: { direction: 'platform_to_host', reliable: false },
  ping: { direction: 'both', reliable: false },
  pong: { direction: 'both', reliable: false },
  ack: { direction: 'both', reliable: false },
  error: { direction: 'both', reliable: false },
  'auth.rotate': { direction: 'platform_to_host', reliable: true },
  // Host → platform: `reliable` says what csm should use; the platform accepts
  // a host → platform message with or without `seq` (and acks it when it has one).
  'auth.rotated': { direction: 'host_to_platform', reliable: true },
  'host.result': { direction: 'host_to_platform', reliable: true },
  'host.health': { direction: 'host_to_platform', reliable: true },
  'host.inventory': { direction: 'host_to_platform', reliable: false },
  'host.progress': { direction: 'host_to_platform', reliable: false },
  'logs.chunk': { direction: 'host_to_platform', reliable: false },
  ...Object.fromEntries(
    HOST_COMMAND_TYPES.map((t) => [t, { direction: 'platform_to_host' as const, reliable: true }])
  ),
};

export const HOST_MESSAGE_SCHEMAS: Record<string, Record<string, unknown>> = {
  hello,
  welcome,
  ping,
  pong,
  ack,
  error,
  'auth.rotate': authRotate,
  'auth.rotated': authRotated,
  'host.servers.list': serversList,
  'server.start': serverStart,
  'server.stop': serverStop,
  'server.restart': serverRestart,
  'server.create': serverCreate,
  'server.remove': serverRemove,
  'server.set_launch_args': serverSetLaunchArgs,
  'host.update_game': updateGame,
  'host.update_plugins': updatePlugins,
  'host.updates_hold': updatesHold,
  'host.license': hostLicense,
  'logs.tail': logsTail,
  'logs.stop': logsStop,
  'host.inventory': inventory,
  'host.health': health,
  'host.result': result,
  'host.progress': progress,
  'logs.chunk': logsChunk,
};

export const HOST_SCHEMAS = {
  defs,
  envelope,
  messages: HOST_MESSAGE_SCHEMAS,
  http: { enrollRequest, enrollResponse },
} as const;

/** `POST /api/fleet/enroll` with `kind: "host"` (FLEET.md §18.1). */
export interface HostEnrollRequest {
  kind: 'host';
  code?: string;
  key?: string;
  machine_id: string;
  tenant_id?: 'default';
  hostname: string;
  os: string;
  csm_version: string;
}

export interface HostEnrollResponse {
  success: true;
  host_id: string;
  tenant_id?: 'default';
  name?: string;
  token: string;
  /** csm defaults to the enroll URL's origin + /api/fleet/host. */
  ws_url?: string;
  reenrolled?: boolean;
}

// --- validation ------------------------------------------------------------------

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

function describe(errors: ErrorObject[] | null | undefined, prefix = ''): string[] {
  return (errors ?? [])
    .slice(0, 10)
    .map((e) => `${prefix + e.instancePath || '/'} ${e.message ?? 'is invalid'}`);
}

let compiled: {
  envelope: ValidateFunction;
  messages: Map<string, ValidateFunction>;
  enrollRequest: ValidateFunction;
  enrollResponse: ValidateFunction;
} | null = null;

function validators() {
  if (compiled) return compiled;
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    strictRequired: false,
    allowUnionTypes: true,
  });
  ajv.addSchema(defs);
  const messages = new Map<string, ValidateFunction>();
  for (const [type, schema] of Object.entries(HOST_MESSAGE_SCHEMAS))
    messages.set(type, ajv.compile(schema));
  compiled = {
    envelope: ajv.compile(envelope),
    messages,
    enrollRequest: ajv.compile(enrollRequest),
    enrollResponse: ajv.compile(enrollResponse),
  };
  return compiled;
}

export function isKnownHostMessageType(type: string): boolean {
  return Object.prototype.hasOwnProperty.call(HOST_MESSAGE_SCHEMAS, type);
}

export function isHostCommandType(type: unknown): type is HostCommandType {
  return typeof type === 'string' && (HOST_COMMAND_TYPES as readonly string[]).includes(type);
}

export function validateHostEnvelope(value: unknown): ValidationResult {
  const v = validators().envelope;
  const ok = v(value) as boolean;
  return { ok, errors: ok ? [] : describe(v.errors) };
}

export function validateHostPayload(type: string, payload: unknown): ValidationResult {
  const v = validators().messages.get(type);
  if (!v) return { ok: false, errors: [`unknown type ${type}`] };
  const ok = v(payload) as boolean;
  return { ok, errors: ok ? [] : describe(v.errors, '/payload') };
}

/** Envelope and payload (tests, and the host gateway's outbound self-check). */
export function validateHostMessage(value: unknown): ValidationResult {
  const env = validateHostEnvelope(value);
  if (!env.ok) return env;
  const msg = value as { type: string; payload: unknown };
  return validateHostPayload(msg.type, msg.payload);
}

export function validateHostEnrollRequest(value: unknown): ValidationResult {
  const v = validators().enrollRequest;
  const ok = v(value) as boolean;
  return { ok, errors: ok ? [] : describe(v.errors) };
}

export function validateHostEnrollResponse(value: unknown): ValidationResult {
  const v = validators().enrollResponse;
  const ok = v(value) as boolean;
  return { ok, errors: ok ? [] : describe(v.errors) };
}
