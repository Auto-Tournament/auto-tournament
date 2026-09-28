/**
 * Fleet protocol v1 (server channel), as TypeScript. Hand-written next to the
 * JSON Schemas in this folder, which are normative (FLEET.md D18): Ready Up's
 * and csm's CI copy the `*.json` files and validate against them, and
 * `tests/api/fleet-protocol.spec.ts` checks that the examples below still
 * pass the schemas.
 *
 * Step 1 covers the envelope, the handshake (hello / welcome), heartbeat
 * (ping / pong), standalone ack, error, token rotation (auth.rotate /
 * auth.rotated) and a placeholder server.config.
 *
 * Step 3 (match control, FLEET.md §7-§9) and D13 (admins / skins over the
 * link) add `match.defs.json` and the match.*, cmd, cmd.result, state.*,
 * server.availability, event.*, admins.set and skins.* messages. Ready Up
 * proposed them (its `plugins/fleet/protocol/v1`, "proposed" section); they
 * are adopted here unchanged and the types below follow those schemas.
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
  /** Rev of the admins.set list the server has cached (D13); absent = none. */
  admins_rev?: number;
  /** Plugins the core did not load on this CS2 build (informational). */
  plugins_disabled?: { name: string; reason: string }[];
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

// --- step 3: match state (match.defs.json) ---------------------------------

export type TeamKey = 'team1' | 'team2';
export type Side = 'ct' | 't';
export type MapSides = 'team1_ct' | 'team2_ct' | 'knife';
export type PlayerRole = 'player' | 'sub' | 'coach';
export type MatchPhase =
  | 'loading'
  | 'warmup'
  | 'knife'
  | 'side_pick'
  | 'live'
  | 'paused'
  | 'halftime'
  | 'overtime'
  | 'map_end'
  | 'series_end'
  | 'restoring'
  | 'error';
export type PauseType = 'tactical' | 'technical' | 'admin' | 'offline' | 'halftime' | 'auto_5v5';

export interface Score {
  team1: number;
  team2: number;
}

/** `rules` (§7.1); every member optional. The schema is the full reference. */
export interface MatchRules {
  max_rounds?: number;
  overtime?: { enabled?: boolean; rounds_per_half?: number; max_overtimes?: number };
  tiebreak?: { damage?: boolean; sudden_death_on_tie?: boolean };
  ready?: { min_per_team?: number; allow_force_ready?: boolean; autoready?: boolean };
  knife?: { side_pick_seconds?: number };
  pause?: {
    tactical_per_team?: number;
    tactical_seconds?: number;
    technical_per_team?: number;
    unpause?: 'both_teams' | 'caller_team';
    pause_after_restore?: boolean;
  };
  whitelist?: boolean;
  playout?: boolean;
  clinch_series?: boolean;
  forfeit?: {
    team_absent_seconds?: number;
    gg_vote?: { enabled?: boolean; threshold?: number; min_score_diff?: number };
  };
  demo?: { record?: boolean; upload?: boolean };
  wingman?: boolean;
  simulation?: { timescale?: number };
  ruleset?: 'default' | 'valve';
  overrides?: Record<string, unknown>;
}

export interface AssignPlayer {
  steamid64: U64s;
  name: string;
  role?: PlayerRole;
}

export interface AssignTeam {
  id?: string;
  name: string;
  tag?: string;
  flag?: string;
  captain?: U64s;
  players: AssignPlayer[];
}

export interface AssignMap {
  /** 1-based position; the array order is authoritative. */
  number?: number;
  name: string;
  workshop_id?: string;
  sides: MapSides;
}

export interface AssignConfig {
  num_maps: number;
  maps: AssignMap[];
  team1: AssignTeam;
  team2: AssignTeam;
  spectators?: U64s[];
  admins?: U64s[];
  password: string;
  rules?: MatchRules;
  cvars?: Record<string, string | number | boolean>;
}

/** A round backup inline (§12.3); files over 384 KiB come in parts. */
export interface InlineBackup {
  map_number: number;
  /** The round this backup starts (1-based). */
  round: number;
  file: string;
  size: number;
  sha256: string;
  score: Score;
  encoding: 'base64';
  data: string;
  part?: number;
  parts?: number;
}

