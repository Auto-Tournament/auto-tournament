import { logoUrl } from './teamSelfService';
/**
 * Shuffle Tournament Service
 * Handles shuffle tournament creation, round generation, and automatic progression
 */

import { RATING_ELO, getGameRatings, ratingGame, ratingJoin } from './gameRatings';
import { db } from '../config/database';
import { log } from '../utils/logger';
import { emitTournamentUpdate } from './socketService';
import { settingsService } from './settingsService';
import { balanceTeams, type BalancedTeam } from './teamBalancingService';
import { playerService, type PlayerRecord } from './playerService';
import { teamMembers } from './teamMembers';
import { buildMatchConfigFor, serializeMatchConfig } from '../utils/matchIntegration';
import { generateUniqueTeamName } from '../generation/teamName';
import type { TournamentResponse } from '../types/tournament.types';
import type { DbMatchRow, DbTeamRow, DbTournamentRow } from '../types/database.types';
import { tournamentRowToResponse } from '../utils/tournamentRow';
import { withModuleSettings } from '../utils/moduleTournamentSettings';
import { DEFAULT_GAME } from '../integrations/types';
import { getIntegration } from '../integrations/registry';
import { getSwissStandingEntries } from './swissProgressionService';
import { getRoundRobinStandingEntries } from './roundRobinStandingsService';
import type { Player } from '../types/team.types';
import { shuffleTeamId, shuffleTeamLike, tournamentSlugPrefix } from '../utils/matchSlug';

/**
 * POST /api/tournament/shuffle. The map sequence and round rules belong to
 * the game module: a request sends them as the module's object in `settings`
 * (CS2: `settings.cs2`), or at the top level as 2.x clients do. The core
 * passes both to the module and never reads them.
 */
export interface ShuffleTournamentConfig {
  name: string;
  /** 2.x: maps in order (number of maps = number of rounds). */
  mapSequence?: string[];
  teamSize: number; // Number of players per team, default: 5
  /** 2.x: mp_maxrounds (the module defaults it to 24). */
  maxRounds?: number;
  /** 2.x: 'enabled' | 'disabled'. */
  overtimeMode?: 'enabled' | 'disabled';
  /**
   * 2.x: max number of overtime segments before the match ends in a draw;
   * undefined or 0 is the plugin's default (unlimited).
   */
  overtimeSegments?: number;
  eloTemplateId?: string; // ELO calculation template ID (optional, defaults to "Pure Win/Loss")
  /** The game module's object, under its key (CS2: `cs2`). */
  settings?: Record<string, unknown>;
}

export interface PlayerLeaderboardEntry {
  playerId: string;
  name: string;
  avatar?: string;
  currentElo: number;
  startingElo: number;
  matchWins: number;
  matchLosses: number;
  winRate: number;
  eloChange: number; // Change since tournament start
  averageAdr?: number; // Future: average ADR across matches
  /** This tournament's totals (standard brackets; absent for shuffle). */
  kills?: number;
  deaths?: number;
  assists?: number;
  headshots?: number;
  flashAssists?: number;
  utilityDamage?: number;
  roundsPlayed?: number;
  /** The tournament team the player is on, from the team rosters. */
  team?: { id: string; name: string; tag?: string | null } | null;
}

export interface TeamLeaderboardEntry {
  teamId: string;
  name: string;
  tag?: string | null;
  matchWins: number;
  matchLosses: number;
  matchCount: number;
  winRate: number;
  /** Swiss and round robin: rank and round differential from the server standings (Buchholz: Swiss only). */
  rank?: number;
  buchholz?: number;
  roundDiff?: number;
}

export interface RoundStatus {
  roundNumber: number;
  totalMatches: number;
  completedMatches: number;
  pendingMatches: number;
  isComplete: boolean;
  map: string;
}

/**
 * Create a shuffle tournament
 */
export async function createShuffleTournament(
  tournamentId: number,
  config: ShuffleTournamentConfig
): Promise<TournamentResponse> {
  const now = Math.floor(Date.now() / 1000);

  // The config is validated by the route (POST /api/tournament/shuffle): the
  // name there, the map sequence and max rounds through the integration's
  // `validateTournamentSettings`.

  // Clean up any existing data for this tournament row, so it can be
  // recreated multiple times (tests do) without PK conflicts.
  await db.runAsync('DELETE FROM matches WHERE tournament_id = ?', [tournamentId]);
  await db.runAsync('DELETE FROM shuffle_tournament_players WHERE tournament_id = ?', [
    tournamentId,
  ]);
  await db.runAsync('DELETE FROM teams WHERE id LIKE ?', [shuffleTeamLike(tournamentId)]);
  await db.runAsync('DELETE FROM tournament WHERE id = ?', [tournamentId]);

  // The map sequence and round rules are the game module's (CS2:
  // settings.cs2), built by it from the request: its object in `settings`,
  // then the 2.x top-level fields. A 2.x sequence is also the map pool, and a
  // shuffle tournament has never stored 0 overtime segments: 0 is the default.
  const legacy: Record<string, unknown> = {};
  if (config.mapSequence !== undefined) {
    legacy.maps = config.mapSequence;
    legacy.mapSequence = config.mapSequence;
  }
  if (config.maxRounds) legacy.maxRounds = config.maxRounds;
  if (config.overtimeMode) legacy.overtimeMode = config.overtimeMode;
  if (config.overtimeSegments !== undefined) {
    legacy.overtimeSegments =
      typeof config.overtimeSegments === 'number' && config.overtimeSegments > 0
        ? config.overtimeSegments
        : null;
  }
  const settings = withModuleSettings(
    DEFAULT_GAME,
    {
      matchFormat: 'bo1',
      thirdPlaceMatch: false,
      autoAdvance: true,
      checkInRequired: false,
      seedingMethod: 'random',
    },
    { ...legacy, settings: config.settings },
    undefined,
    'tournament'
  );

  // Create tournament
  await db.insertAsync('tournament', {
    id: tournamentId,
    name: config.name,
    type: 'shuffle',
    format: 'bo1', // Shuffle tournaments are always BO1
    status: 'setup',
    team_ids: JSON.stringify([]), // No fixed teams for shuffle tournaments
    settings: JSON.stringify(settings),
    team_size: config.teamSize || 5,
    elo_template_id: config.eloTemplateId || null,
    created_at: now,
    updated_at: now,
  });

  const tournament = await getShuffleTournament(tournamentId);
  if (!tournament) {
    throw new Error('Failed to create tournament');
  }

  log.success(`Shuffle tournament created: ${config.name}`, {
    rounds: (tournament.mapSequence || tournament.maps).length,
    overtimeMode: tournament.overtimeMode,
    overtimeSegments: tournament.overtimeSegments,
  });

  await (await import('./currentTournament')).refreshCurrentTournamentId();
  return tournament;
}

/**
 * Register players to shuffle tournament
 * Players are automatically whitelisted for matches
 */
