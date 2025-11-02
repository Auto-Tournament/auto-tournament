import { db } from '../config/database';
import { log } from '../utils/logger';
import { bracketsAdapter } from './bracketsAdapter';
import type { DbMatchRow, DbTeamRow, DbEventRow, DbTournamentRow } from '../types/database.types';
import type {
  Tournament,
  TournamentRow,
  TournamentResponse,
  CreateTournamentInput,
  UpdateTournamentInput,
  TournamentSettings,
  BracketMatch,
  BracketResponse,
} from '../types/tournament.types';

const DEFAULT_SETTINGS: TournamentSettings = {
  matchFormat: 'bo3',
  thirdPlaceMatch: false,
  autoAdvance: true,
  checkInRequired: false,
  seedingMethod: 'random',
};

class TournamentService {
  /**
   * Get the current tournament (only one tournament exists at a time)
   */
  getTournament(): TournamentResponse | null {
    const row = db.queryOne<TournamentRow>('SELECT * FROM tournament WHERE id = 1');
    if (!row) return null;

    const tournament = this.rowToTournament(row);
    const teams = this.getTeamsForTournament(tournament.team_ids);

    return {
      id: tournament.id,
      name: tournament.name,
      type: tournament.type,
      format: tournament.format,
      status: tournament.status,
      maps: tournament.maps,
      teamIds: tournament.team_ids,
      settings: tournament.settings,
      created_at: tournament.created_at,
      updated_at: tournament.updated_at,
      started_at: tournament.started_at,
      completed_at: tournament.completed_at,
      teams,
    };
  }