/** `match.assign.resume` (failover, §11.3). */
export interface ResumeBlock {
  from_epoch?: number;
  map_number: number;
  round?: number;
  backup?: InlineBackup;
  backup_ref?: { file?: string; sha256?: string };
  series_score?: Score;
  maps?: Record<string, { score?: Score; winner?: TeamKey | 'none' }>;
  sides?: 'team1_ct' | 'team2_ct';
  score?: Score;
  map_stats?: MapStats;
  state?: MatchState;
}

/** match_stats.h PlayerStats: one player's map totals. */
export interface FleetPlayerStats {
  kills: number;
  deaths: number;
  assists: number;
  flash_assists?: number;
  team_kills?: number;
  suicides?: number;
  headshot_kills?: number;
  knife_kills?: number;
  damage: number;
  utility_damage?: number;
  enemies_flashed?: number;
  friendlies_flashed?: number;
  bomb_plants?: number;
  bomb_defuses?: number;
  entry_kills_t?: number;
  entry_kills_ct?: number;
  entry_deaths_t?: number;
  entry_deaths_ct?: number;
  trade_kills?: number;
  traded_deaths?: number;
  kast_rounds?: number;
  rounds_played: number;
  mvp?: number;
  score?: number;
  multi_kills?: number[];
  clutches_won?: number[];
}

/** One player's line in one round. `team` 1/2 = team1/team2 (0 = none); `side` 2 = T, 3 = CT. */
export interface PlayerRound {
  id: U64s;
  team: 0 | 1 | 2;
  side: 0 | 2 | 3;
  kills: number;
  assists?: number;
  flash_assists?: number;
  damage: number;
  utility_damage?: number;
  headshot_kills?: number;
  died: boolean;
  survived?: boolean;
  traded?: boolean;
  kast?: boolean;
  entry_kill?: boolean;
  entry_death?: boolean;
  mvp?: boolean;
  clutch_vs?: number;
  clutch_won?: boolean;
}

export interface RoundSummary {
  round_number: number;
  winner_side: 0 | 2 | 3;
  winner_team: 0 | 1 | 2;
  reason: number;
  /** Map score after this round. */
  team1_score: number;
  team2_score: number;
  team1_was_ct: boolean;
  players: PlayerRound[];
}

export interface PlayerLine {
  id: U64s;
  name: string;
  team: 0 | 1 | 2;
  last_side?: 0 | 2 | 3;
  /** Dev-bot id range: dropped unless the match is a simulation (§13). */
  bot: boolean;
  stats: FleetPlayerStats;
}

/** match_stats.h MapStats: the source of truth for map totals (§13). */
export interface MapStats {
  live: boolean;
  team1_is_ct: boolean;
  team1: { score: number; score_ct: number; score_t: number };
  team2: { score: number; score_ct: number; score_t: number };
  players: PlayerLine[];
  rounds: RoundSummary[];
}

export interface StateTeam {
  id?: string;
  name: string;
  tag?: string;
  /** Absent = not known yet. */
  side?: Side;
  score: number;
  score_ct?: number;
  score_t?: number;
  players: Record<
    U64s,
    { name?: string; role?: PlayerRole; connected: boolean; ready: boolean; alive?: boolean }
  >;
}

export interface StateMap {
  name: string;
  workshop_id?: string;
  sides: MapSides;
  status: 'pending' | 'live' | 'done';
  score?: Score;
  winner?: TeamKey | 'none';
  demo?: { file?: string; state: 'recording' | 'stopped' | 'uploading' | 'stored' | 'failed' };
}

/**
 * The canonical match object (§9.1). Never contains `null` values: an absent
 * member means "unknown / none". Platform-owned: match_id, epoch, config_rev,
 * team names / ids / tags, rosters, spectators, rules, the map list and
 * sides; the server owns the rest (§9.2).
 */