export async function registerPlayers(
  tournamentId: number,
  playerIds: string[]
): Promise<{
  registered: number;
  errors: Array<{ playerId: string; error: string }>;
}> {
  const tournament = await getShuffleTournament(tournamentId);
  if (!tournament) {
    throw new Error('No shuffle tournament found. Please create a shuffle tournament first.');
  }

  // Each round draws from whoever is registered then, so a player can join a running
  // shuffle and is in the next round's draw.
  if (tournament.status !== 'setup' && tournament.status !== 'in_progress') {
    throw new Error(
      `Cannot register players. Tournament is in "${tournament.status}" status. ` +
        'Players can only be registered before it starts or while it runs.'
    );
  }

  if (!playerIds || playerIds.length === 0) {
    throw new Error('No players provided. Please select at least one player to register.');
  }

  const errors: Array<{ playerId: string; error: string }> = [];
  let registered = 0;

  // Table should already exist from schema, but handle gracefully if not

  for (const playerId of playerIds) {
    try {
      // Check if player exists
      const player = await playerService.getPlayerById(playerId);
      if (!player) {
        errors.push({ playerId, error: 'Player not found' });
        continue;
      }

      // Register player (upsert - ignore if already registered)
      try {
        const back = await db.runAsync(
          'UPDATE shuffle_tournament_players SET left_at = NULL, left_reason = NULL WHERE tournament_id = ? AND player_id = ? AND left_at IS NOT NULL',
          [tournamentId, playerId]
        );
        if (back.changes > 0) {
          registered++;
          continue;
        }
        await db.insertAsync('shuffle_tournament_players', {
          tournament_id: tournamentId,
          player_id: playerId,
          registered_at: Math.floor(Date.now() / 1000),
        });
        registered++;
      } catch (err) {
        // Player already registered, skip
        const error = err as Error & { code?: string };
        if (error.code !== '23505') {
          // Not a duplicate key error, rethrow
          throw err;
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push({ playerId, error: errorMessage });
    }
  }

  log.success(`Registered ${registered} players to shuffle tournament`, {
    errors: errors.length,
  });

  return { registered, errors };
}

/**
 * Get registered players for shuffle tournament
 */
export async function getRegisteredPlayers(
  tournamentId: number,
  /** Only the players still in it (not left a running shuffle): the ones a round draws. */
  options: { active?: boolean } = {}
): Promise<PlayerRecord[]> {
  const playerIds = await db.queryAsync<{ player_id: string }>(
    `SELECT player_id FROM shuffle_tournament_players WHERE tournament_id = ?${
      options.active ? ' AND left_at IS NULL' : ''
    } ORDER BY registered_at`,
    [tournamentId]
  );

  if (playerIds.length === 0) {
    return [];
  }

  // Their ratings in the tournament's game: balancing and the standings use them.
  const ids = playerIds.map((p) => p.player_id);
  const tournament = await db.queryOneAsync<{ game: string | null }>(
    'SELECT game FROM tournament WHERE id = ?',
    [tournamentId]
  );
  const ratings = await getGameRatings(ids, tournament?.game);
  return (await playerService.getPlayersByIds(ids)).map((p) => {
    const r = ratings.get(p.id);
    return r
      ? {
          ...p,
          current_elo: r.elo,
          openskill_mu: r.mu,
          openskill_sigma: r.sigma,
          match_count: r.matchCount,
        }
      : p;
  });
}

/**
 * Set registered players for shuffle tournament (replaces all existing registrations)
 * This allows selecting/deselecting players by providing the full list
 */
export async function setRegisteredPlayers(
  tournamentId: number,
  playerIds: string[]
): Promise<{
  registered: number;
  unregistered: number;
  errors: Array<{ playerId: string; error: string }>;
}> {
  const tournament = await getShuffleTournament(tournamentId);
  if (!tournament) {
    throw new Error('No shuffle tournament found. Please create a shuffle tournament first.');
  }

  // A running shuffle: a removed player leaves (keeps their results, is not drawn again).
  const running = tournament.status === 'in_progress';
  if (tournament.status !== 'setup' && !running) {
    throw new Error(
      `Cannot modify player registrations. Tournament is in "${tournament.status}" status. ` +
        'Players can only be modified before it starts or while it runs.'
    );
  }

  // Get currently registered players
  const currentPlayerIds = await db.queryAsync<{ player_id: string }>(
    'SELECT player_id FROM shuffle_tournament_players WHERE tournament_id = ? AND left_at IS NULL',
    [tournamentId]
  );
  const currentIds = new Set(currentPlayerIds.map((p) => p.player_id));

  // Determine which players to add and which to remove
  const newIds = new Set(playerIds || []);
  const toAdd = playerIds.filter((id) => !currentIds.has(id));
  const toRemove = Array.from(currentIds).filter((id) => !newIds.has(id));

  const errors: Array<{ playerId: string; error: string }> = [];
  let registered = 0;
  let unregistered = 0;

  // Remove players that are no longer in the list
  for (const playerId of toRemove) {
    try {
      if (running) {
        await db.runAsync(
          'UPDATE shuffle_tournament_players SET left_at = ?, left_reason = ? WHERE tournament_id = ? AND player_id = ?',
          [Math.floor(Date.now() / 1000), 'removed', tournamentId, playerId]
        );
        unregistered++;
        continue;
      }
      await db.deleteAsync('shuffle_tournament_players', 'tournament_id = ? AND player_id = ?', [
        tournamentId,
        playerId,
      ]);
      unregistered++;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push({ playerId, error: `Failed to unregister: ${errorMessage}` });
    }
  }

  // Add new players
  const now = Math.floor(Date.now() / 1000);
  for (const playerId of toAdd) {
    try {
      // Check if player exists
      const player = await playerService.getPlayerById(playerId);
      if (!player) {
        errors.push({ playerId, error: 'Player not found' });
        continue;
      }

      // Register player (or bring back one who left a running shuffle)
      await db.runAsync(
        `INSERT INTO shuffle_tournament_players (tournament_id, player_id, registered_at) VALUES (?, ?, ?)
         ON CONFLICT (tournament_id, player_id) DO UPDATE SET left_at = NULL, left_reason = NULL`,
        [tournamentId, playerId, now]
      );
      registered++;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push({ playerId, error: errorMessage });
    }
  }

  log.success(`Updated player registrations: ${registered} added, ${unregistered} removed`, {
    errors: errors.length,
  });

  return { registered, unregistered, errors };
}

/**
 * With bot fill, how many teams a round of `players` makes: an even count where
 * at most one team is short (bots fill fewer than `teamSize` slots). `undefined`
 * when that needs more bots: the round sits the fewest players out instead.
 */
export function botFillTeamCount(players: number, teamSize: number): number | undefined {
  let teams = Math.ceil(players / teamSize);
  if (teams % 2 === 1) teams += 1;
  return teams * teamSize - players < teamSize ? teams : undefined;
}

/**
 * Generate matches for a round
 * Automatically balances teams and creates matches
 */
export async function generateRoundMatches(
  tournamentId: number,
  roundNumber: number
): Promise<{
  matches: DbMatchRow[];
  teams: BalancedTeam[];
}> {
  const tournament = await getShuffleTournament(tournamentId);
  if (!tournament) {
    throw new Error('No shuffle tournament found');
  }

  // Get map sequence
  const mapSequence = tournament.mapSequence || tournament.maps;
  if (roundNumber < 1 || roundNumber > mapSequence.length) {
    throw new Error(
      `Invalid round number: ${roundNumber}. ` +
        `Tournament has ${mapSequence.length} round(s) (based on ${mapSequence.length} map(s) selected). ` +
        `Valid round numbers: 1-${mapSequence.length}.`
    );
  }

  const map = mapSequence[roundNumber - 1];
  const teamSize = tournament.teamSize || 5;

  // Get registered players (not the ones who left)
  const players = await getRegisteredPlayers(tournamentId, { active: true });
  const minPlayers = teamSize * 2; // Need at least 2 teams
  if (players.length < minPlayers) {
    throw new Error(
      `Not enough players registered: ${players.length}. ` +
        `Shuffle tournaments require at least ${minPlayers} players for ${teamSize}v${teamSize} matches. ` +
        `Please register ${minPlayers - players.length} more player(s) before generating matches.`
    );
  }

  // Pick who sits out before balancing so every team gets a match. With 15 players in 2v2,
  // three sit out each round: the ones who have played the most so far, never the same
  // people twice in a row while others are still owed a break.
  const playedCount = new Map<string, number>();
  const earlierTeams = await db.queryAsync<{ players: string }>(
    'SELECT players FROM teams WHERE id LIKE ?',
    [shuffleTeamLike(tournamentId)]
  );
  for (const team of earlierTeams) {
    for (const p of JSON.parse(team.players || '[]') as Player[]) {
      playedCount.set(p.steamId, (playedCount.get(p.steamId) ?? 0) + 1);
    }
  }
  // Bot fill: as much player-vs-player as possible. Bots only when one short team
  // covers the gap (15 players in 2v2: one bot, nobody sits out); with more bots than
  // that (9 players: three), the fewest players sit out instead.
  const botFill =
    getIntegration(tournament.game ?? DEFAULT_GAME).fillsShortTeams?.(tournament) ?? false;
  const teamCount = botFill ? botFillTeamCount(players.length, teamSize) : undefined;
  const sitCount = teamCount !== undefined ? 0 : players.length % (teamSize * 2);
  const sitOut = new Set(
    players
      .map((p) => ({ id: p.id, played: playedCount.get(p.id) ?? 0, tiebreak: Math.random() }))
      .sort((x, y) => y.played - x.played || x.tiebreak - y.tiebreak)
      .slice(0, sitCount)
      .map((p) => p.id)
  );
  if (sitOut.size > 0) {
    log.info(`Round ${roundNumber}: ${sitOut.size} player(s) sit out`, { players: [...sitOut] });
  }

  // Balance teams
  const playerIds = players.map((p) => p.id).filter((id) => !sitOut.has(id));
  const tournamentGame = (
    await db.queryOneAsync<{ game: string | null }>('SELECT game FROM tournament WHERE id = ?', [
      tournamentId,
    ])
  )?.game;
  const balanceResult = await balanceTeams(playerIds, teamSize, true, tournamentGame, teamCount); // Use tournament team size, use optimization

  // Create temporary teams for this round
  const teams: BalancedTeam[] = balanceResult.teams;
  const matches = await insertRoundMatches(tournament, tournamentId, roundNumber, map, teams, 1);

  log.success(`Generated ${matches.length} matches for round ${roundNumber}`, {
    map,
    players: players.length,
    teams: teams.length,
  });

  return { matches, teams };
}

/**
 * Pair up `teams` (1 v 2, 3 v 4, ...) into this round's matches, numbered from
 * `firstMatchNumber`: their teams, rosters and match rows, ready to allocate.
 */
async function insertRoundMatches(
  tournament: TournamentResponse,
  tournamentId: number,
  roundNumber: number,
  map: string,
  teams: BalancedTeam[],
  firstMatchNumber: number
): Promise<DbMatchRow[]> {
  const createdTeams: Array<{ team1Id: string; team2Id: string }> = [];

  const now = Math.floor(Date.now() / 1000);
  const matches: DbMatchRow[] = [];

  // Track which players are assigned to matches (for future use if needed)
  // const assignedPlayerIds = new Set<string>();

  // Build a set of team names that have already been used by previous shuffle
  // rounds so we never reuse a name within the same tournament.
  const existingShuffleTeams = await db.queryAsync<DbTeamRow>(
    'SELECT id, name, tag FROM teams WHERE id LIKE ?',
    [shuffleTeamLike(tournamentId)]
  );
  const usedTeamNames = new Set<string>(existingShuffleTeams.map((t) => t.name));

  // Create matches for each team pair
  for (let pair = 0; pair < teams.length / 2; pair++) {
    const matchNum = firstMatchNumber - 1 + pair;
    const team1Index = pair * 2;
    const team2Index = team1Index + 1;

    if (team2Index >= teams.length) {
      // Sit-outs are picked before balancing, so this only happens if balancing drops a team.
      log.warn(
        `Round ${roundNumber}: odd team count, ${teams[team1Index].players.length} player(s) sit out`
      );
      break;
    }

    const team1 = teams[team1Index];
    const team2 = teams[team2Index];

    // Create temporary teams
    const team1Id = shuffleTeamId(tournamentId, roundNumber, matchNum + 1, 1);
    const team2Id = shuffleTeamId(tournamentId, roundNumber, matchNum + 1, 2);

    // Pick two distinct, random, globally-unique team names for this match.
    const team1FriendlyName = generateUniqueTeamName(usedTeamNames);
    const team2FriendlyName = generateUniqueTeamName(usedTeamNames);

    // Convert players to team format
    const team1Players: Player[] = team1.players.map((p) => ({
      steamId: p.id,
      name: p.name,
      avatar: p.avatar_url || undefined,
    }));

    const team2Players: Player[] = team2.players.map((p) => ({
      steamId: p.id,
      name: p.name,
      avatar: p.avatar_url || undefined,
    }));

    // Create teams in database
    await db.insertAsync('teams', {
      id: team1Id,
      name: team1FriendlyName,
      tag: `R${roundNumber}M${matchNum + 1}T1`,
      players: JSON.stringify(team1Players),
      created_at: now,
      updated_at: now,
    });

    await db.insertAsync('teams', {
      id: team2Id,
      name: team2FriendlyName,
      tag: `R${roundNumber}M${matchNum + 1}T2`,
      players: JSON.stringify(team2Players),
      created_at: now,
      updated_at: now,
    });

    // Mirror both rosters into team_members (3.0 phase D), as a team written
    // through teamService would. Best effort; these teams cascade away with
    // the round.
    await teamMembers.syncFromRoster(
      team1Id,
      team1Players.map((p) => p.steamId)
    );
    await teamMembers.syncFromRoster(
      team2Id,
      team2Players.map((p) => p.steamId)
    );

    createdTeams.push({ team1Id, team2Id });

    // Build the match config through the game integration. For shuffle it is
    // Bo1 on the round's map (map sequence), random side, no veto.
    const matchSlug = `${tournamentSlugPrefix(tournamentId)}shuffle-r${roundNumber}-m${matchNum + 1}`;
    const config = await buildMatchConfigFor(
      { slug: matchSlug, round: roundNumber, team1Id, team2Id },
      tournament
    );

    // Create match
    // Shuffle tournaments skip veto, so matches are immediately ready for server allocation
    await db.insertAsync('matches', {
      slug: matchSlug,
      tournament_id: tournamentId,
      round: roundNumber,
      match_number: matchNum + 1,
      team1_id: team1Id,
      team2_id: team2Id,
      winner_id: null,
      server_id: null,
      config: serializeMatchConfig(config),
      status: 'ready', // No veto for a shuffle match
      next_match_id: null,
      current_map: map,
      map_number: 0,
      created_at: now,
    });

    const match = await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE slug = ?', [
      matchSlug,
    ]);

    if (match) {
      matches.push(match);
    }
  }
  return matches;
}

