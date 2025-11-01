/**
 * MatchZy Event Types
 * Based on official documentation: https://shobhit-pathak.github.io/MatchZy/events.html
 *
 * Note: MatchZy implements a subset of Get5 events compatible with CS2
 */

export interface MatchZyBaseEvent {
  event: string;
  matchid: string;
}

// Series Events
export interface SeriesStartEvent extends MatchZyBaseEvent {
  event: 'series_start';
  team1_name: string;
  team2_name: string;
  num_maps: number;
}

export interface SeriesEndEvent extends MatchZyBaseEvent {
  event: 'series_end';
  team1_series_score: number;
  team2_series_score: number;
  winner: 'team1' | 'team2' | 'none';
  time_until_restore: number;
}

// Map Events
export interface MapResultEvent extends MatchZyBaseEvent {
  event: 'map_result';
  map_number: number;
  map_name: string;
  team1_score: number;
  team2_score: number;
  winner: string;
}

export interface MapPickedEvent extends MatchZyBaseEvent {
  event: 'map_picked';
  map_name: string;
  map_number: number;
  picked_by: string;
}

export interface SidePickedEvent extends MatchZyBaseEvent {
  event: 'side_picked';
  map_name: string;
  map_number: number;
  side: string;
  picked_by: string;
}

export interface MapVetoedEvent extends MatchZyBaseEvent {
  event: 'map_vetoed';
  map_name: string;
  vetoed_by: string;
}

// Round Events
export interface RoundEndEvent extends MatchZyBaseEvent {
  event: 'round_end';
  map_number: number;
  round_number: number;
  round_time: number;
  reason: number; // CS2 round end reason
  winner: 'team1' | 'team2';
  team1_score: number;
  team2_score: number;
}

export interface RoundMVPEvent extends MatchZyBaseEvent {
  event: 'round_mvp';
  round_number: number;
  player: {
    steamid: string;
    name: string;
  };
  reason: number; // MVP reason code
}

// Player Events
export interface PlayerConnectEvent extends MatchZyBaseEvent {
  event: 'player_connect';
  player: {
    steamid: string;
    name: string;
  };
}

export interface PlayerDisconnectEvent extends MatchZyBaseEvent {
  event: 'player_disconnect';
  player: {
    steamid: string;
    name: string;
  };
}

export interface PlayerDeathEvent extends MatchZyBaseEvent {
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
export interface BombPlantedEvent extends MatchZyBaseEvent {
  event: 'bomb_planted';
  player: {
    steamid: string;
    name: string;
    team: 'team1' | 'team2';
  };
  site: 'A' | 'B';
}

export interface BombDefusedEvent extends MatchZyBaseEvent {
  event: 'bomb_defused';
  player: {
    steamid: string;
    name: string;
    team: 'team1' | 'team2';
  };
  site: 'A' | 'B';
}

export interface BombExplodedEvent extends MatchZyBaseEvent {
  event: 'bomb_exploded';
  site: 'A' | 'B';
}

// Side Swap
export interface SideSwapEvent extends MatchZyBaseEvent {
  event: 'side_swap';
  map_number: number;
}

// Going Live
export interface GoingLiveEvent extends MatchZyBaseEvent {
  event: 'going_live';
  map_number: number;
}

// Backup Loaded
export interface BackupLoadedEvent extends MatchZyBaseEvent {
  event: 'backup_loaded';
  map_number: number;
  round_number: number;
}

// Stats Update (Note: This may be limited in MatchZy compared to Get5)
export interface PlayerStatsUpdateEvent extends MatchZyBaseEvent {
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

// Union type of all events
export type MatchZyEvent =
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
  | PlayerDeathEvent
  | BombPlantedEvent
  | BombDefusedEvent
  | BombExplodedEvent
  | SideSwapEvent
  | GoingLiveEvent
  | BackupLoadedEvent
  | PlayerStatsUpdateEvent;

// Event storage in database
export interface MatchEvent {
  id: number;
  match_slug: string;
  event_type: string;
  event_data: string; // JSON string
  received_at: number;
}