export interface MatchState {
  match_id: string;
  epoch: number;
  server_id?: string;
  config_rev: number;
  live_rev: number;
  phase: MatchPhase;
  series: {
    num_maps: number;
    /** 1-based. */
    current_map: number;
    score: Score;
    /** Keyed by the 1-based map number ("1".."9"). */
    maps: Record<string, StateMap>;
  };
  teams: { team1: StateTeam; team2: StateTeam };
  spectators?: Record<U64s, { name?: string; connected: boolean }>;
  ready?: { required_per_team?: number; countdown_ends_at?: number; ready?: number; total?: number };
  knife?: { status: 'none' | 'running' | 'picking' | 'done'; winner?: TeamKey | 'unknown'; pick_deadline?: number };
  pause?: {
    active: boolean;
    type?: PauseType;
    by?: string;
    started_at?: number;
    unpause?: { team1?: boolean; team2?: boolean };
    used?: Record<TeamKey, { tactical?: number; technical?: number }>;
  };
  round?: { number: number; started_at?: number; overtime?: number };
  backups?: { latest_round?: number };
  rules?: MatchRules;
  ruleset?: 'default' | 'valve';
  effective_rules?: Record<string, unknown>;
}

/** RFC 7386 JSON merge patch on MatchState (`null` removes a member, arrays are replaced whole). */
export type MatchStatePatch = Record<string, unknown>;

// --- step 3: platform -> server ---------------------------------------------

export interface MatchAssignPayload {
  match_id: string;
  epoch: number;
  /** The platform's config counter (default 1): the CAS base for match.update. */
  config_rev?: number;
  config: AssignConfig;
  resume?: ResumeBlock;
}

export type MatchUpdateOp =
  | { op: 'add_player'; team: TeamKey | 'spectator'; steamid64: U64s; name: string; role?: PlayerRole }
  | { op: 'remove_player'; steamid64: U64s }
  | { op: 'rename_team'; team: TeamKey; name: string }
  | { op: 'set_password'; password: string }
  | { op: 'set_rules'; rules: MatchRules };

export interface MatchUpdatePayload {
  match_id: string;
  epoch: number;
  /** The config_rev the platform last saw acked. */
  base_config_rev: number;
  config_rev: number;
  ops: MatchUpdateOp[];
}

export type UnassignReason = 'ended' | 'cancelled' | 'superseded' | 'moved' | 'admin';

export interface MatchUnassignPayload {
  match_id: string;
  epoch: number;
  reason: UnassignReason;
  kick_message?: string;
}

export type CmdName =
  | 'pause'
  | 'unpause'
  | 'force_ready'
  | 'start'
  | 'restore_round'
  | 'restart_map'
  | 'end_match'
  | 'change_map'
  | 'swap_teams'
  | 'kick'
  | 'say'
  | 'snapshot_now'
  | 'exec'
  | 'restart_round'
  | 'end'
  | 'plugins.set'
  | 'whitelist.set'
  | 'practice.set'
  | 'settings.set';

export interface CmdPayload {
  match_id?: string;
  epoch?: number;
  name: CmdName;
  args: Record<string, unknown>;
  issued_by: { user_id: string; name: string; root: boolean };
  /** Unix ms; 0 = never. A past one is answered `expired`, not run. */
  expires_at: number;
  audit_id?: string;
}

export type StateRequestPayload = Record<string, never>;

export interface AdminsSetPayload {
  rev: number;
  admins: { steamid64: U64s; name: string }[];
}

export interface SkinsLoadoutPayload {
  steamid64: U64s;
  rev: number;
  items: {
    paints: {
      team: 0 | 2 | 3;
      defindex: number;
      paint: number;
      wear: number;
      seed: number;
      nametag?: string;
      stattrak?: number;
    }[];
    knife?: { team: 0 | 2 | 3; defindex: number }[];
    gloves?: { team: 0 | 2 | 3; defindex: number }[];
    agents?: { team: 2 | 3; model: string }[];
    music?: number;
  };
}

export interface SkinsInvalidatePayload {
  steamid64: U64s;
}

// --- step 3: server -> platform ---------------------------------------------

export type CmdResultStatus = 'ok' | 'rejected' | 'failed' | 'expired';

/** The one answer to every match.* / cmd message; envelope `ref` = that message's id. */
export interface CmdResultPayload {
  status: CmdResultStatus;
  error?: { code: string; message?: string };
  /** config_rev after a match.update (or the server's on `conflict`). */
  rev?: number;
  output?: string;
  audit_id?: string;
}