/** Minutes into a round after which the bench waits for the next round instead. */
export const LATE_BENCH_SECONDS = 10 * 60;

/**
 * Too late in the round for an extra match from the bench: one of the round's matches has
 * already finished, or the round started more than LATE_BENCH_SECONDS ago. The next round waits
 * for every match of this one, so a full match made at 20:40 held round 3 until it ended, long
 * after the rest of round 2 (NTLAN, 2026-10-16). Those players are drawn next round instead.
 */
export function benchTooLate(
  round: { startedAt: number | null; finished: number },
  now: number
): boolean {
  if (round.finished > 0) return true;
  return round.startedAt !== null && now - round.startedAt > LATE_BENCH_SECONDS;
}

/**
 * Players who joined a running shuffle (or sat this round out) play now when
 * there are enough of them: the round gets extra matches from its bench
 * instead of them waiting for the next round. With bot fill two players are
 * enough (short teams get bots); otherwise it takes two full teams. Returns
 * the new matches' slugs, already handed to allocation.
 */
export async function fillRoundFromBench(tournamentId: number): Promise<string[]> {
  const tournament = await getShuffleTournament(tournamentId);
  if (!tournament || tournament.status !== 'in_progress') return [];
  const top = await db.queryOneAsync<{ round: number | null; open: number }>(
    `SELECT MAX(round) AS round,
            SUM(CASE WHEN status NOT IN ('completed', 'cancelled') THEN 1 ELSE 0 END)::INTEGER AS open
       FROM matches WHERE tournament_id = ?`,
    [tournamentId]
  );
  const roundNumber = top?.round ?? null;
  // A round that has finished is about to be replaced by the next one, which draws everyone.
  if (roundNumber === null || !top?.open) return [];
  const progress = await db.queryOneAsync<{ started: number | null; finished: number | string }>(
    `SELECT MIN(loaded_at) AS started,
            SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS finished
       FROM matches WHERE tournament_id = ? AND round = ?`,
    [tournamentId, roundNumber]
  );
  if (
    benchTooLate(
      {
        startedAt: progress?.started ? Number(progress.started) : null,
        finished: Number(progress?.finished ?? 0),
      },
      Math.floor(Date.now() / 1000)
    )
  ) {
    log.info(`Round ${roundNumber}: too late for a match from the bench; they play next round`);
    return [];
  }
  const mapSequence = tournament.mapSequence || tournament.maps;
  const map = mapSequence[roundNumber - 1];
  if (!map) return [];
  const teamSize = tournament.teamSize || 5;

  const roundTeams = await db.queryAsync<{ players: string | null }>(
    `SELECT t.players FROM matches m JOIN teams t ON t.id IN (m.team1_id, m.team2_id)
      WHERE m.tournament_id = ? AND m.round = ?`,
    [tournamentId, roundNumber]
  );
  const playing = new Set(
    roundTeams.flatMap((t) => (JSON.parse(t.players || '[]') as Player[]).map((p) => p.steamId))
  );
  const bench = (await getRegisteredPlayers(tournamentId, { active: true })).filter(
    (p) => !playing.has(p.id)
  );

  const botFill =
    getIntegration(tournament.game ?? DEFAULT_GAME).fillsShortTeams?.(tournament) ?? false;
  const teamCount =
    (botFill ? botFillTeamCount(bench.length, teamSize) : undefined) ??
    Math.floor(bench.length / (teamSize * 2)) * 2;
  if (teamCount < 2) return [];
  const take = bench.slice(0, Math.min(bench.length, teamCount * teamSize));

  const existing = await db.queryOneAsync<{ n: number }>(
    'SELECT COUNT(*)::INTEGER AS n FROM matches WHERE tournament_id = ? AND round = ?',
    [tournamentId, roundNumber]
  );
  const { teams } = await balanceTeams(
    take.map((p) => p.id),
    teamSize,
    true,
    tournament.game,
    teamCount
  );
  const matches = await insertRoundMatches(
    tournament,
    tournamentId,
    roundNumber,
    map,
    teams,
    Number(existing?.n ?? 0) + 1
  );
  const slugs = matches.map((m) => m.slug);
  log.info(`Round ${roundNumber}: ${slugs.length} extra match(es) from the bench`, { slugs });
  if (slugs.length > 0) {
    const { scheduler } = await import('../core/scheduler');
    void scheduler
      .allocateSpecificMatches(tournamentId, slugs, process.env.FRONTEND_BASE_URL ?? '')
      .catch((error) => log.error('Allocating bench matches failed', { error }));
  }
  return slugs;
}

