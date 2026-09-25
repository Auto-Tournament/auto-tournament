/**
 * Auto Tournament CS2 event types.
 *
 * Auto Tournament CS2 is forked from MatchZy by shobhit-pathak, and its events
 * keep the upstream schema: https://shobhit-pathak.github.io/MatchZy/events.html
 *
 * Note: Auto Tournament CS2 implements a subset of Get5 events compatible with CS2
 */

export interface PluginBaseEvent {
  event: string;
  matchid: string | number;
}

// Series Events
export interface SeriesStartEvent extends PluginBaseEvent {
  event: 'series_start';
  team1_name: string;
  team2_name: string;
  num_maps: number;
}

export interface SeriesEndEvent extends PluginBaseEvent {
  event: 'series_end';
  team1_series_score: number;
  team2_series_score: number;
  winner: 'team1' | 'team2' | 'none';
  time_until_restore: number;
}

// Map Events
export interface MapResultEvent extends PluginBaseEvent {
  event: 'map_result';
  map_number: number;
  map_name: string;
  team1_score: number;
  team2_score: number;
  winner: string;
}

export interface MapPickedEvent extends PluginBaseEvent {
  event: 'map_picked';
  map_name: string;
  map_number: number;
  picked_by: string;
}

export interface SidePickedEvent extends PluginBaseEvent {
  event: 'side_picked';
  map_name: string;
  map_number: number;
  side: string;
  picked_by: string;
}

export interface MapVetoedEvent extends PluginBaseEvent {
  event: 'map_vetoed';
  map_name: string;
  vetoed_by: string;
}

// Round Events
export interface RoundEndEvent extends PluginBaseEvent {
  event: 'round_end';
  map_number: number;
  round_number: number;
  round_time: number;
  reason: number; // CS2 round end reason
  winner: 'team1' | 'team2';
  team1_score: number;
  team2_score: number;
}

export interface RoundMVPEvent extends PluginBaseEvent {
  event: 'round_mvp';
  round_number: number;
  player: {
    steamid: string;
    name: string;
  };
  reason: number; // MVP reason code
}

// Player Events
export interface PlayerConnectEvent extends PluginBaseEvent {
  event: 'player_connect';
  player: {
    steamid: string;
    name: string;
    team: string;
  };
}

export interface PlayerDisconnectEvent extends PluginBaseEvent {
  event: 'player_disconnect';
  player: {
    steamid: string;
    name: string;
    team: string;
  };
}

// Player Ready Events
export interface PlayerReadyEvent extends PluginBaseEvent {
  event: 'player_ready';
  player: {
    steamid: string;
    name: string;
    team: string;
  };
  team: string;
  ready_count_team1: number;
  ready_count_team2: number;
  total_ready: number;
  expected_total: number;
}

export interface PlayerUnreadyEvent extends PluginBaseEvent {
  event: 'player_unready';
  player: {
    steamid: string;
    name: string;
    team: string;
  };
  team: string;
  ready_count_team1: number;
  ready_count_team2: number;
  total_ready: number;
  expected_total: number;
}

export interface TeamReadyEvent extends PluginBaseEvent {
  event: 'team_ready';
  team: 'team1' | 'team2';
  ready_count: number;
  total_ready: number;
  expected_total: number;
}

export interface AllPlayersReadyEvent extends PluginBaseEvent {
  event: 'all_players_ready';
  ready_count_team1: number;
  ready_count_team2: number;
  total_ready: number;
  countdown_started: boolean;
}

export interface PlayerDeathEvent extends PluginBaseEvent {
  event: 'player_death';
  attacker: {
    steamid: string;
    name: string;
    team: 'team1' | 'team2';
  };
  victim: {
    steamid: string;
    name: string;
    team: 'team1' | 'team2';
  };
  assister?: {
    steamid: string;
    name: string;
    team: 'team1' | 'team2';
  };
  weapon: string;
  headshot: boolean;
}

// Bomb Events
export interface BombPlantedEvent extends PluginBaseEvent {
  event: 'bomb_planted';
  player: {
    steamid: string;
    name: string;
    team: 'team1' | 'team2';
  };
  site: 'A' | 'B';
}

export interface BombDefusedEvent extends PluginBaseEvent {
  event: 'bomb_defused';
  player: {
    steamid: string;
    name: string;
    team: 'team1' | 'team2';
  };
  site: 'A' | 'B';
}

export interface BombExplodedEvent extends PluginBaseEvent {
  event: 'bomb_exploded';
  site: 'A' | 'B';
}

// Side Swap
export interface SideSwapEvent extends PluginBaseEvent {
  event: 'side_swap';
  map_number: number;
  team1_side?: string;
  team2_side?: string;
}

// Going Live
export interface GoingLiveEvent extends PluginBaseEvent {
  event: 'going_live';
  map_number: number;
}

// Match Phase Events
export interface WarmupEndedEvent extends PluginBaseEvent {
  event: 'warmup_ended';
  map_number: number;
}

export interface KnifeRoundStartedEvent extends PluginBaseEvent {
  event: 'knife_round_started';
  map_number: number;
}

export interface KnifeRoundEndedEvent extends PluginBaseEvent {
  event: 'knife_round_ended';
  map_number: number;
  winner: 'team1' | 'team2';
}