export type SnapshotReason = 'hello' | 'request' | 'reset' | 'periodic' | 'assign' | 'restored';

export interface StateSnapshotPayload {
  reason: SnapshotReason;
  /** null = idle server. */
  state: MatchState | null;
  availability: Availability;
  config_rev: number;
  admins_rev: number;
  map_stats?: MapStats;
}

export interface StatePatchPayload {
  match_id: string;
  rev: number;
  patch: MatchStatePatch;
}

export interface ServerAvailabilityPayload {
  availability: Availability;
  reason: string;
}

export interface SkinsStattrakPayload {
  increments: { steamid64: U64s; defindex: number; kills: number }[];
}

// --- Demo streaming (FLEET.md §12.2, §12.4) -------------------------------

/** Server -> platform (ephemeral): a demo that streams while it records; asks where to resume. */
export interface DemoBeginPayload {
  demo_id: Ulid;
  match_id: string;
  /** 1-based. */
  map_number: number;
  /** Basename of the .dem on the server. */
  file: string;
  /** Recording start, unix ms. */
  started_at: number;
  /** Every chunk starts at a multiple of this and is this long, except the last one. */
  chunk_size: number;
  /** true while the file may still grow. */
  recording: boolean;
  /** true: drop every byte stored for this demo and answer offset 0. */
  restart?: boolean;
}

/** Server -> platform (ephemeral, lowest priority): bytes [offset, offset + size). */
export interface DemoChunkPayload {
  demo_id: Ulid;
  offset: number;
  size: number;
  /** Standard base64 with padding. */
  data: string;
}

/** Server -> platform (ephemeral, lowest priority): the file is final. */
export interface DemoEndPayload {
  demo_id: Ulid;
  size: number;
  /** Lowercase hex. */
  sha256: string;
}

export type DemoAckErrorCode =
  | 'gap'
  | 'unknown_demo'
  | 'checksum'
  | 'storage'
  | 'not_assigned'
  | 'stale_epoch'
  | 'too_large';

/** Platform -> server (ephemeral): the answer to demo.begin / demo.chunk / demo.end. */
export interface DemoAckPayload {
  demo_id: Ulid;
  /** Bytes stored contiguously from 0. */
  offset: number;
  /** Only after a demo.end whose size and sha256 matched the stored copy. */
  complete?: boolean;
  error?: { code: DemoAckErrorCode; message?: string };
}

/** Every `event.*` payload: a merge patch with its rev, plus the event's `data`. */
export interface FleetEventPayload<D = Record<string, unknown>> {
  match_id: string;
  /** 1-based. */
  map_number: number;
  round?: number;
  rev: number;
  patch: MatchStatePatch;
  data: D;
}

export type PresenceTeam = TeamKey | 'spectator' | 'none';