/**
 * Check if a round is complete
 */
export async function checkRoundCompletion(
  tournamentId: number,
  roundNumber: number
): Promise<boolean> {
  const matches = await db.queryAsync<DbMatchRow>(
    'SELECT * FROM matches WHERE tournament_id = ? AND round = ?',
    [tournamentId, roundNumber]
  );

  if (matches.length === 0) {
    log.warn(`No matches found for round ${roundNumber}. Round cannot be considered complete.`);
    return false; // No matches for this round
  }

  // Check if all matches are over (a match nobody came to is cancelled)
  const allComplete = matches.every((m) => ['completed', 'cancelled'].includes(String(m.status)));

  if (!allComplete) {
    const completed = matches.filter((m) => m.status === 'completed').length;
    log.debug(`Round ${roundNumber} progress: ${completed}/${matches.length} matches completed`);
  }

  return allComplete;
}

/**
 * Advance to next round automatically
 * Called when current round is complete
 */
/**
 * The tournament's breaks between rounds (settings.roundBreaks): `minutes` after
 * every round, and `after` a longer (or shorter) one after given rounds, e.g.
 * { minutes: 0, after: { "3": 30 } } = three rounds back to back, 30 minutes,
 * then the rest. Without it, the site's break between matches (default 5).
 */
export interface RoundBreaks {
  minutes?: number;
  after?: Record<string, number>;
}