  /**
   * Create or replace the tournament
   */
  async createTournament(input: CreateTournamentInput): Promise<TournamentResponse> {
    const { name, type, format, maps, teamIds, settings } = input;

    // Validate team count based on tournament type
    this.validateTeamCount(type, teamIds.length);

    const tournamentSettings: TournamentSettings = {
      ...DEFAULT_SETTINGS,
      matchFormat: format,
      ...settings,
    };

    const now = Math.floor(Date.now() / 1000);

    // Delete existing tournament (if any) - we only support one tournament at a time
    db.exec('DELETE FROM tournament WHERE id = 1');

    // Insert new tournament
    db.insert('tournament', {
      id: 1,
      name,
      type,
      format,
      status: 'setup',
      maps: JSON.stringify(maps),
      team_ids: JSON.stringify(teamIds),
      settings: JSON.stringify(tournamentSettings),
      created_at: now,
      updated_at: now,
    });

    log.success(`Tournament created: ${name} (${type})`);

    // Auto-generate bracket
    try {
      await this.generateBracket();
      log.success('Bracket automatically generated');
    } catch (err) {
      log.error('Failed to auto-generate bracket', err);
      // Re-throw to prevent returning tournament in broken state
      throw new Error(
        `Bracket generation failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    return this.getTournament()!;
  }

  /**
   * Update tournament settings
   */
  updateTournament(input: UpdateTournamentInput): TournamentResponse {
    const existing = this.getTournament();
    if (!existing) {
      throw new Error('No tournament exists');
    }

    const isLive = existing.status !== 'setup';

    // Prevent structural changes when tournament is live
    if (isLive) {
      if (input.type && input.type !== existing.type) {
        throw new Error('Cannot change tournament type after tournament has started');
      }
      if (input.format && input.format !== existing.format) {
        throw new Error('Cannot change match format after tournament has started');
      }
    }

    const updates: Record<string, unknown> = {
      updated_at: Math.floor(Date.now() / 1000),
    };

    if (input.name) updates.name = input.name;
    if (input.type && !isLive) {
      updates.type = input.type;
      this.validateTeamCount(input.type, existing.teamIds.length);
    }
    if (input.format && !isLive) updates.format = input.format;
    if (input.maps) updates.maps = JSON.stringify(input.maps);
    if (input.teamIds) {
      this.validateTeamCount(existing.type, input.teamIds.length);

      // If tournament is live, only allow team replacement (not bracket regeneration)
      if (isLive) {
        this.replaceTeams(existing.teamIds, input.teamIds);
        log.debug('Teams replaced in live tournament');
      }

      updates.team_ids = JSON.stringify(input.teamIds);
    }
    if (input.settings) {
      const newSettings = { ...existing.settings, ...input.settings };
      updates.settings = JSON.stringify(newSettings);
    }

    db.update('tournament', updates, 'id = ?', [1]);
    log.debug('Tournament updated');

    // Note: Bracket regeneration must now be done explicitly via regenerateBracket()
    // This prevents accidental bracket resets

    return this.getTournament()!;
  }

  /**
   * Replace teams in existing bracket without regenerating
   * Used for swapping teams in live tournaments
   */
  private replaceTeams(oldTeamIds: string[], newTeamIds: string[]): void {
    // Find which teams were removed and which were added
    const removedTeams = oldTeamIds.filter((id) => !newTeamIds.includes(id));
    const addedTeams = newTeamIds.filter((id) => !oldTeamIds.includes(id));

    if (removedTeams.length !== addedTeams.length) {
      throw new Error('Team replacement must have same number of teams');
    }

    // Replace each removed team with a new team in all matches
    for (let i = 0; i < removedTeams.length; i++) {
      const oldTeamId = removedTeams[i];
      const newTeamId = addedTeams[i];

      log.debug(`Replacing team ${oldTeamId} with ${newTeamId} in all matches`);

      // Update team1_id references
      db.query(`UPDATE matches SET team1_id = ? WHERE team1_id = ? AND tournament_id = 1`, [
        newTeamId,
        oldTeamId,
      ]);

      // Update team2_id references
      db.query(`UPDATE matches SET team2_id = ? WHERE team2_id = ? AND tournament_id = 1`, [
        newTeamId,
        oldTeamId,
      ]);

      // Update winner_id references
      db.query(`UPDATE matches SET winner_id = ? WHERE winner_id = ? AND tournament_id = 1`, [
        newTeamId,
        oldTeamId,
      ]);
    }
  }

  /**
   * Delete tournament and all associated matches
   */
  deleteTournament(): void {
    const existing = this.getTournament();
    if (existing && existing.status !== 'setup') {
      throw new Error(
        'Cannot delete tournament after it has started. Please finish or reset it first.'
      );
    }
    db.exec('DELETE FROM tournament WHERE id = 1');
    log.debug('Tournament deleted');
  }

  /**
   * Generate bracket for the tournament
   */
  async generateBracket(): Promise<BracketResponse> {
    const tournament = this.getTournament();
    if (!tournament) {
      throw new Error('No tournament exists');
    }

    if (tournament.status !== 'setup') {
      throw new Error('Cannot regenerate bracket after tournament has started');
    }

    // Delete existing matches
    db.exec('DELETE FROM matches WHERE tournament_id = 1');

    let matches: BracketMatch[] = [];

    try {
      if (tournament.type === 'swiss') {
        // Swiss tournaments need custom implementation (brackets-manager doesn't support it)
        matches = this.generateSwiss(tournament);
      } else {
        // Use brackets-manager for single_elimination, double_elimination, and round_robin
        bracketsAdapter.reset(); // Clear previous state
        const result = await bracketsAdapter.generateBracket(tournament);

        // Insert matches into database and track IDs for linking
        const slugToDbId: Map<string, number> = new Map();

        for (const matchData of result.matches) {
          const config = JSON.parse(matchData.config);
          const insertResult = db.insert('matches', {
            slug: matchData.slug,
            tournament_id: 1,
            round: matchData.round,
            match_number: matchData.matchNum,
            team1_id: matchData.team1Id,
            team2_id: matchData.team2Id,
            winner_id: matchData.winnerId,
            server_id: null,
            config: matchData.config,
            status: matchData.status,
            next_match_id: null, // Will be set in a second pass
            created_at: Math.floor(Date.now() / 1000),
          });

          slugToDbId.set(matchData.slug, insertResult.lastInsertRowid as number);

          matches.push({
            id: insertResult.lastInsertRowid as number,
            slug: matchData.slug,
            round: matchData.round,
            matchNumber: matchData.matchNum,
            team1: matchData.team1Id
              ? {
                  id: matchData.team1Id,
                  name: config.team1?.name || 'TBD',
                  tag: config.team1?.tag || 'TBD',
                }
              : null,
            team2: matchData.team2Id
              ? {
                  id: matchData.team2Id,
                  name: config.team2?.name || 'TBD',
                  tag: config.team2?.tag || 'TBD',
                }
              : null,
            winner: null,
            status: matchData.status,
            serverId: null,
            config,
            nextMatchId: null,
            createdAt: Math.floor(Date.now() / 1000),
          });
        }

        // Link matches (set next_match_id based on bracket structure)
        this.linkMatches(matches, slugToDbId, tournament.type);
      }

      // Update tournament status to 'ready'
      db.update(
        'tournament',
        { status: 'ready', updated_at: Math.floor(Date.now() / 1000) },
        'id = ?',
        [1]
      );

      log.debug(`Bracket generated: ${matches.length} matches created`);

      return {
        tournament: { ...tournament, status: 'ready' },
        matches,
        totalRounds: this.calculateTotalRounds(tournament.teamIds.length, tournament.type),
      };
    } catch (err) {
      log.error('Failed to generate bracket', err);
      throw err;
    }
  }

  /**
   * Explicitly regenerate brackets (DESTRUCTIVE - wipes all match data)
   * Should only be called with user confirmation
   */
  async regenerateBracket(force: boolean = false): Promise<BracketResponse> {
    const tournament = this.getTournament();
    if (!tournament) {
      throw new Error('No tournament exists');
    }

    // Safety check: prevent regeneration of live/completed tournaments unless forced
    if (!force && tournament.status !== 'setup') {
      throw new Error(
        'Cannot regenerate bracket for a live or completed tournament. ' +
          'Use force=true to override (this will delete all match data).'
      );
    }

    log.warn('Regenerating bracket - all existing match data will be deleted');

    // Generate new bracket (this also sets status to 'ready')
    const result = await this.generateBracket();

    log.success('Bracket regenerated successfully');
    return result;
  }

  /**
   * Reset tournament back to setup mode
   * Clears all matches and resets status
   */
  resetTournament(): TournamentResponse {
    const tournament = this.getTournament();
    if (!tournament) {
      throw new Error('No tournament exists');
    }

    log.warn('Resetting tournament to setup mode');

    // Delete all matches
    db.exec('DELETE FROM matches WHERE tournament_id = 1');
    db.exec(
      'DELETE FROM match_events WHERE match_slug IN (SELECT slug FROM matches WHERE tournament_id = 1)'
    );

    // Reset tournament status
    db.update(
      'tournament',
      {
        status: 'setup',
        updated_at: Math.floor(Date.now() / 1000),
      },
      'id = ?',
      [1]
    );

    log.success('Tournament reset to setup mode');
    return this.getTournament()!;
  }

  /**
   * Get bracket with all matches
   */
  getBracket(): BracketResponse | null {
    const tournament = this.getTournament();
    if (!tournament) return null;

    const matches = this.getMatches();
    const totalRounds = this.calculateTotalRounds(tournament.teamIds.length, tournament.type);

    return { tournament, matches, totalRounds };
  }

  /**
   * Get all matches for the tournament
   */
  private getMatches(): BracketMatch[] {
    const rows = db.query<DbMatchRow>(
      'SELECT * FROM matches WHERE tournament_id = 1 ORDER BY round, match_number'
    );

    return rows.map((row) => {
      const match: BracketMatch = {
        id: row.id,
        slug: row.slug,
        round: row.round,
        matchNumber: row.match_number,
        serverId: row.server_id,
        status: row.status,
        nextMatchId: row.next_match_id,
        createdAt: row.created_at,
        loadedAt: row.loaded_at,
        completedAt: row.completed_at,
      };

      // Parse config for additional details
      if (row.config) {
        try {
          match.config = JSON.parse(row.config);
        } catch {
          // Ignore parse errors
        }
      }

      // Attach team info if available
      if (row.team1_id) {
        const team1 = db.queryOne<DbTeamRow>('SELECT id, name, tag FROM teams WHERE id = ?', [
          row.team1_id,
        ]);
        if (team1) match.team1 = { id: team1.id, name: team1.name, tag: team1.tag || undefined };
      }
      if (row.team2_id) {
        const team2 = db.queryOne<DbTeamRow>('SELECT id, name, tag FROM teams WHERE id = ?', [
          row.team2_id,
        ]);
        if (team2) match.team2 = { id: team2.id, name: team2.name, tag: team2.tag || undefined };
      }
      if (row.winner_id) {
        const winner = db.queryOne<DbTeamRow>('SELECT id, name, tag FROM teams WHERE id = ?', [
          row.winner_id,
        ]);
        if (winner)
          match.winner = { id: winner.id, name: winner.name, tag: winner.tag || undefined };
      }

      // Get latest player stats from match events
      const playerStatsEvent = db.queryOne<DbEventRow>(
        `SELECT event_data FROM match_events 
         WHERE match_slug = ? AND event_type = 'player_stats' 
         ORDER BY received_at DESC LIMIT 1`,
        [row.slug]
      );

      if (playerStatsEvent) {
        try {
          const eventData = JSON.parse(playerStatsEvent.event_data);
          if (eventData.team1_players) {
            match.team1Players = eventData.team1_players;
          }
          if (eventData.team2_players) {
            match.team2Players = eventData.team2_players;
          }
        } catch {
          // Ignore parse errors
        }
      }

      // Get latest scores from series_end or round_end events
      const scoreEvent = db.queryOne<DbEventRow>(
        `SELECT event_data FROM match_events 
         WHERE match_slug = ? AND event_type IN ('series_end', 'round_end', 'map_end') 
         ORDER BY received_at DESC LIMIT 1`,
        [row.slug]
      );

      if (scoreEvent) {
        try {
          const eventData = JSON.parse(scoreEvent.event_data);
          if (eventData.team1_series_score !== undefined) {
            match.team1Score = eventData.team1_series_score;
          }
          if (eventData.team2_series_score !== undefined) {
            match.team2Score = eventData.team2_series_score;
          }
        } catch {
          // Ignore parse errors
        }
      }

      return match;
    });
  }

  /**
   * Generate single elimination bracket (now handled by brackets-manager)
   * @deprecated Use brackets-manager instead
   */

  private _unused_generateSingleElimination(tournament: TournamentResponse): BracketMatch[] {
    let teamIds = [...tournament.teamIds];
    const teamCount = teamIds.length;

    // Shuffle teams if random seeding
    if (tournament.settings.seedingMethod === 'random') {
      this.shuffleArray(teamIds);
    }

    // Calculate bracket structure
    const nextPowerOf2 = Math.pow(2, Math.ceil(Math.log2(teamCount)));
    const totalRounds = Math.log2(nextPowerOf2);
    const byesNeeded = nextPowerOf2 - teamCount;

    log.debug(`Single elimination: ${teamCount} teams, ${byesNeeded} byes, ${totalRounds} rounds`);

    // Create bracket with proper seeding for byes
    // Top seeds get byes (first byesNeeded teams)
    const teamsWithByes = teamIds.slice(0, byesNeeded);
    const teamsWithoutByes = teamIds.slice(byesNeeded);

    // Calculate how many first-round matches we need
    const firstRoundMatches = Math.floor(teamsWithoutByes.length / 2);

    log.debug(`First round: ${firstRoundMatches} matches, ${teamsWithByes.length} teams with byes`);

    // Build bracket structure
    const matchData: Array<{
      slug: string;
      round: number;
      matchNum: number;
      team1Id?: string;
      team2Id?: string;
      isWalkover?: boolean;
      winnerId?: string;
    }> = [];

    // Generate first round matches (teams without byes)
    for (let i = 0; i < firstRoundMatches; i++) {
      matchData.push({
        slug: this.generateMatchSlug(1, i + 1),
        round: 1,
        matchNum: i + 1,
        team1Id: teamsWithoutByes[i * 2],
        team2Id: teamsWithoutByes[i * 2 + 1],
      });
    }

    // Generate subsequent rounds (all empty, will be filled as matches complete)
    for (let round = 2; round <= totalRounds; round++) {
      const matchesInRound = Math.pow(2, totalRounds - round);
      for (let matchNum = 1; matchNum <= matchesInRound; matchNum++) {
        matchData.push({
          slug: this.generateMatchSlug(round, matchNum),
          round,
          matchNum,
          team1Id: undefined,
          team2Id: undefined,
        });
      }
    }

    // Pre-place teams with byes in round 2
    // Distribute them evenly across second round matches
    for (let i = 0; i < teamsWithByes.length; i++) {
      const matchIndex = firstRoundMatches + i; // Index in matchData
      if (matchIndex < matchData.length && matchData[matchIndex].round === 2) {
        // Alternate between team1 and team2 slots
        if (i % 2 === 0) {
          matchData[matchIndex].team1Id = teamsWithByes[i];
        } else {
          matchData[matchIndex].team2Id = teamsWithByes[i];
        }
      }
    }

    // Insert all matches and track their database IDs
    const slugToDbId: Record<string, number> = {};

    for (const data of matchData) {
      const config = this.generateMatchConfig(tournament, data.team1Id, data.team2Id, data.slug);

      // Determine status
      let status = 'pending';
      if (data.isWalkover) {
        status = 'completed'; // Walkovers are automatically completed
      } else if (data.team1Id && data.team2Id) {
        status = 'ready';
      }

      const result = db.insert('matches', {
        slug: data.slug,
        tournament_id: tournament.id,
        round: data.round,
        match_number: data.matchNum,
        team1_id: data.team1Id || null,
        team2_id: data.team2Id || null,
        winner_id: data.winnerId || null,
        server_id: null,
        config: JSON.stringify(config),
        status,
        next_match_id: null, // Set to null initially
        created_at: Math.floor(Date.now() / 1000),
        completed_at: data.isWalkover ? Math.floor(Date.now() / 1000) : null,
      });

      slugToDbId[data.slug] = result.lastInsertRowid as number;
    }

    // Second pass: Update matches with next_match_id using proper slug lookup
    for (let round = 1; round < totalRounds; round++) {
      const matchesInRound = Math.pow(2, totalRounds - round);

      for (let matchNum = 1; matchNum <= matchesInRound; matchNum++) {
        const currentSlug = this.generateMatchSlug(round, matchNum);
        const nextRound = round + 1;
        const nextMatchNum = Math.ceil(matchNum / 2);
        const nextSlug = this.generateMatchSlug(nextRound, nextMatchNum);

        // Only update if both slugs exist in our map
        if (slugToDbId[currentSlug] && slugToDbId[nextSlug]) {
          db.update('matches', { next_match_id: slugToDbId[nextSlug] }, 'id = ?', [
            slugToDbId[currentSlug],
          ]);
        }
      }
    }

    // Third pass: Advance walkover winners to next round
    for (const data of matchData) {
      if (data.isWalkover && data.winnerId) {
        // Find the next match slug
        const nextRound = data.round + 1;
        const nextMatchNum = Math.ceil(data.matchNum / 2);
        const nextSlug = this.generateMatchSlug(nextRound, nextMatchNum);
        const nextMatchDbId = slugToDbId[nextSlug];

        if (nextMatchDbId) {
          const match = db.queryOne<DbMatchRow>('SELECT * FROM matches WHERE id = ?', [
            nextMatchDbId,
          ]);
          if (match) {
            // Determine if winner goes to team1 or team2 slot
            const positionInRound = data.matchNum - 1;
            const isEvenMatch = positionInRound % 2 === 0;

            if (isEvenMatch) {
              db.update('matches', { team1_id: data.winnerId }, 'id = ?', [nextMatchDbId]);
            } else {
              db.update('matches', { team2_id: data.winnerId }, 'id = ?', [nextMatchDbId]);
            }

            // Check if next match is now ready or also a walkover
            const nextMatch = db.queryOne<DbMatchRow>('SELECT * FROM matches WHERE id = ?', [
              nextMatchDbId,
            ]);
            if (nextMatch) {
              if (nextMatch.team1_id && nextMatch.team2_id) {
                // Both teams assigned - update config and mark ready
                const updatedConfig = this.generateMatchConfig(
                  tournament,
                  nextMatch.team1_id,
                  nextMatch.team2_id,
                  nextMatch.slug
                );
                db.update(
                  'matches',
                  { status: 'ready', config: JSON.stringify(updatedConfig) },
                  'id = ?',
                  [nextMatchDbId]
                );
                log.debug(
                  `Match ${nextMatch.slug} now ready after walkover advancement: ${nextMatch.team1_id} vs ${nextMatch.team2_id}`
                );
              } else if (nextMatch.team1_id || nextMatch.team2_id) {
                // Still only one team - update config to show the one team
                const teamId = nextMatch.team1_id || nextMatch.team2_id;
                const updatedConfig = this.generateMatchConfig(
                  tournament,
                  nextMatch.team1_id || undefined,
                  nextMatch.team2_id || undefined,
                  nextMatch.slug
                );
                db.update('matches', { config: JSON.stringify(updatedConfig) }, 'id = ?', [
                  nextMatchDbId,
                ]);
                log.debug(
                  `Match ${nextMatch.slug} partially filled with ${teamId} (waiting for opponent)`
                );
              }
            }
          }
        }
      }
    }

    // Fourth pass: Check for cascading walkovers in round 2+
    this.propagateWalkovers();

    return this.getMatches();
  }

  /**
   * Propagate walkovers through subsequent rounds
   */
  private propagateWalkovers(): void {
    let changed = true;
    while (changed) {
      changed = false;
      const matches = db.query<DbMatchRow>(
        "SELECT * FROM matches WHERE tournament_id = 1 AND status = 'pending' AND (team1_id IS NOT NULL OR team2_id IS NOT NULL) ORDER BY round, match_number"
      );

      for (const match of matches) {
        // If only one team is present, it's a walkover
        if ((match.team1_id && !match.team2_id) || (!match.team1_id && match.team2_id)) {
          const winnerId = match.team1_id || match.team2_id;
          db.update(
            'matches',
            {
              winner_id: winnerId,
              status: 'completed',
              completed_at: Math.floor(Date.now() / 1000),
            },
            'id = ?',
            [match.id]
          );

          // Advance to next match
          if (match.next_match_id) {
            const nextMatch = db.queryOne<DbMatchRow>('SELECT * FROM matches WHERE id = ?', [
              match.next_match_id,
            ]);
            if (nextMatch) {
              // Determine slot based on match number
              const positionInRound = match.match_number - 1;
              const isEvenMatch = positionInRound % 2 === 0;

              const updateField = isEvenMatch ? 'team1_id' : 'team2_id';
              db.update('matches', { [updateField]: winnerId }, 'id = ?', [match.next_match_id]);

              // Update next match status and config
              const updatedNextMatch = db.queryOne<DbMatchRow>(
                'SELECT * FROM matches WHERE id = ?',
                [match.next_match_id]
              );
              if (updatedNextMatch && updatedNextMatch.team1_id && updatedNextMatch.team2_id) {
                // Both teams now assigned - get tournament for config generation
                const tournament = db.queryOne<DbTournamentRow>(
                  'SELECT * FROM tournament WHERE id = 1'
                );
                if (tournament) {
                  const maps = JSON.parse(tournament.maps);
                  const updatedConfig = {
                    matchid: updatedNextMatch.slug,
                    num_maps: tournament.format === 'bo1' ? 1 : tournament.format === 'bo3' ? 3 : 5,
                    maplist: maps,
                    players_per_team: 5,
                    clinch_series: true,
                  };

                  // Add team data
                  const team1 = db.queryOne<DbTeamRow & { players: string }>(
                    'SELECT * FROM teams WHERE id = ?',
                    [updatedNextMatch.team1_id]
                  );
                  const team2 = db.queryOne<DbTeamRow & { players: string }>(
                    'SELECT * FROM teams WHERE id = ?',
                    [updatedNextMatch.team2_id]
                  );

                  if (team1 && team2) {
                    Object.assign(updatedConfig, {
                      team1: {
                        name: team1.name,
                        tag: team1.tag || team1.name.substring(0, 4).toUpperCase(),
                        players: JSON.parse(team1.players),
                      },
                      team2: {
                        name: team2.name,
                        tag: team2.tag || team2.name.substring(0, 4).toUpperCase(),
                        players: JSON.parse(team2.players),
                      },
                    });

                    db.update(
                      'matches',
                      { status: 'ready', config: JSON.stringify(updatedConfig) },
                      'id = ?',
                      [match.next_match_id]
                    );
                    log.debug(
                      `Cascading walkover: ${updatedNextMatch.slug} now ready (${team1.name} vs ${team2.name})`
                    );
                  }
                }
              }

              changed = true;
            }
          }
        }
      }
    }
  }

  /**
   * Calculate next match ID based on current match ID
   * @deprecated
   */

  private _unused_calculateNextMatchId(
    currentMatchId: number,
    matchesInCurrentRound: number
  ): number {
    // Next match ID is calculated based on match tree structure
    return (
      currentMatchId +
      matchesInCurrentRound +
      Math.floor(((currentMatchId - 1) % matchesInCurrentRound) / 2)
    );
  }

  /**
   * Generate match configuration JSON for MatchZy
   */
  private generateMatchConfig(
    tournament: TournamentResponse,
    team1Id?: string,
    team2Id?: string,
    slug?: string
  ): Record<string, unknown> {
    const team1 = team1Id
      ? db.queryOne<DbTeamRow & { players: string }>('SELECT * FROM teams WHERE id = ?', [team1Id])
      : null;
    const team2 = team2Id
      ? db.queryOne<DbTeamRow & { players: string }>('SELECT * FROM teams WHERE id = ?', [team2Id])
      : null;

    const config: Record<string, unknown> = {
      matchid: slug || 'tbd',
      num_maps: tournament.format === 'bo1' ? 1 : tournament.format === 'bo3' ? 3 : 5,
      maplist: tournament.maps,
      players_per_team: 5,
      clinch_series: true,
      team1: team1
        ? {
            name: team1.name,
            tag: team1.tag || team1.name.substring(0, 4).toUpperCase(),
            players: JSON.parse(team1.players),
          }
        : { name: 'TBD', players: {} },
      team2: team2
        ? {
            name: team2.name,
            tag: team2.tag || team2.name.substring(0, 4).toUpperCase(),
            players: JSON.parse(team2.players),
          }
        : { name: 'TBD', players: {} },
    };

    return config;
  }

  /**
   * Generate match slug
   */
  private generateMatchSlug(round: number, matchNumber: number): string {
    return `round-${round}-match-${matchNumber}`;
  }

  /**
   * Generate double elimination bracket (now handled by brackets-manager)
   * @deprecated Use brackets-manager instead
   */

  private _unused_generateDoubleElimination(tournament: TournamentResponse): BracketMatch[] {
    const teamIds = [...tournament.teamIds];
    const teamCount = teamIds.length;

    if (tournament.settings.seedingMethod === 'random') {
      this.shuffleArray(teamIds);
    }

    // Calculate bracket structure - need next power of 2 for proper bracket
    const nextPowerOf2 = Math.pow(2, Math.ceil(Math.log2(teamCount)));
    const winnersRounds = Math.log2(nextPowerOf2);
    const losersRounds = (winnersRounds - 1) * 2;
    const byesNeeded = nextPowerOf2 - teamCount;

    log.debug(
      `Generating double elimination: ${teamCount} teams, ${byesNeeded} byes, ${winnersRounds} winners rounds, ${losersRounds} losers rounds`
    );

    // Track match IDs for linking
    const winnersBracket: Record<string, number> = {};
    const losersBracket: Record<string, number> = {};

    // ===== GENERATE WINNERS BRACKET =====
    for (let round = 1; round <= winnersRounds; round++) {
      const maxMatchesInRound = Math.pow(2, winnersRounds - round);
      let actualMatchNum = 1;

      for (let matchSlot = 1; matchSlot <= maxMatchesInRound; matchSlot++) {
        let team1Id: string | undefined;
        let team2Id: string | undefined;
        let status: 'pending' | 'ready' | 'completed' = 'pending';
        let winnerId: string | null = null;

        // First round: assign teams, only create matches where both teams exist
        if (round === 1) {
          const team1Index = (matchSlot - 1) * 2;
          const team2Index = team1Index + 1;
          team1Id = teamIds[team1Index] || undefined;
          team2Id = teamIds[team2Index] || undefined;

          // If only one team exists, they get a bye (walkover)
          if (team1Id && !team2Id) {
            status = 'completed';
            winnerId = team1Id;
          } else if (!team1Id && team2Id) {
            status = 'completed';
            winnerId = team2Id;
          } else if (team1Id && team2Id) {
            status = 'ready';
          } else {
            // No teams in this slot, skip creating the match
            continue;
          }
        }

        const slug = `wb-r${round}m${actualMatchNum}`;
        const config = this.generateMatchConfig(tournament, team1Id, team2Id, slug);

        const result = db.insert('matches', {
          slug,
          tournament_id: tournament.id,
          round,
          match_number: actualMatchNum,
          team1_id: team1Id || null,
          team2_id: team2Id || null,
          winner_id: winnerId,
          server_id: null,
          config: JSON.stringify(config),
          status,
          next_match_id: null,
          created_at: Math.floor(Date.now() / 1000),
          completed_at: status === 'completed' ? Math.floor(Date.now() / 1000) : null,
        });

        winnersBracket[slug] = result.lastInsertRowid as number;
        actualMatchNum++;
      }
    }

    // ===== GENERATE LOSERS BRACKET =====
    for (let round = 1; round <= losersRounds; round++) {
      // Losers bracket has alternating pattern:
      // Odd rounds: Teams from winners drop in
      // Even rounds: Winners from previous losers round advance
      const matchesInRound = Math.pow(2, Math.floor((losersRounds - round) / 2));

      for (let matchNum = 1; matchNum <= matchesInRound; matchNum++) {
        const slug = `lb-r${round}m${matchNum}`;
        const config = this.generateMatchConfig(tournament, undefined, undefined, slug);

        const result = db.insert('matches', {
          slug,
          tournament_id: tournament.id,
          round: winnersRounds + round,
          match_number: matchNum,
          team1_id: null,
          team2_id: null,
          winner_id: null,
          server_id: null,
          config: JSON.stringify(config),
          status: 'pending',
          next_match_id: null,
          created_at: Math.floor(Date.now() / 1000),
        });

        losersBracket[slug] = result.lastInsertRowid as number;
      }
    }

    // ===== GENERATE GRAND FINALS =====
    const gfConfig = this.generateMatchConfig(tournament, undefined, undefined, 'grand-finals');
    const gfResult = db.insert('matches', {
      slug: 'grand-finals',
      tournament_id: tournament.id,
      round: winnersRounds + losersRounds + 1,
      match_number: 1,
      team1_id: null,
      team2_id: null,
      winner_id: null,
      server_id: null,
      config: JSON.stringify(gfConfig),
      status: 'pending',
      next_match_id: null,
      created_at: Math.floor(Date.now() / 1000),
    });
    const grandFinalsId = gfResult.lastInsertRowid as number;

    // ===== LINK WINNERS BRACKET MATCHES =====
    for (let round = 1; round < winnersRounds; round++) {
      const matchesInRound = Math.pow(2, winnersRounds - round);

      for (let matchNum = 1; matchNum <= matchesInRound; matchNum++) {
        const currentSlug = `wb-r${round}m${matchNum}`;
        const nextMatchNum = Math.ceil(matchNum / 2);
        const nextSlug = `wb-r${round + 1}m${nextMatchNum}`;

        db.update('matches', { next_match_id: winnersBracket[nextSlug] }, 'id = ?', [
          winnersBracket[currentSlug]!,
        ]);
      }
    }

    // Link winners bracket finals to grand finals
    const wbFinalsSlug = `wb-r${winnersRounds}m1`;
    db.update('matches', { next_match_id: grandFinalsId }, 'id = ?', [
      winnersBracket[wbFinalsSlug]!,
    ]);

    // ===== LINK LOSERS BRACKET MATCHES =====
    for (let round = 1; round < losersRounds; round++) {
      const matchesInRound = Math.pow(2, Math.floor((losersRounds - round) / 2));

      for (let matchNum = 1; matchNum <= matchesInRound; matchNum++) {
        const currentSlug = `lb-r${round}m${matchNum}`;
        const nextMatchNum = Math.ceil(matchNum / 2);
        const nextSlug = `lb-r${round + 1}m${nextMatchNum}`;

        db.update('matches', { next_match_id: losersBracket[nextSlug] }, 'id = ?', [
          losersBracket[currentSlug]!,
        ]);
      }
    }

    // Link losers bracket finals to grand finals
    const lbFinalsSlug = `lb-r${losersRounds}m1`;
    db.update('matches', { next_match_id: grandFinalsId }, 'id = ?', [
      losersBracket[lbFinalsSlug]!,
    ]);

    // ===== AUTO-ADVANCE WALKOVER WINNERS =====
    // Find all completed matches (walkovers) and advance their winners
    const walkoverMatches = db.query<{
      id: number;
      slug: string;
      winner_id: string;
      next_match_id: number | null;
    }>(
      'SELECT id, slug, winner_id, next_match_id FROM matches WHERE status = ? AND winner_id IS NOT NULL',
      ['completed']
    );

    for (const walkover of walkoverMatches) {
      if (walkover.next_match_id && walkover.winner_id) {
        const nextMatch = db.queryOne<{
          id: number;
          team1_id: string | null;
          team2_id: string | null;
        }>('SELECT id, team1_id, team2_id FROM matches WHERE id = ?', [walkover.next_match_id]);

        if (nextMatch) {
          // Advance winner to next match
          if (!nextMatch.team1_id) {
            db.update('matches', { team1_id: walkover.winner_id }, 'id = ?', [nextMatch.id]);
            log.debug(
              `Walkover: Advanced ${walkover.winner_id} from ${walkover.slug} to next match as team1`
            );
          } else if (!nextMatch.team2_id) {
            db.update('matches', { team2_id: walkover.winner_id }, 'id = ?', [nextMatch.id]);
            log.debug(
              `Walkover: Advanced ${walkover.winner_id} from ${walkover.slug} to next match as team2`
            );
          }
        }
      }
    }

    // Check if any Round 2+ matches now have both teams and mark them ready
    const readyMatches = db.query<{ id: number; team1_id: string; team2_id: string; slug: string }>(
      'SELECT id, team1_id, team2_id, slug FROM matches WHERE status = ? AND team1_id IS NOT NULL AND team2_id IS NOT NULL',
      ['pending']
    );

    for (const match of readyMatches) {
      db.update('matches', { status: 'ready' }, 'id = ?', [match.id]);
      log.debug(`Match ${match.slug} is now ready (both teams assigned)`);
    }

    log.success(`✅ Double elimination bracket generated: ${teamCount} teams`);
    log.debug(`Winners bracket: ${Object.keys(winnersBracket).length} matches`);
    log.debug(`Losers bracket: ${Object.keys(losersBracket).length} matches`);

    return this.getMatches();
  }

  /**
   * Generate round robin bracket using proper rotation algorithm (now handled by brackets-manager)
   * @deprecated Use brackets-manager instead
   */

  private _unused_generateRoundRobin(tournament: TournamentResponse): BracketMatch[] {
    let teamIds = [...tournament.teamIds];
    const originalTeamCount = teamIds.length;

    if (tournament.settings.seedingMethod === 'random') {
      this.shuffleArray(teamIds);
    }

    // If odd number of teams, add a "BYE" placeholder
    const hasOddTeams = teamIds.length % 2 === 1;
    if (hasOddTeams) {
      teamIds.push('BYE'); // Placeholder for bye
    }

    const teamCount = teamIds.length;
    const numberOfRounds = teamCount - 1;
    const matchesPerRound = teamCount / 2;

    let globalMatchNumber = 1;

    // Use circle rotation algorithm
    // Team at index 0 stays fixed, others rotate clockwise
    for (let round = 1; round <= numberOfRounds; round++) {
      let matchNumber = 1;

      // Generate matches for this round
      for (let i = 0; i < matchesPerRound; i++) {
        const team1Index = i;
        const team2Index = teamCount - 1 - i;

        const team1Id = teamIds[team1Index];
        const team2Id = teamIds[team2Index];

        // Skip matches with BYE
        if (team1Id === 'BYE' || team2Id === 'BYE') {
          continue;
        }

        const slug = `rr-r${round}m${matchNumber}`;
        const config = this.generateMatchConfig(tournament, team1Id, team2Id, slug);

        db.insert('matches', {
          slug,
          tournament_id: tournament.id,
          round,
          match_number: matchNumber,
          team1_id: team1Id,
          team2_id: team2Id,
          winner_id: null,
          server_id: null,
          config: JSON.stringify(config),
          status: round === 1 ? 'ready' : 'pending', // Only Round 1 is ready initially
          next_match_id: null,
          created_at: Math.floor(Date.now() / 1000),
        });

        matchNumber++;
        globalMatchNumber++;
      }

      // Rotate teams (keep index 0 fixed, rotate others)
      if (round < numberOfRounds) {
        const fixed = teamIds[0];
        const rotated = teamIds.slice(1);
        // Move last element to the beginning of rotated array
        rotated.unshift(rotated.pop()!);
        teamIds = [fixed, ...rotated];
      }
    }

    log.success(
      `Generated round robin bracket: ${originalTeamCount} teams, ${numberOfRounds} rounds, ${
        globalMatchNumber - 1
      } total matches`
    );

    return this.getMatches();
  }

  /**
   * Generate Swiss system bracket
   */
  private generateSwiss(tournament: TournamentResponse): BracketMatch[] {
    const teamIds = [...tournament.teamIds];
    const teamCount = teamIds.length;

    if (tournament.settings.seedingMethod === 'random') {
      this.shuffleArray(teamIds);
    }

    // Swiss system typically has log2(teamCount) rounds
    const totalRounds = Math.ceil(Math.log2(teamCount));

    // Generate first round pairings
    for (let round = 1; round <= totalRounds; round++) {
      const pairsPerRound = Math.floor(teamCount / 2);

      for (let matchNum = 1; matchNum <= pairsPerRound; matchNum++) {
        const slug = `swiss-r${round}m${matchNum}`;

        // First round: pair teams sequentially
        let team1Id: string | undefined;
        let team2Id: string | undefined;

        if (round === 1) {
          const team1Index = (matchNum - 1) * 2;
          const team2Index = team1Index + 1;
          team1Id = teamIds[team1Index] || undefined;
          team2Id = teamIds[team2Index] || undefined;
        }

        const config = this.generateMatchConfig(tournament, team1Id, team2Id, slug);

        db.insert('matches', {
          slug,
          tournament_id: tournament.id,
          round,
          match_number: matchNum,
          team1_id: team1Id || null,
          team2_id: team2Id || null,
          winner_id: null,
          server_id: null,
          config: JSON.stringify(config),
          status: round === 1 && team1Id && team2Id ? 'ready' : 'pending',
          next_match_id: null,
          created_at: Math.floor(Date.now() / 1000),
        });
      }
    }

    return this.getMatches();
  }

  /**
   * Link matches by setting next_match_id for progression
   */
  private linkMatches(
    matches: BracketMatch[],
    slugToDbId: Map<string, number>,
    tournamentType: string
  ): void {
    for (const match of matches) {
      let nextMatchSlug: string | null = null;

      if (tournamentType === 'single_elimination') {
        // In single elimination, winners advance to the next round
        // Match N in round R advances to match ceil(N/2) in round R+1
        if (match.round < Math.max(...matches.map((m) => m.round))) {
          const nextMatchNum = Math.ceil(match.matchNumber / 2);
          nextMatchSlug = `r${match.round + 1}m${nextMatchNum}`;
        }
      } else if (tournamentType === 'double_elimination') {
        // Double elimination has complex linking (handled by brackets-manager)
        // For now, we'll let the match progression logic handle it
        // We can enhance this later if needed
        continue;
      } else if (tournamentType === 'round_robin') {
        // Round robin doesn't have progression (all matches are independent)
        continue;
      }

      if (nextMatchSlug) {
        const nextMatchId = slugToDbId.get(nextMatchSlug);
        if (nextMatchId) {
          // Update the database
          db.update('matches', { next_match_id: nextMatchId }, 'id = ?', [match.id]);
          // Update the in-memory object
          match.nextMatchId = nextMatchId;
        }
      }
    }
  }

  /**
   * Calculate total rounds needed
   */
  private calculateTotalRounds(teamCount: number, type: string): number {
    switch (type) {
      case 'single_elimination':
        return Math.ceil(Math.log2(teamCount));
      case 'double_elimination': {
        const upperRounds = Math.ceil(Math.log2(teamCount));
        const lowerRounds = (upperRounds - 1) * 2;
        return upperRounds + lowerRounds + 1; // +1 for grand finals
      }
      case 'round_robin':
        // Number of rounds = number of matches / matches per round
        return Math.ceil((teamCount * (teamCount - 1)) / 2 / Math.ceil(teamCount / 2));
      case 'swiss':
        return Math.ceil(Math.log2(teamCount));
      default:
        return 0;
    }
  }

  /**
   * Validate team count for tournament type
   */
  private validateTeamCount(type: string, count: number): void {
    if (count < 2) {
      throw new Error('Tournament requires at least 2 teams');
    }

    switch (type) {
      case 'single_elimination':
      case 'double_elimination':
        // Must be power of 2 for clean brackets (can be relaxed with byes)
        if (count > 32) {
          throw new Error('Maximum 32 teams for elimination tournaments');
        }
        break;
    }
  }

  /**
   * Shuffle array in place (Fisher-Yates)
   */
  private shuffleArray<T>(array: T[]): void {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }

  /**
   * Get teams for tournament
   */
  private getTeamsForTournament(
    teamIds: string[]
  ): Array<{ id: string; name: string; tag?: string }> {
    if (teamIds.length === 0) return [];

    const placeholders = teamIds.map(() => '?').join(',');
    const teams = db.query<DbTeamRow>(
      `SELECT id, name, tag FROM teams WHERE id IN (${placeholders})`,
      teamIds
    );

    return teams as Array<{ id: string; name: string; tag?: string }>;
  }

  /**
   * Convert database row to Tournament object
   */
  private rowToTournament(row: TournamentRow): Tournament {
    return {
      ...row,
      maps: JSON.parse(row.maps),
      team_ids: JSON.parse(row.team_ids),
      settings: JSON.parse(row.settings),
    };
  }
}

export const tournamentService = new TournamentService();
