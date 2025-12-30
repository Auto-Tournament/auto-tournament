import { db } from '../config/database';
import type { DbTeamRow, DbMatchRow } from '../types/database.types';
import type { TournamentResponse } from '../types/tournament.types';
import type { MatchConfig } from '../types/match.types';
import { log } from '../utils/logger';
import { settingsService } from './settingsService';

/**
 * Determine whether matches should be simulated (bots instead of real players).
 *
 * This is intended as a dev-mode helper. In production, it always returns false
 * regardless of the stored setting so we never accidentally run live events in
 * simulation mode.
 */
async function getSimulationFlag(): Promise<boolean> {
  try {
    return await settingsService.isSimulationModeEnabled();
  } catch (error) {
    log.warn('Failed to read simulate_matches setting, defaulting simulation=false', {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

async function getSimulationTimescale(): Promise<number> {
  try {
    return await settingsService.getSimulationTimescale();
  } catch (error) {
    log.warn('Failed to read simulation_timescale setting, defaulting to 1.0', {
      error: error instanceof Error ? error.message : String(error),
    });
    return 1;
  }
}

/**
 * Normalize the tournament's maxRounds into a safe mp_maxrounds value.
 * - Accepts number or string (from DB / serialized JSON)
 * - Falls back to 24 (MR24) when missing/invalid.
 */
function resolveMaxRounds(tournament: TournamentResponse): number {
  const raw = tournament.maxRounds;
  const parsed =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && raw.trim() !== ''
      ? Number(raw)
      : undefined;

  const maxRounds =
    typeof parsed === 'number' && Number.isFinite(parsed) && parsed > 0 ? parsed : 24;

  return maxRounds;
}

export const generateMatchConfig = async (
  tournament: TournamentResponse,
  team1Id?: string,
  team2Id?: string,
  slug?: string
): Promise<MatchConfig> => {
  // Hard safety check: never generate a config where both slots are the same team.
  // If this happens, it's a bracket progression bug and we should fail fast
  // instead of spinning up a "Team vs Team" match on a live server.
  if (team1Id && team2Id && team1Id === team2Id) {
    throw new Error(
      `Invalid match configuration: team1 and team2 are both '${team1Id}'. ` +
        'This indicates a tournament progression bug (duplicate winner advance).'
    );
  }
  // Handle shuffle tournaments specially
  if (tournament.type === 'shuffle') {
    return generateShuffleMatchConfig(tournament, team1Id, team2Id, slug);
  }
  // 1) DB reads (await!)
  const team1 = team1Id
    ? await db.queryOneAsync<DbTeamRow & { players: string }>('SELECT * FROM teams WHERE id = ?', [
        team1Id,
      ])
    : null;
  const team2 = team2Id
    ? await db.queryOneAsync<DbTeamRow & { players: string }>('SELECT * FROM teams WHERE id = ?', [
        team2Id,
      ])
    : null;

  const numMaps = tournament.format === 'bo1' ? 1 : tournament.format === 'bo3' ? 3 : 5;

  // Parse players from database and convert to MatchZy format
  // Database format: {0: {name, steamId}, 1: {name, steamId}}
  // MatchZy format: {steamId: name, steamId2: name2}
  const convertPlayersToMatchZyFormat = (playersJson: string): Record<string, string> => {
    try {
      const parsed = JSON.parse(playersJson || '{}');
      const result: Record<string, string> = {};

      // If it's already in MatchZy format (all keys are Steam IDs), return as-is
      const keys = Object.keys(parsed);
      if (keys.length > 0 && keys.every((k) => /^7656\d{13}$/.test(k))) {
        return parsed;
      }

      // Convert from database array-like format to MatchZy format
      Object.values(parsed).forEach((player: unknown) => {
        if (
          player &&
          typeof player === 'object' &&
          'steamId' in player &&
          'name' in player &&
          typeof (player as { steamId: string; name: string }).steamId === 'string' &&
          typeof (player as { steamId: string; name: string }).name === 'string'
        ) {
          const typedPlayer = player as { steamId: string; name: string };
          result[typedPlayer.steamId] = typedPlayer.name;
        }
      });

      return result;
    } catch (e) {
      console.error('Failed to parse players JSON:', e);
      return {};
    }
  };

  const team1Players = team1 ? convertPlayersToMatchZyFormat(team1.players) : {};
  const team2Players = team2 ? convertPlayersToMatchZyFormat(team2.players) : {};
  const team1Count = Object.keys(team1Players).length;
  const team2Count = Object.keys(team2Players).length;

  const playersPerTeam = Math.max(team1Count, team2Count, 1);

  // Only set maplist after veto completes - no point storing the map pool
  let maplist: string[] | null = null;
  // We'll carry *per map* sides here, based on the UI veto
  type PerMapSide = 'team1_ct' | 'team2_ct' | 'knife';
  let per_map_sides: PerMapSide[] = Array.from({ length: numMaps }, () => 'knife');

  // 2) If we have a match/veto, use it
  console.log('slug', slug);
  let existingMatch: DbMatchRow | null = null;
  if (slug) {
    existingMatch =
      (await db.queryOneAsync<DbMatchRow>('SELECT id, veto_state FROM matches WHERE slug = ?', [
        slug,
      ])) ?? null;
    console.log('match', existingMatch);
    if (existingMatch?.veto_state) {
      console.log('match.veto_state', existingMatch.veto_state);
      try {
        const veto = JSON.parse(existingMatch.veto_state) as {
          status: 'in_progress' | 'completed';
          pickedMaps: Array<{
            mapName: string;
            mapNumber: number; // used in the UI
            sideTeam1?: 'CT' | 'T'; // set during side_pick
          }>;
        };

        console.log('veto', veto);

        console.log('veto.status', veto?.status);
        console.log('veto.pickedMaps', veto?.pickedMaps);
        console.log('veto.pickedMaps.length', veto?.pickedMaps?.length);

        if (
          veto?.status === 'completed' &&
          Array.isArray(veto.pickedMaps) &&
          veto.pickedMaps.length > 0
        ) {
          // 2a) Order by mapNumber to match the BO1/3/5 series order shown in UI
          const ordered = [...veto.pickedMaps].sort(
            (a, b) => (a.mapNumber ?? 0) - (b.mapNumber ?? 0)
          );

          // 2b) Build maplist from the ordered picks
          maplist = ordered.map((p) => p.mapName);
          maplist = maplist.slice(0, numMaps); // ensure we only have the number of maps we need

          console.log('maplist', maplist);

          // 2c) Translate side picks (UI is per-map; backend previously only had a global toggle)
          // MatchZy format: 'team1_ct' means team1 starts CT, 'team2_ct' means team2 starts CT (team1 starts T)
          per_map_sides = ordered.map((p, index) => {
            let result: PerMapSide;
            if (p.sideTeam1 === 'CT') {
              result = 'team1_ct';
            } else if (p.sideTeam1 === 'T') {
              result = 'team2_ct';
            } else {
              result = 'knife';
            }
            log.debug('Translating side pick to MatchZy format', {
              mapName: p.mapName,
              mapIndex: index,
              sideTeam1: p.sideTeam1,
              matchZySide: result,
            });
            return result;
          });
          // Ensure per_map_sides matches the number of maps
          per_map_sides = per_map_sides.slice(0, numMaps);

          log.info('Per-map sides configured from veto', {
            maplist,
            per_map_sides,
            matchSlug: slug,
          });
        }
      } catch (e) {
        console.error('Failed to parse veto_state JSON:', e);
        // fall back to tournament defaults
      }
    }
  }

  // 3) Use per_map_sides for map_sides - MatchZy expects map_sides array to correspond
  //    to each map in maplist. If we have veto picks, use them; otherwise use defaults.
  let map_sides: Array<'team1_ct' | 'team2_ct' | 'knife'>;
  if (maplist && maplist.length > 0 && per_map_sides.some((s) => s !== 'knife')) {
    // Use the per-map sides from veto
    map_sides = per_map_sides.slice(0, numMaps) as Array<'team1_ct' | 'team2_ct' | 'knife'>;
  } else {
    // Fallback: use default pattern if no veto sides were chosen
    const anyKnife = per_map_sides.some((s) => s === 'knife');
    map_sides = (anyKnife ? ['team1_ct', 'team2_ct', 'knife'] : ['team1_ct', 'team2_ct']).slice(
      0,
      numMaps
    ) as Array<'team1_ct' | 'team2_ct' | 'knife'>;
  }

  const simulation = await getSimulationFlag();
  const simulationTimescale = simulation ? await getSimulationTimescale() : undefined;

  const maxRounds = resolveMaxRounds(tournament);
  const cvars: Record<string, string | number> = {
    mp_maxrounds: maxRounds,
  };

  const config: MatchConfig = {
    // MatchZy expects numeric matchid; fall back to 0 only if we somehow
    // don't have a DB row yet (should be rare, but keeps config valid).
    matchid: existingMatch?.id ?? 0,
    num_maps: numMaps,
    players_per_team: playersPerTeam,
    min_players_to_ready: 1,
    min_spectators_to_ready: 0,
    wingman: false,

    // veto
    skip_veto: true,
    maplist, // ordered maps from the veto
    map_sides, // per-map sides matching maplist order

    // >>> new: carry per-map sides chosen in the UI <<<
    // Your allocator / match loader should read this and configure the server accordingly.
    // veto_per_map_sides: per_map_sides, // ['team1_ct' | 'team2_ct' | 'knife'] per map index

    spectators: { players: {} },

    // Round limit configuration
    cvars,

    // Explicit round-limit metadata for MatchZy JSON consumers
    maxRounds,
    overtimeMode: tournament.overtimeMode,
    overtimeSegments: tournament.overtimeSegments,

    // Custom fields used by your frontend
    expected_players_total: team1Count + team2Count,
    expected_players_team1: team1Count,
    expected_players_team2: team2Count,
    team1: team1
      ? {
          id: team1.id,
          name: team1.name,
          tag: team1.tag || team1.name.substring(0, 4).toUpperCase(),
          players: team1Players,
          series_score: 0,
        }
      : { name: 'TBD', tag: 'TBD', players: {}, series_score: 0 },
    team2: team2
      ? {
          id: team2.id,
          name: team2.name,
          tag: team2.tag || team2.name.substring(0, 4).toUpperCase(),
          players: team2Players,
          series_score: 0,
        }
      : { name: 'TBD', tag: 'TBD', players: {}, series_score: 0 },
    simulation,
    simulation_timescale: simulation ? simulationTimescale ?? 1 : undefined,
  };

  // Attach global admin Steam IDs to the config so they always have in‑game
  // admin rights on every standard (non‑shuffle) match.
  try {
    const adminRows = await db.queryAsync<{ id: string }>(
      'SELECT id FROM players WHERE is_admin = 1'
    );
    (config as any).admins = Array.isArray(adminRows) ? adminRows.map((row) => row.id) : [];
  } catch (e) {
    console.error('Failed to attach admins to standard match config', e);
  }

  log.info('Match config generated (standard)', {
    matchSlug: slug,
    matchId: config.matchid,
    numMaps: config.num_maps,
    maplist: config.maplist,
    map_sides: config.map_sides,
    maxRounds,
    cvars,
    team1: config.team1.name,
    team2: config.team2.name,
  });
  return config;
};

/**
 * Generate match config for shuffle tournaments
 * Shuffle tournaments: BO1, no veto, fixed map per round, random sides
 */
async function generateShuffleMatchConfig(
  tournament: TournamentResponse,
  team1Id?: string,
  team2Id?: string,
  slug?: string
): Promise<MatchConfig> {
  const team1 = team1Id
    ? await db.queryOneAsync<DbTeamRow & { players: string }>('SELECT * FROM teams WHERE id = ?', [
        team1Id,
      ])
    : null;
  const team2 = team2Id
    ? await db.queryOneAsync<DbTeamRow & { players: string }>('SELECT * FROM teams WHERE id = ?', [
        team2Id,
      ])
    : null;

  // Get map for this round from match
  let mapForRound: string | null = null;
  let matchId: number | null = null;
  if (slug) {
    const match = await db.queryOneAsync<DbMatchRow>(
      'SELECT id, current_map, round FROM matches WHERE slug = ?',
      [slug]
    );
    if (match) {
      matchId = match.id;
    }
    if (match?.current_map) {
      mapForRound = match.current_map;
    } else if (match?.round) {
      // Fallback: get map from sequence
      const mapSequence = tournament.mapSequence || tournament.maps;
      if (match.round > 0 && match.round <= mapSequence.length) {
        mapForRound = mapSequence[match.round - 1];
      }
    }
  }

  // Fallback to first map if not found
  if (!mapForRound) {
    const mapSequence = tournament.mapSequence || tournament.maps;
    mapForRound = mapSequence[0] || tournament.maps[0];
  }

  // Convert players
  const convertPlayersToMatchZyFormat = (playersJson: string): Record<string, string> => {
    try {
      const parsed = JSON.parse(playersJson || '{}');
      const result: Record<string, string> = {};

      const keys = Object.keys(parsed);
      if (keys.length > 0 && keys.every((k) => /^7656\d{13}$/.test(k))) {
        return parsed;
      }

      Object.values(parsed).forEach((player: unknown) => {
        if (
          player &&
          typeof player === 'object' &&
          'steamId' in player &&
          'name' in player &&
          typeof (player as { steamId: string; name: string }).steamId === 'string' &&
          typeof (player as { steamId: string; name: string }).name === 'string'
        ) {
          const typedPlayer = player as { steamId: string; name: string };
          result[typedPlayer.steamId] = typedPlayer.name;
        }
      });

      return result;
    } catch (e) {
      console.error('Failed to parse players JSON:', e);
      return {};
    }
  };

  const team1Players = team1 ? convertPlayersToMatchZyFormat(team1.players) : {};
  const team2Players = team2 ? convertPlayersToMatchZyFormat(team2.players) : {};
  const team1Count = Object.keys(team1Players).length;
  const team2Count = Object.keys(team2Players).length;

  // Shuffle tournaments: BO1, single map, random side, no veto
  const maplist = mapForRound ? [mapForRound] : null;
  const map_sides: Array<'team1_ct' | 'team2_ct'> = [Math.random() > 0.5 ? 'team1_ct' : 'team2_ct'];

  // Configure round limit based on shuffle tournament settings.
  // IMPORTANT: This code is ONLY allowed to set cvars["mp_maxrounds"].
  // It must not touch any other cvars (mp_overtime_*, mp_match_can_clinch, etc.).
  const maxRounds = resolveMaxRounds(tournament);
  const cvars: Record<string, string | number> = {
    mp_maxrounds: maxRounds,
  };

  const simulation = await getSimulationFlag();
  const simulationTimescale = simulation ? await getSimulationTimescale() : undefined;

  // For shuffle we want players_per_team to reflect the configured teamSize
  // (e.g. 2 for 2v2) so the plugin's ready logic is correct. Fall back to the
  // actual player counts when teamSize is not defined.
  const playersPerTeam =
    typeof tournament.teamSize === 'number' && tournament.teamSize > 0
      ? tournament.teamSize
      : Math.max(team1Count, team2Count, 1);

  const config: MatchConfig = {
    // MatchZy expects matchid to be an integer; use the numeric DB id when available.
    // Fall back to 0 only if the match row is unexpectedly missing.
    matchid: matchId ?? 0,
    num_maps: 1, // Shuffle tournaments are always BO1
    players_per_team: playersPerTeam,
    // Require a full team to be ready before going live; for example, 2/2 in 2v2.
    min_players_to_ready: playersPerTeam,
    min_spectators_to_ready: 0,
    wingman: false,

    // Shuffle: no veto, fixed map, random side
    skip_veto: true,
    maplist,
    map_sides,

    // Round limit and overtime configuration
    cvars,

    // Explicit round-limit metadata for MatchZy JSON consumers
    maxRounds,
    overtimeMode: tournament.overtimeMode,
    overtimeSegments: tournament.overtimeSegments,

    spectators: { players: {} },

    // Expected players are purely informational for our own UIs. MatchZy uses
    // players_per_team + min_players_to_ready as the authoritative values.
    expected_players_total: playersPerTeam * 2,
    expected_players_team1: playersPerTeam,
    expected_players_team2: playersPerTeam,
    team1: team1
      ? {
          id: team1.id,
          name: team1.name,
          tag: team1.tag || team1.name.substring(0, 4).toUpperCase(),
          players: team1Players,
          series_score: 0,
        }
      : { name: 'TBD', tag: 'TBD', players: {}, series_score: 0 },
    team2: team2
      ? {
          id: team2.id,
          name: team2.name,
          tag: team2.tag || team2.name.substring(0, 4).toUpperCase(),
          players: team2Players,
          series_score: 0,
        }
      : { name: 'TBD', tag: 'TBD', players: {}, series_score: 0 },
    simulation,
    simulation_timescale: simulation ? simulationTimescale ?? 1 : undefined,
  };

  // Attach global admin Steam IDs to the config so they always have in‑game
  // admin rights on every shuffle match.
  try {
    const adminRows = await db.queryAsync<{ id: string }>(
      'SELECT id FROM players WHERE is_admin = 1'
    );
    (config as any).admins = Array.isArray(adminRows) ? adminRows.map((row) => row.id) : [];
  } catch (e) {
    console.error('Failed to attach admins to shuffle match config', e);
  }

  log.info('Shuffle match config generated', {
    matchSlug: slug,
    map: mapForRound,
    team1: config.team1.name,
    team2: config.team2.name,
    maxRounds,
    cvars,
  });

  return config;
}