/** Minutes of break after `round` (round 1 → before round 2). */
export async function breakAfterRound(tournamentId: number, round: number): Promise<number> {
  const row = await db.queryOneAsync<{ settings: string | null }>(
    'SELECT settings FROM tournament WHERE id = ?',
    [tournamentId]
  );
  let breaks: RoundBreaks | undefined;
  try {
    breaks = (JSON.parse(row?.settings ?? '{}') as { roundBreaks?: RoundBreaks }).roundBreaks;
  } catch {
    breaks = undefined;
  }
  const valid = (n: unknown) =>
    typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 24 * 60 ? n : undefined;
  const special = valid(breaks?.after?.[String(round)]);
  if (special !== undefined) return special;
  const every = valid(breaks?.minutes);
  if (every !== undefined) return every;
  const raw = await settingsService.getSetting('at_match_break_minutes');
  const site = raw === null || raw === undefined || raw === '' ? 5 : Number(raw);
  return Number.isFinite(site) && site > 0 ? site : 0;
}

/** Hold a new shuffle round's matches for the break after the round before it. */
async function holdRoundForBreak(
  tournamentId: number,
  round: number,
  matches: DbMatchRow[]
): Promise<void> {
  try {
    const minutes = await breakAfterRound(tournamentId, round - 1);
    if (minutes <= 0) return;
    const until = Math.floor(Date.now() / 1000) + Math.round(minutes * 60);
    const { holdForBreak } = await import('./matchHolds');
    for (const m of matches) {
      await holdForBreak(m.slug, until, `Break between rounds (${minutes} min)`);
    }
    log.info(`Shuffle round ${round}: break until ${new Date(until * 1000).toISOString()}`);
  } catch (error) {
    log.warn(`Shuffle round ${round}: could not hold for the break`, {
      error: (error as Error).message,
    });
  }
}

export async function advanceToNextRound(tournamentId: number): Promise<{
  roundNumber: number;
  matches: DbMatchRow[];
} | null> {
  const tournament = await getShuffleTournament(tournamentId);
  if (!tournament) {
    throw new Error('No shuffle tournament found. Please create a shuffle tournament first.');
  }

  // Get current round (find highest round with matches)
  const currentRoundResult = await db.queryOneAsync<{ max_round: number }>(
    'SELECT MAX(round) as max_round FROM matches WHERE tournament_id = ?',
    [tournamentId]
  );

  const currentRound = currentRoundResult?.max_round || 0;

  if (currentRound === 0) {
    log.info('No rounds have been generated yet. Starting from round 1.');
  }

  // Check if current round is complete
  if (currentRound > 0) {
    const isComplete = await checkRoundCompletion(tournamentId, currentRound);
    if (!isComplete) {
      log.debug(`Round ${currentRound} is not complete yet`);
      return null;
    }
  }

  // Get map sequence
  const mapSequence = tournament.mapSequence || tournament.maps;
  const nextRound = currentRound + 1;

  // Too few players left for another round (no-shows dropped out): the
  // tournament ends here instead of hanging between rounds.
  const outOfPlayers =
    currentRound > 0 &&
    (await getRegisteredPlayers(tournamentId, { active: true })).length <
      (tournament.teamSize || 5) * 2;

  // Check if tournament is complete
  if (nextRound > mapSequence.length || outOfPlayers) {
    // Tournament complete
    const completedAt = Math.floor(Date.now() / 1000);
    await db.updateAsync(
      'tournament',
      {
        status: 'completed',
        completed_at: completedAt,
        updated_at: completedAt,
      },
      'id = ?',
      [tournamentId]
    );

    // The leaderboard's top three players get the tournament's prizes (CS2: skins).
    try {
      const board = await getPlayerLeaderboard(tournamentId);
      const placed = board
        .filter((p) => p.matchWins + p.matchLosses > 0 && /^7656\d{13}$/.test(p.playerId))
        .slice(0, 4)
        .map((p, i) => ({ place: (i + 1) as 1 | 2 | 3 | 4, steamIds: [p.playerId] }));
      const row = await db.queryOneAsync<DbTournamentRow>('SELECT * FROM tournament WHERE id = ?', [
        tournamentId,
      ]);
      if (row) {
        const { awardPlacements } = await import('../utils/matchProgression');
        await awardPlacements(row, placed);
      }
    } catch (error) {
      log.error('Shuffle placements: could not award prizes', { error });
    }

    log.success(
      (outOfPlayers
        ? `Shuffle tournament completed after round ${currentRound}: too few players left. `
        : `Shuffle tournament completed! All ${mapSequence.length} round(s) finished. `) +
        `Final leaderboard available at /tournament/${tournamentId}/leaderboard`
    );
    return null;
  }

  // Generate next round matches
  const result = await generateRoundMatches(tournamentId, nextRound);

  // A break between rounds: players get new partners every round, so the break between a
  // team's matches (veto/break.ts) never finds an earlier match. Hold the round instead.
  if (currentRound > 0) await holdRoundForBreak(tournamentId, nextRound, result.matches);

  // Update tournament status if starting first round
  if (currentRound === 0) {
    await db.updateAsync(
      'tournament',
      {
        status: 'in_progress',
        started_at: Math.floor(Date.now() / 1000),
        updated_at: Math.floor(Date.now() / 1000),
      },
      'id = ?',
      [tournamentId]
    );
  }

  log.success(`Advanced to round ${nextRound}`);

  return {
    roundNumber: nextRound,
    matches: result.matches,
  };
}

/**
 * Get player leaderboard
 */