export interface FleetEventData {
  player_connect: { steamid64: U64s; name: string; team: PresenceTeam };
  player_disconnect: { steamid64: U64s; name: string; team: PresenceTeam; reason?: string };
  player_team: { steamid64: U64s; team: PresenceTeam; side: Side | 'spectator' | 'none' };
  player_ready: { steamid64: U64s; team: TeamKey; ready_team1: number; ready_team2: number; required: number };
  player_unready: { steamid64: U64s; team: TeamKey; ready_team1: number; ready_team2: number; required: number };
  phase: { from: MatchPhase; to: MatchPhase; reason: string };
  knife_result: { winner: TeamKey; reason: 'elimination' | 'alive' | 'hp' | 'coin' };
  side_picked: { team: TeamKey; side: Side; picked_by: U64s | 'timeout' | 'console' };
  round_start: { round: number; score?: Score };
  round_end: { round: RoundSummary };
  backup: InlineBackup;
  pause: {
    action: 'paused' | 'unpause_requested' | 'unpaused';
    type: PauseType;
    by: string;
    team?: TeamKey;
    duration_s?: number;
  };
  halftime: { score: Score };
  overtime: { score: Score; overtime_number: number };
  rounds_voided: { from_round: number; reason: 'restore' | 'restart_map' | 'resume' };
  map_result: {
    type: 'map_result';
    matchid?: string;
    slug?: string;
    scrim?: false;
    winner: TeamKey | 'none';
    team1_name?: string;
    team2_name?: string;
    team1_series_score: number;
    team2_series_score: number;
    map_number: number;
    map_name: string;
    team1_score: number;
    team2_score: number;
    series_over: boolean;
    next_map?: string;
    demo_recorded?: boolean;
    demo_upload_configured?: boolean;
    stats: MapStats;
  };
  series_end: {
    type: 'series_end';
    matchid?: string;
    slug?: string;
    scrim?: false;
    winner: TeamKey | 'none';
    team1_name?: string;
    team2_name?: string;
    team1_series_score: number;
    team2_series_score: number;
    seconds_until_reset?: number;
    /** true = an admin's `end_match`. */
    forced?: boolean;
    reason?: string;
  };
  demo: {
    type: 'recording_started' | 'recording_stopped' | 'upload_started' | 'upload_succeeded' | 'upload_failed';
    matchid?: number;
    map_number: number;
    file_name: string;
    path?: string;
    size_mb?: number;
    http_status?: number;
    error?: string;
    attempts?: number;
  };
  match_restored: {
    map_number: number;
    round: number;
    backup_sha256: string;
    file?: string;
    resume?: boolean;
    from_epoch?: number;
  };
  forfeit: { team: TeamKey; reason: string; steamid64?: U64s };
  gg: { team: TeamKey | 'unknown'; reason: string; steamid64?: U64s };
  admin_called: {
    call_id: string;
    player: { steamid64: U64s; name: string; team: TeamKey | 'spectator' | null; side: Side | null };
    message: string;
    called_at: string;
  };
  error: { code: string; message: string; fatal: boolean };
}

export type FleetEventName = keyof FleetEventData;
export type FleetEventType = `event.${FleetEventName}`;

export const FLEET_EVENT_NAMES: ReadonlyArray<FleetEventName> = [
  'player_connect',
  'player_disconnect',
  'player_team',
  'player_ready',
  'player_unready',
  'phase',
  'knife_result',
  'side_picked',
  'round_start',
  'round_end',
  'backup',
  'pause',
  'halftime',
  'overtime',
  'rounds_voided',
  'map_result',
  'series_end',
  'demo',
  'match_restored',
  'forfeit',
  'gg',
  'admin_called',
  'error',
];

export function isFleetEventType(type: string): type is FleetEventType {
  return type.startsWith('event.') && (FLEET_EVENT_NAMES as readonly string[]).includes(type.slice(6));
}

/**
 * Server messages whose loss would lose a result (FLEET.md §6.5 "critical",
 * plus the ones the step-3 notes add): Ready Up never drops them from its spool.
 */
export const FLEET_CRITICAL_TYPES: ReadonlySet<string> = new Set([
  'event.round_end',
  'event.backup',
  'event.map_result',
  'event.series_end',
  'event.demo',
  'event.rounds_voided',
  'event.match_restored',
  'event.forfeit',
  'cmd.result',
  'skins.stattrak',
]);

/** Platform -> server messages answered by exactly one `cmd.result` (envelope `ref` = their id). */
export const FLEET_ANSWERED_TYPES: ReadonlySet<string> = new Set([
  'match.assign',
  'match.update',
  'match.unassign',
  'cmd',
]);