export interface RoundStartedEvent extends PluginBaseEvent {
  event: 'round_started';
  map_number: number;
  round_number: number;
  team1_score: number;
  team2_score: number;
}

export interface HalftimeStartedEvent extends PluginBaseEvent {
  event: 'halftime_started';
  map_number: number;
  team1_score: number;
  team2_score: number;
}

export interface OvertimeStartedEvent extends PluginBaseEvent {
  event: 'overtime_started';
  map_number: number;
  overtime_number: number;
}

// Pause System Events
export interface MatchPausedEvent extends PluginBaseEvent {
  event: 'match_paused';
  map_number: number;
  paused_by: {
    steamid: string;
    name: string;
    team: string;
  };
  is_tactical: boolean;
  is_admin: boolean;
  pause_time: number;
}

export interface UnpauseRequestedEvent extends PluginBaseEvent {
  event: 'unpause_requested';
  map_number: number;
  team: 'team1' | 'team2';
  teams_ready: number;
  teams_needed: number;
}

export interface MatchUnpausedEvent extends PluginBaseEvent {
  event: 'match_unpaused';
  map_number: number;
  pause_duration: number;
}

// Backup Loaded
export interface BackupLoadedEvent extends PluginBaseEvent {
  event: 'backup_loaded';
  map_number: number;
  round_number: number;
  filename?: string;
}

// Stats Update (Note: This may be limited in Auto Tournament CS2 compared to Get5)
export interface PlayerStatsUpdateEvent extends PluginBaseEvent {
  event: 'player_stats_update';
  player: {
    steamid: string;
    name: string;
    team: 'team1' | 'team2';
  };
  stats: {
    kills: number;
    deaths: number;
    assists: number;
    headshot_kills: number;
    damage: number;
    utility_damage: number;
    enemies_flashed: number;
  };
}

// Server-level events from Auto Tournament CS2.
//
// These carry matchid -1 (or none at all) and describe the server rather than a
// match. They were declared in serverTrackingService and left out of the union
// below, so every `event.event === 'server_configured'` style check in the
// events route compared against a type that could not contain it — the branches
// ran fine at runtime, but the compiler could not check a line inside them.
export interface ServerConfiguredEvent {
  event: 'server_configured';
  server_id: string;
  hostname: string;
  plugin_version: string;
  remote_log_url: string;
  timestamp: number;
  configured_by: 'Console' | 'Startup';
}

export interface Cs2UpdateRequiredEvent {
  event: 'cs2_update_required';
  matchid: -1;
  server_id: string;
  required_version: number;
  phase?: 'available' | 'shutdown';
  timestamp: number;
}

export interface ServerHealthEvent {
  event: 'server_health';
  server_id: string;
  plugin_version: string;
  timestamp: number;
  db_ok: boolean;
  db_type: 'sqlite' | 'mysql' | string;
  db_error?: string | null;
  reason?: 'startup' | 'periodic' | 'change' | string;
}

/**
 * A player typed `.admin [message]` (Ready Up). Match-scoped like the other
 * events, but it never enters the match pipeline: routes.ts hands it to the
 * core's admin calls (services/adminCallService.ts). `call_id` is unique per
 * call, so a retried delivery is stored once.
 */
export interface AdminCalledEvent extends PluginBaseEvent {
  event: 'admin_called';
  map_number?: number | null;
  call_id: string;
  player?: {
    steamid64?: string | null;
    name?: string | null;
    team?: 'team1' | 'team2' | 'spectator' | null;
    side?: 'ct' | 't' | null;
  } | null;
  /** 200 characters at most; may be empty. */
  message?: string | null;
  /** ISO 8601, UTC. */
  called_at?: string | null;
  server_id?: string;
}

/**
 * Connectivity probe. Auto Tournament CS2 sends this to verify the server can reach our
 * /api/events endpoint; both spellings are in the wild.
 */
export interface ServerTestEvent {
  event: 'test_event' | 'PluginTestEvent';
  server_id?: string;
  matchid?: number | string;
  timestamp?: number;
}

// Union type of all events
export type PluginEvent =
  | SeriesStartEvent
  | SeriesEndEvent
  | MapResultEvent
  | MapPickedEvent
  | SidePickedEvent
  | MapVetoedEvent
  | RoundEndEvent
  | RoundMVPEvent
  | PlayerConnectEvent
  | PlayerDisconnectEvent
  | PlayerReadyEvent
  | PlayerUnreadyEvent
  | TeamReadyEvent
  | AllPlayersReadyEvent
  | PlayerDeathEvent
  | BombPlantedEvent
  | BombDefusedEvent
  | BombExplodedEvent
  | SideSwapEvent
  | GoingLiveEvent
  | WarmupEndedEvent
  | KnifeRoundStartedEvent
  | KnifeRoundEndedEvent
  | RoundStartedEvent
  | HalftimeStartedEvent
  | OvertimeStartedEvent
  | MatchPausedEvent
  | UnpauseRequestedEvent
  | MatchUnpausedEvent
  | BackupLoadedEvent
  | PlayerStatsUpdateEvent
  | ServerConfiguredEvent
  | Cs2UpdateRequiredEvent
  | ServerHealthEvent
  | ServerTestEvent
  | AdminCalledEvent;

// Event storage in database
export interface MatchEvent {
  id: number;
  match_slug: string;
  event_type: string;
  event_data: string; // JSON string
  received_at: number;
}