export async function getPlayerLeaderboard(
  tournamentId: number
): Promise<PlayerLeaderboardEntry[]> {
  const players = await getRegisteredPlayers(tournamentId);

  // Get match results for all players
  const leaderboard: PlayerLeaderboardEntry[] = await Promise.all(
    players.map(async (player) => {
      // Get all matches this player participated in
      const matches = await db.queryAsync<{
        match_slug: string;
        team: string;
        won_match: boolean;
      }>(
        `SELECT match_slug, team, won_match 
         FROM player_match_stats 
         WHERE player_id = ? AND match_slug IN (
           SELECT slug FROM matches WHERE tournament_id = ?
         )`,
        [player.id, tournamentId]
      );

      // Deduplicate by match_slug so we only count each match once per player,
      // even if multiple player_match_stats rows exist for the same match
      // (e.g. if stats were re-tracked after late events).
      const matchBySlug = new Map<string, { team: string; won_match: boolean }>();
      for (const row of matches) {
        matchBySlug.set(row.match_slug, { team: row.team, won_match: row.won_match });
      }
      const uniqueMatches = Array.from(matchBySlug.values());

      const wins = uniqueMatches.filter((m) => m.won_match).length;
      const losses = uniqueMatches.filter((m) => !m.won_match).length;
      const totalMatches = uniqueMatches.length;
      const winRate = totalMatches > 0 ? wins / totalMatches : 0;

      // Aggregate ELO change for this tournament only
      const eloChangeRow = await db.queryOneAsync<{ total_elo_change: number }>(
        `
          SELECT COALESCE(SUM(elo_change), 0) as total_elo_change
          FROM player_rating_history
          WHERE player_id = ?
            AND match_slug IN (SELECT slug FROM matches WHERE tournament_id = ?)
        `,
        [player.id, tournamentId]
      );
      const eloChange = eloChangeRow?.total_elo_change ?? 0;

      // Calculate average ADR
      const statsWithAdr = await db.queryAsync<{ adr: number }>(
        `SELECT adr FROM player_match_stats 
         WHERE player_id = ? AND match_slug IN (
           SELECT slug FROM matches WHERE tournament_id = ?
         ) AND adr IS NOT NULL`,
        [player.id, tournamentId]
      );

      const averageAdr =
        statsWithAdr.length > 0
          ? statsWithAdr.reduce((sum, s) => sum + (s.adr || 0), 0) / statsWithAdr.length
          : undefined;

      return {
        playerId: player.id,
        name: player.name,
        avatar: player.avatar_url || undefined,
        currentElo: player.current_elo,
        startingElo: player.starting_elo,
        matchWins: wins,
        matchLosses: losses,
        winRate,
        eloChange,
        averageAdr: averageAdr ? Math.round(averageAdr * 100) / 100 : undefined,
      };
    })
  );

  // Sort by wins (descending), then by ELO (descending), then by ADR (descending)
  leaderboard.sort((a, b) => {
    if (b.matchWins !== a.matchWins) {
      return b.matchWins - a.matchWins;
    }
    if (b.currentElo !== a.currentElo) {
      return b.currentElo - a.currentElo;
    }
    const adrA = a.averageAdr ?? 0;
    const adrB = b.averageAdr ?? 0;
    return adrB - adrA;
  });

  return leaderboard;
}

/**
 * Get tournament leaderboard (public)
 *
 * Supports both shuffle tournaments (player-based Swiss style) and
 * standard bracket tournaments (team-based single/double elimination).
 */