/** Every message type, its payload, direction and reliability. */
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
  'match.assign': MatchAssignPayload;
  'match.update': MatchUpdatePayload;
  'match.unassign': MatchUnassignPayload;
  cmd: CmdPayload;
  'cmd.result': CmdResultPayload;
  'state.request': StateRequestPayload;
  'state.snapshot': StateSnapshotPayload;
  'state.patch': StatePatchPayload;
  'server.availability': ServerAvailabilityPayload;
  'admins.set': AdminsSetPayload;
  'skins.loadout': SkinsLoadoutPayload;
  'skins.invalidate': SkinsInvalidatePayload;
  'skins.stattrak': SkinsStattrakPayload;
  'event.player_connect': FleetEventPayload<FleetEventData['player_connect']>;
  'event.player_disconnect': FleetEventPayload<FleetEventData['player_disconnect']>;
  'event.player_team': FleetEventPayload<FleetEventData['player_team']>;
  'event.player_ready': FleetEventPayload<FleetEventData['player_ready']>;
  'event.player_unready': FleetEventPayload<FleetEventData['player_unready']>;
  'event.phase': FleetEventPayload<FleetEventData['phase']>;
  'event.knife_result': FleetEventPayload<FleetEventData['knife_result']>;
  'event.side_picked': FleetEventPayload<FleetEventData['side_picked']>;
  'event.round_start': FleetEventPayload<FleetEventData['round_start']>;
  'event.round_end': FleetEventPayload<FleetEventData['round_end']>;
  'event.backup': FleetEventPayload<FleetEventData['backup']>;
  'event.pause': FleetEventPayload<FleetEventData['pause']>;
  'event.halftime': FleetEventPayload<FleetEventData['halftime']>;
  'event.overtime': FleetEventPayload<FleetEventData['overtime']>;
  'event.rounds_voided': FleetEventPayload<FleetEventData['rounds_voided']>;
  'event.map_result': FleetEventPayload<FleetEventData['map_result']>;
  'event.series_end': FleetEventPayload<FleetEventData['series_end']>;
  'event.demo': FleetEventPayload<FleetEventData['demo']>;
  'event.match_restored': FleetEventPayload<FleetEventData['match_restored']>;
  'event.forfeit': FleetEventPayload<FleetEventData['forfeit']>;
  'event.gg': FleetEventPayload<FleetEventData['gg']>;
  'event.admin_called': FleetEventPayload<FleetEventData['admin_called']>;
  'event.error': FleetEventPayload<FleetEventData['error']>;
  'demo.begin': DemoBeginPayload;
  'demo.chunk': DemoChunkPayload;
  'demo.end': DemoEndPayload;
  'demo.ack': DemoAckPayload;
}

export type FleetMessageType = keyof FleetMessages;

export type Direction = 'server_to_platform' | 'platform_to_server' | 'both';

const P2S_RELIABLE = { direction: 'platform_to_server', reliable: true } as const;
const S2P_RELIABLE = { direction: 'server_to_platform', reliable: true } as const;

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
  'match.assign': P2S_RELIABLE,
  'match.update': P2S_RELIABLE,
  'match.unassign': P2S_RELIABLE,
  cmd: P2S_RELIABLE,
  'state.request': { direction: 'platform_to_server', reliable: false },
  'admins.set': P2S_RELIABLE,
  'skins.loadout': P2S_RELIABLE,
  'skins.invalidate': P2S_RELIABLE,
  'cmd.result': S2P_RELIABLE,
  'state.snapshot': { direction: 'server_to_platform', reliable: false },
  'state.patch': S2P_RELIABLE,
  'server.availability': S2P_RELIABLE,
  'skins.stattrak': S2P_RELIABLE,
  'event.player_connect': S2P_RELIABLE,
  'event.player_disconnect': S2P_RELIABLE,
  'event.player_team': S2P_RELIABLE,
  'event.player_ready': S2P_RELIABLE,
  'event.player_unready': S2P_RELIABLE,
  'event.phase': S2P_RELIABLE,
  'event.knife_result': S2P_RELIABLE,
  'event.side_picked': S2P_RELIABLE,
  'event.round_start': S2P_RELIABLE,
  'event.round_end': S2P_RELIABLE,
  'event.backup': S2P_RELIABLE,
  'event.pause': S2P_RELIABLE,
  'event.halftime': S2P_RELIABLE,
  'event.overtime': S2P_RELIABLE,
  'event.rounds_voided': S2P_RELIABLE,
  'event.map_result': S2P_RELIABLE,
  'event.series_end': S2P_RELIABLE,
  'event.demo': S2P_RELIABLE,
  'event.match_restored': S2P_RELIABLE,
  'event.forfeit': S2P_RELIABLE,
  'event.gg': S2P_RELIABLE,
  'event.admin_called': S2P_RELIABLE,
  'event.error': S2P_RELIABLE,
  'demo.begin': { direction: 'server_to_platform', reliable: false },
  'demo.chunk': { direction: 'server_to_platform', reliable: false },
  'demo.end': { direction: 'server_to_platform', reliable: false },
  'demo.ack': { direction: 'platform_to_server', reliable: false },
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