export async function getTournamentLeaderboard(tournamentId: number): Promise<{
  tournament: TournamentResponse;
  leaderboard: PlayerLeaderboardEntry[];
  currentRound: number;
  totalRounds: number;
  roundStatus?: RoundStatus;
  teams?: TeamLeaderboardEntry[];
  /** Matches currently live or loaded, across the whole tournament. Powers the public "live now" strip. */
  liveMatchCount: number;
}> {
  // Load base tournament row
  const row = await db.queryOneAsync<DbTournamentRow>('SELECT * FROM tournament WHERE id = ?', [
    tournamentId,
  ]);

  if (!row) {
    throw new Error('Tournament not found');
  }

  // Postgres returns COUNT(*) as a bigint-safe string; coerce it explicitly.
  const liveMatchCountResult = await db.queryOneAsync<{ count: number | string }>(
    `SELECT COUNT(*) as count FROM matches WHERE tournament_id = ? AND status IN ('live', 'loaded')`,
    [tournamentId]
  );
  const liveMatchCount = Number(liveMatchCountResult?.count ?? 0);

  // Shuffle tournaments keep the existing behaviour: player-only leaderboard
  // driven by registered players and Swiss-style rounds.
  if (row.type === 'shuffle') {
    const tournament = await getShuffleTournament(tournamentId);
    if (!tournament) {
      throw new Error('No shuffle tournament found');
    }

    const leaderboard = await getPlayerLeaderboard(tournamentId);

    const currentRoundResult = await db.queryOneAsync<{ max_round: number }>(
      'SELECT MAX(round) as max_round FROM matches WHERE tournament_id = ?',
      [tournamentId]
    );
    const currentRound = currentRoundResult?.max_round || 0;
    const totalRounds = tournament.mapSequence?.length || tournament.maps.length;

    let roundStatus: RoundStatus | undefined;
    if (currentRound > 0) {
      const matches = await db.queryAsync<DbMatchRow>(
        'SELECT * FROM matches WHERE tournament_id = ? AND round = ?',
        [tournamentId, currentRound]
      );

      const completed = matches.filter((m) => m.status === 'completed').length;
      const mapSequence = tournament.mapSequence || tournament.maps;
      const map = currentRound <= mapSequence.length ? mapSequence[currentRound - 1] : '';

      roundStatus = {
        roundNumber: currentRound,
        totalMatches: matches.length,
        completedMatches: completed,
        pendingMatches: matches.length - completed,
        isComplete: completed === matches.length && matches.length > 0,
        map,
      };
    }

    return {
      tournament,
      leaderboard,
      currentRound,
      totalRounds,
      roundStatus,
      liveMatchCount,
    };
  }

  // Standard tournament (single_elimination / double_elimination / round_robin / swiss):
  // build the public tournament object (via the shared row helper so no column
  // is dropped), team standings, and player leaderboard.
  const baseTournament: TournamentResponse = tournamentRowToResponse(row);
  const teamIds = baseTournament.teamIds;
  baseTournament.teams = [];

  // Team standings for this tournament
  let teams: TeamLeaderboardEntry[] = [];
  // Which team each player (by Steam ID) is on, for the player table.
  const teamOfPlayer = new Map<
    string,
    { id: string; name: string; tag?: string | null; logoUrl?: string | null }
  >();
  if (teamIds.length > 0) {
    const placeholders = teamIds.map(() => '?').join(',');
    const teamRows = await db.queryAsync<DbTeamRow & { players: string | null }>(
      `SELECT id, name, tag, players, logo_updated_at FROM teams WHERE id IN (${placeholders})`,
      teamIds
    );
    for (const team of teamRows) {
      let roster: Array<{ steamId?: string; steamid?: string }> = [];
      try {
        const parsed = JSON.parse(team.players ?? '[]') as unknown;
        if (Array.isArray(parsed)) roster = parsed as typeof roster;
      } catch {
        roster = [];
      }
      for (const member of roster) {
        const steamId = member.steamId ?? member.steamid;
        if (steamId)
          teamOfPlayer.set(steamId, {
            id: team.id,
            name: team.name,
            tag: team.tag ?? null,
            // The team's crest on the leaderboard's team column.
            logoUrl: logoUrl(
              team.id,
              (team as { logo_updated_at?: number | null }).logo_updated_at
            ),
          });
      }
    }

    // Get all completed matches for win/loss counts
    const matches = await db.queryAsync<DbMatchRow>(
      'SELECT team1_id, team2_id, winner_id, round FROM matches WHERE tournament_id = ? AND status = ?',
      [row.id, 'completed']
    );

    teams = teamRows.map((team) => {
      const played = matches.filter((m) => m.team1_id === team.id || m.team2_id === team.id);
      const wins = played.filter((m) => m.winner_id === team.id).length;
      const losses = played.filter((m) => m.winner_id && m.winner_id !== team.id).length;
      const matchCount = played.length;
      const winRate = matchCount > 0 ? wins / matchCount : 0;

      return {
        teamId: team.id,
        name: team.name,
        tag: team.tag ?? null,
        matchWins: wins,
        matchLosses: losses,
        matchCount,
        winRate,
      };
    });

    if (row.type === 'swiss') {
      // Same standings (and order) the Swiss pairing uses.
      const standings = await getSwissStandingEntries(row.id);
      const byTeam = new Map(teams.map((t) => [t.teamId, t]));
      teams = standings.flatMap((s) => {
        const team = byTeam.get(s.teamId);
        if (!team) return [];
        return [
          {
            ...team,
            matchWins: s.wins,
            matchLosses: s.losses,
            rank: s.rank,
            buchholz: s.buchholz,
            roundDiff: s.roundDiff,
          },
        ];
      });
    } else if (row.type === 'round_robin') {
      // Same standings (and order) the bracket and the champion use.
      const standings = await getRoundRobinStandingEntries(row.id);
      const byTeam = new Map(teams.map((t) => [t.teamId, t]));
      teams = standings.flatMap((s) => {
        const team = byTeam.get(s.teamId);
        if (!team) return [];
        return [{ ...team, rank: s.rank, roundDiff: s.roundDiff }];
      });
    } else {
      // Sort teams by wins desc, then name
      teams.sort((a, b) => {
        if (b.matchWins !== a.matchWins) return b.matchWins - a.matchWins;
        return a.name.localeCompare(b.name);
      });
    }

    baseTournament.teams = teamRows.map((t) => ({
      id: t.id,
      name: t.name,
      tag: t.tag ?? undefined,
    }));
  }

  // The champion, for the finished tournament's header (same rule the admin
  // tournament route uses). Imported here to keep the two services from
  // importing each other at load.
  if (baseTournament.status === 'completed') {
    const { tournamentService } = await import('./tournamentService');
    baseTournament.winner = await tournamentService.getTournamentWinner(
      baseTournament.id,
      baseTournament.type,
      baseTournament.teams
    );
  }

  // Player leaderboard for this tournament, sorted by current ELO
  const playerRows = await db.queryAsync<{
    player_id: string;
    name: string;
    avatar_url: string | null;
    current_elo: number;
    starting_elo: number;
    match_wins: number;
    match_losses: number;
    match_count: number;
    total_kills: number;
    total_deaths: number;
    total_assists: number;
    total_damage: number;
    total_rounds: number;
    total_headshots: number;
    total_flash_assists: number;
    total_utility_damage: number;
  }>(
    `
      SELECT
        p.id as player_id,
        p.name,
        p.avatar_url,
        ${RATING_ELO} AS current_elo,
        p.starting_elo,
        SUM(CASE WHEN pms.won_match THEN 1 ELSE 0 END) as match_wins,
        SUM(CASE WHEN pms.won_match THEN 0 ELSE 1 END) as match_losses,
        COUNT(DISTINCT pms.match_slug) as match_count,
        COALESCE(SUM(pms.kills), 0) as total_kills,
        COALESCE(SUM(pms.deaths), 0) as total_deaths,
        COALESCE(SUM(pms.assists), 0) as total_assists,
        COALESCE(SUM(pms.total_damage), 0) as total_damage,
        COALESCE(SUM(pms.rounds_played), 0) as total_rounds,
        COALESCE(SUM(pms.headshots), 0) as total_headshots,
        COALESCE(SUM(pms.flash_assists), 0) as total_flash_assists,
        COALESCE(SUM(pms.utility_damage), 0) as total_utility_damage
      FROM player_match_stats pms
      JOIN matches m ON pms.match_slug = m.slug
      JOIN players p ON p.id = pms.player_id
      ${ratingJoin('p')}
      WHERE m.tournament_id = ?
      GROUP BY p.id, p.name, p.avatar_url, pgr.current_elo, p.starting_elo
    `,
    [ratingGame(row.game), row.id]
  );

  // Aggregate ELO change for this tournament only, treating the first recorded
  // post-match rating as the "starting point" to avoid huge negative jumps
  // from initial calibration (e.g. 3000 -> realistic value).
  const ratingRows = await db.queryAsync<{
    player_id: string;
    elo_after: number;
    created_at: number;
  }>(
    `
      SELECT prh.player_id, prh.elo_after, prh.created_at
      FROM player_rating_history prh
      JOIN matches m ON prh.match_slug = m.slug
      WHERE m.tournament_id = ?
      ORDER BY prh.player_id, prh.created_at ASC
    `,
    [row.id]
  );

  const eloChangeMap = new Map<string, number>();
  for (const r of ratingRows) {
    const existing = eloChangeMap.get(r.player_id);
    if (existing === undefined) {
      // First record for this player: initialize with [firstAfter, lastAfter]
      eloChangeMap.set(r.player_id, NaN); // placeholder, will recalc later
    }
  }
  // Compute per-player first/last elo_after
  const firstLast = new Map<string, { first: number; last: number }>();
  for (const r of ratingRows) {
    const current = firstLast.get(r.player_id);
    if (!current) {
      firstLast.set(r.player_id, { first: r.elo_after, last: r.elo_after });
    } else {
      current.last = r.elo_after;
    }
  }
  firstLast.forEach((v, playerId) => {
    eloChangeMap.set(playerId, v.last - v.first);
  });

  const leaderboard: PlayerLeaderboardEntry[] = playerRows.map((pr) => {
    const winRate = pr.match_count > 0 ? pr.match_wins / pr.match_count : 0;
    const averageAdr = pr.total_rounds > 0 ? pr.total_damage / pr.total_rounds : undefined;

    return {
      playerId: pr.player_id,
      name: pr.name,
      avatar: pr.avatar_url || undefined,
      currentElo: pr.current_elo,
      startingElo: pr.starting_elo,
      matchWins: pr.match_wins,
      matchLosses: pr.match_losses,
      winRate,
      eloChange: eloChangeMap.get(pr.player_id) ?? 0,
      averageAdr: averageAdr ? Math.round(averageAdr * 100) / 100 : undefined,
      kills: Number(pr.total_kills),
      deaths: Number(pr.total_deaths),
      assists: Number(pr.total_assists),
      headshots: Number(pr.total_headshots),
      flashAssists: Number(pr.total_flash_assists),
      utilityDamage: Number(pr.total_utility_damage),
      roundsPlayed: Number(pr.total_rounds),
      team: teamOfPlayer.get(pr.player_id) ?? null,
    };
  });

  // Sort players by ELO (desc), then wins, then ADR
  leaderboard.sort((a, b) => {
    if (b.currentElo !== a.currentElo) return b.currentElo - a.currentElo;
    if (b.matchWins !== a.matchWins) return b.matchWins - a.matchWins;
    const adrA = a.averageAdr ?? 0;
    const adrB = b.averageAdr ?? 0;
    return adrB - adrA;
  });

  // For standard brackets, derive current/total rounds from matches only
  const currentRoundResult = await db.queryOneAsync<{ max_round: number }>(
    'SELECT MAX(round) as max_round FROM matches WHERE tournament_id = ?',
    [row.id]
  );
  const currentRound = currentRoundResult?.max_round || 0;
  const totalRounds = currentRound || 0;

  return {
    tournament: baseTournament,
    leaderboard,
    currentRound,
    totalRounds,
    roundStatus: undefined,
    teams,
    liveMatchCount,
  };
}

/**
 * Get shuffle tournament (helper)
 */
export async function getShuffleTournament(
  tournamentId: number
): Promise<TournamentResponse | null> {
  const row = await db.queryOneAsync<DbTournamentRow>('SELECT * FROM tournament WHERE id = ?', [
    tournamentId,
  ]);

  if (!row || row.type !== 'shuffle') {
    return null;
  }

  return {
    ...tournamentRowToResponse(row),
    type: 'shuffle',
    // Shuffle teams are built from registered players; 5v5 unless configured.
    teamSize: row.team_size || 5,
  };
}

/**
 * No-shows drop out (a shuffle): when a shuffle match goes live (at the latest
 * when warmup's autostart runs out), a signed-up player on its roster who never
 * joined the server is marked out of the shuffle (left_at), so the rounds after
 * are made without them; their results so far stay. `seen` says whether a
 * player was ever on the match's server. Nothing happens when no roster player
 * was seen at all (the platform lost track, e.g. after a restart). Returns the
 * players marked out.
 */
export async function dropShuffleNoShows(
  match: {
    slug: string;
    tournament_id: number | null;
    config?: string | null;
    loaded_at?: number | null;
  },
  seen: (steamId: string) => boolean,
  options: { force?: boolean } = {}
): Promise<string[]> {
  if (!match.tournament_id) return [];
  const t = await db.queryOneAsync<{ type: string; status: string }>(
    'SELECT type, status FROM tournament WHERE id = ?',
    [match.tournament_id]
  );
  if (t?.type !== 'shuffle' || t.status !== 'in_progress') return [];
  const config = match.config ?? '';
  const ids = new Set(config.match(/\b7656\d{13}\b/g) ?? []);
  if (ids.size === 0) return [];
  const signed = await db.queryAsync<{ player_id: string }>(
    'SELECT player_id FROM shuffle_tournament_players WHERE tournament_id = ? AND left_at IS NULL',
    [match.tournament_id]
  );
  const roster = signed.map((r) => r.player_id).filter((id) => ids.has(id));
  if (roster.length === 0) return [];
  // Who connected is kept in memory. When the platform restarted after the
  // match loaded, a player who did join reads as never seen; then drop no one
  // unless someone was seen. Up the whole warmup, nobody showing up is real.
  const startedAt = Math.floor(Date.now() / 1000 - process.uptime());
  const watchedWarmup = !!match.loaded_at && startedAt <= Number(match.loaded_at);
  if (!options.force && !watchedWarmup && !roster.some(seen)) return [];
  const missing = roster.filter((id) => !seen(id));
  const now = Math.floor(Date.now() / 1000);
  for (const id of missing) {
    await db.runAsync(
      'UPDATE shuffle_tournament_players SET left_at = ?, left_reason = ? WHERE tournament_id = ? AND player_id = ? AND left_at IS NULL',
      [now, 'no_show', match.tournament_id, id]
    );
  }
  if (missing.length > 0) {
    log.warn(
      `Shuffle ${match.tournament_id}: ${missing.length} no-show(s) in ${match.slug} marked out`,
      {
        players: missing,
      }
    );
    emitTournamentUpdate({ id: match.tournament_id, action: 'tournament_updated' });
    await noticeNoShows(match.tournament_id, match.slug, missing).catch((error: unknown) =>
      log.warn(`Shuffle ${match.tournament_id}: no-show notices failed`, { error: String(error) })
    );
  }
  return missing;
}

/**
 * Tells each no-show they are out of the next draws (and how to get back in:
 * "I'm back" on the tournament page), and the admins (their bell) who was
 * marked out.
 * Once per match (a second check sends nothing new).
 */
async function noticeNoShows(tournamentId: number, slug: string, missing: string[]) {
  const { notificationService } = await import('./notificationService');
  const t = await db.queryOneAsync<{ name: string }>('SELECT name FROM tournament WHERE id = ?', [
    tournamentId,
  ]);
  const name = t?.name ?? '';
  for (const id of missing) {
    await notificationService.notifyOnce(
      [id],
      'tournament',
      { tournamentId, name, event: 'no_show', matchSlug: slug },
      `tournament:${tournamentId}:no_show:${slug}`
    );
  }
  const players = await playerService.getPlayersByIds(missing);
  const names = missing.map((id) => players.find((p) => p.id === id)?.name || id);
  const { adminNoticeService } = await import('./adminNoticeService');
  await adminNoticeService.raise(
    'shuffle_no_show',
    { matchSlug: slug, tournamentId, players: names.join(', ') },
    `shuffle_no_show:${slug}`
  );
}

/**
 * Auto-start found nobody from a shuffle match's roster on the server: the
 * match is called off instead of played by bots. Everyone on it is marked out
 * (they never came), the server is freed, and the round moves on when its
 * other matches are done.
 */
export async function cancelEmptyShuffleMatch(slug: string): Promise<boolean> {
  const match = await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE slug = ?', [slug]);
  if (!match || String(match.status) !== 'loaded' || !match.tournament_id) return false;
  const dropped = await dropShuffleNoShows(match, () => false, { force: true });
  if (dropped.length === 0) return false;
  const { scheduler } = await import('../core/scheduler');
  await scheduler.cancelMatch(match, 'force-cancel').catch((error: unknown) =>
    log.warn(`Shuffle ${match.tournament_id}: could not end ${slug} on its server`, {
      error: String(error),
    })
  );
  const { settleEndedMatch } = await import('./matchTerminationService');
  await settleEndedMatch(match, 'nobody joined');
  const { checkAndAdvanceShuffleRound } = await import('../core/matchLifecycle');
  await checkAndAdvanceShuffleRound(match.tournament_id, match.round);
  return true;
}

/**
 * A player marked out as a no-show who joins their match late (a bot took
 * their slot when it started) is back in: they play this match and are drawn
 * for the next rounds. Returns whether they were brought back.
 */
export async function bringBackLateJoiner(
  match: { slug: string; tournament_id: number | null; config?: string | null },
  steamId: string
): Promise<boolean> {
  if (!match.tournament_id || !(match.config ?? '').includes(steamId)) return false;
  const t = await db.queryOneAsync<{ type: string; status: string }>(
    'SELECT type, status FROM tournament WHERE id = ?',
    [match.tournament_id]
  );
  if (t?.type !== 'shuffle' || t.status !== 'in_progress') return false;
  const left = await db.queryOneAsync<{ left_at: number | null }>(
    'SELECT left_at FROM shuffle_tournament_players WHERE tournament_id = ? AND player_id = ?',
    [match.tournament_id, steamId]
  );
  if (!left?.left_at) return false;
  await db.runAsync(
    'UPDATE shuffle_tournament_players SET left_at = NULL, left_reason = NULL WHERE tournament_id = ? AND player_id = ?',
    [match.tournament_id, steamId]
  );
  log.info(`Shuffle ${match.tournament_id}: ${steamId} joined ${match.slug} late and is back in`);
  return true;
}
