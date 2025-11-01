import { db } from '../config/database';
import { log } from '../utils/logger';
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
  createTournament(input: CreateTournamentInput): TournamentResponse {
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
      this.generateBracket();
      log.success('Bracket automatically generated');
    } catch (err) {
      log.warn('Failed to auto-generate bracket', { error: err });
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

    // Only auto-regenerate bracket if tournament is in setup mode
    if (!isLive) {
      try {
        this.generateBracket();
        log.success('Bracket automatically regenerated');
      } catch (err) {
        log.warn('Failed to auto-regenerate bracket', { error: err });
      }
    }

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
  generateBracket(): BracketResponse {
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

    switch (tournament.type) {
      case 'single_elimination':
        matches = this.generateSingleElimination(tournament);
        break;
      case 'double_elimination':
        matches = this.generateDoubleElimination(tournament);
        break;
      case 'round_robin':
        matches = this.generateRoundRobin(tournament);
        break;
      case 'swiss':
        matches = this.generateSwiss(tournament);
        break;
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
    const rows = db.query<any>(
      'SELECT * FROM matches WHERE tournament_id = 1 ORDER BY round, match_number'
    );

    return rows.map((row) => {
      const match: BracketMatch = {
        id: row.id,
        slug: row.slug,
        round: row.round,
        matchNumber: row.match_number,
        team1Id: row.team1_id,
        team2Id: row.team2_id,
        winnerId: row.winner_id,
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
        } catch (e) {
          // Ignore parse errors
        }
      }

      // Attach team info if available
      if (row.team1_id) {
        const team1 = db.queryOne<any>('SELECT id, name, tag FROM teams WHERE id = ?', [
          row.team1_id,
        ]);
        if (team1) match.team1 = team1;
      }
      if (row.team2_id) {
        const team2 = db.queryOne<any>('SELECT id, name, tag FROM teams WHERE id = ?', [
          row.team2_id,
        ]);
        if (team2) match.team2 = team2;
      }
      if (row.winner_id) {
        const winner = db.queryOne<any>('SELECT id, name, tag FROM teams WHERE id = ?', [
          row.winner_id,
        ]);
        if (winner) match.winner = winner;
      }

      // Get latest player stats from match events
      const playerStatsEvent = db.queryOne<any>(
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
        } catch (e) {
          // Ignore parse errors
        }
      }

      // Get latest scores from series_end or round_end events
      const scoreEvent = db.queryOne<any>(
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
        } catch (e) {
          // Ignore parse errors
        }
      }

      return match;
    });
  }

  /**
   * Generate single elimination bracket
   */
  private generateSingleElimination(tournament: TournamentResponse): BracketMatch[] {
    const teamIds = [...tournament.teamIds];
    const teamCount = teamIds.length;

    // Shuffle teams if random seeding
    if (tournament.settings.seedingMethod === 'random') {
      this.shuffleArray(teamIds);
    }

    // Calculate rounds needed for next power of 2
    const totalRounds = Math.ceil(Math.log2(teamCount));

    let matchIdCounter = 1;

    // First pass: Create all matches without next_match_id to avoid foreign key constraint issues
    const matchData: Array<{
      slug: string;
      round: number;
      matchNum: number;
      team1Id?: string;
      team2Id?: string;
      nextMatchId?: number;
      isWalkover?: boolean;
      winnerId?: string;
    }> = [];

    for (let round = 1; round <= totalRounds; round++) {
      const matchesInRound = Math.pow(2, totalRounds - round);

      for (let matchNum = 1; matchNum <= matchesInRound; matchNum++) {
        const slug = this.generateMatchSlug(round, matchNum);
        const nextMatchId =
          round < totalRounds
            ? this.calculateNextMatchId(matchIdCounter, matchesInRound)
            : undefined;

        // Assign teams for first round
        let team1Id: string | undefined;
        let team2Id: string | undefined;
        let isWalkover = false;
        let winnerId: string | undefined;

        if (round === 1) {
          const team1Index = (matchNum - 1) * 2;
          const team2Index = team1Index + 1;
          team1Id = teamIds[team1Index] || undefined;
          team2Id = teamIds[team2Index] || undefined;

          // Skip this match entirely if both teams are undefined (empty structural match)
          if (!team1Id && !team2Id) {
            matchIdCounter++;
            continue;
          }

          // Check if this is a walkover (bye) - only one team
          if (team1Id && !team2Id) {
            isWalkover = true;
            winnerId = team1Id;
          } else if (!team1Id && team2Id) {
            isWalkover = true;
            winnerId = team2Id;
          }
        }

        matchData.push({
          slug,
          round,
          matchNum,
          team1Id,
          team2Id,
          nextMatchId,
          isWalkover,
          winnerId,
        });

        matchIdCounter++;
      }
    }

    // Insert all matches without next_match_id first
    for (const data of matchData) {
      const config = this.generateMatchConfig(tournament, data.team1Id, data.team2Id, data.slug);

      // Determine status
      let status = 'pending';
      if (data.isWalkover) {
        status = 'completed'; // Walkovers are automatically completed
      } else if (data.team1Id && data.team2Id) {
        status = 'ready';
      }

      db.insert('matches', {
        slug: data.slug,
        tournament_id: 1,
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
    }

    // Second pass: Update matches with next_match_id now that all matches exist
    for (const data of matchData) {
      if (data.nextMatchId) {
        db.update('matches', { next_match_id: data.nextMatchId }, 'slug = ?', [data.slug]);
      }
    }

    // Third pass: Advance walkover winners to next round
    for (const data of matchData) {
      if (data.isWalkover && data.winnerId && data.nextMatchId) {
        const match = db.queryOne<any>('SELECT * FROM matches WHERE id = ?', [data.nextMatchId]);
        if (match) {
          // Determine if winner goes to team1 or team2 slot
          const positionInRound = data.matchNum - 1;
          const isEvenMatch = positionInRound % 2 === 0;

          if (isEvenMatch) {
            db.update('matches', { team1_id: data.winnerId }, 'id = ?', [data.nextMatchId]);
          } else {
            db.update('matches', { team2_id: data.winnerId }, 'id = ?', [data.nextMatchId]);
          }

          // Check if next match is now ready or also a walkover
          const nextMatch = db.queryOne<any>('SELECT * FROM matches WHERE id = ?', [
            data.nextMatchId,
          ]);
          if (nextMatch) {
            if (nextMatch.team1_id && nextMatch.team2_id) {
              db.update('matches', { status: 'ready' }, 'id = ?', [data.nextMatchId]);
            } else if (nextMatch.team1_id || nextMatch.team2_id) {
              // Still only one team, check if round 2 should also be walkover
              // We'll handle this in a fourth pass
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
      const matches = db.query<any>(
        'SELECT * FROM matches WHERE tournament_id = 1 AND status = "pending" AND (team1_id IS NOT NULL OR team2_id IS NOT NULL) ORDER BY round, match_number'
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
            const nextMatch = db.queryOne<any>('SELECT * FROM matches WHERE id = ?', [
              match.next_match_id,
            ]);
            if (nextMatch) {
              // Determine slot based on match number
              const positionInRound = match.match_number - 1;
              const isEvenMatch = positionInRound % 2 === 0;

              const updateField = isEvenMatch ? 'team1_id' : 'team2_id';
              db.update('matches', { [updateField]: winnerId }, 'id = ?', [match.next_match_id]);

              // Update next match status
              const updatedNextMatch = db.queryOne<any>('SELECT * FROM matches WHERE id = ?', [
                match.next_match_id,
              ]);
              if (updatedNextMatch && updatedNextMatch.team1_id && updatedNextMatch.team2_id) {
                db.update('matches', { status: 'ready' }, 'id = ?', [match.next_match_id]);
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
   */
  private calculateNextMatchId(currentMatchId: number, matchesInCurrentRound: number): number {
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
  ): any {
    const team1 = team1Id ? db.queryOne<any>('SELECT * FROM teams WHERE id = ?', [team1Id]) : null;
    const team2 = team2Id ? db.queryOne<any>('SELECT * FROM teams WHERE id = ?', [team2Id]) : null;

    const config: any = {
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
   * Generate double elimination bracket
   */
  private generateDoubleElimination(tournament: TournamentResponse): BracketMatch[] {
    const teamIds = [...tournament.teamIds];
    const teamCount = teamIds.length;

    if (tournament.settings.seedingMethod === 'random') {
      this.shuffleArray(teamIds);
    }

    const upperRounds = Math.ceil(Math.log2(teamCount));
    let matchIdCounter = 1;

    // Generate upper bracket (same as single elimination)
    for (let round = 1; round <= upperRounds; round++) {
      const matchesInRound = Math.pow(2, upperRounds - round);

      for (let matchNum = 1; matchNum <= matchesInRound; matchNum++) {
        const slug = `ub-r${round}m${matchNum}`; // ub = upper bracket

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
          tournament_id: 1,
          round,
          match_number: matchNum,
          team1_id: team1Id || null,
          team2_id: team2Id || null,
          winner_id: null,
          server_id: null,
          config: JSON.stringify(config),
          status: team1Id && team2Id ? 'ready' : 'pending',
          next_match_id: null, // Set later
          created_at: Math.floor(Date.now() / 1000),
        });

        matchIdCounter++;
      }
    }

    // Generate lower bracket (for losers)
    const lowerRounds = (upperRounds - 1) * 2;
    for (let round = 1; round <= lowerRounds; round++) {
      const matchesInRound = Math.pow(2, Math.floor((lowerRounds - round) / 2));

      for (let matchNum = 1; matchNum <= matchesInRound; matchNum++) {
        const slug = `lb-r${round}m${matchNum}`; // lb = lower bracket

        const config = this.generateMatchConfig(tournament, undefined, undefined, slug);

        db.insert('matches', {
          slug,
          tournament_id: 1,
          round: upperRounds + round,
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

        matchIdCounter++;
      }
    }

    // Grand finals
    db.insert('matches', {
      slug: 'grand-finals',
      tournament_id: 1,
      round: upperRounds + lowerRounds + 1,
      match_number: 1,
      team1_id: null,
      team2_id: null,
      winner_id: null,
      server_id: null,
      config: JSON.stringify(
        this.generateMatchConfig(tournament, undefined, undefined, 'grand-finals')
      ),
      status: 'pending',
      next_match_id: null,
      created_at: Math.floor(Date.now() / 1000),
    });

    return this.getMatches();
  }

  /**
   * Generate round robin bracket
   */
  private generateRoundRobin(tournament: TournamentResponse): BracketMatch[] {
    const teamIds = [...tournament.teamIds];
    const teamCount = teamIds.length;

    if (tournament.settings.seedingMethod === 'random') {
      this.shuffleArray(teamIds);
    }

    let matchIdCounter = 1;
    let round = 1;

    // Generate all possible matchups
    for (let i = 0; i < teamCount; i++) {
      for (let j = i + 1; j < teamCount; j++) {
        const slug = `rr-r${round}m${matchIdCounter}`;
        const config = this.generateMatchConfig(tournament, teamIds[i], teamIds[j], slug);

        db.insert('matches', {
          slug,
          tournament_id: 1,
          round,
          match_number: matchIdCounter,
          team1_id: teamIds[i],
          team2_id: teamIds[j],
          winner_id: null,
          server_id: null,
          config: JSON.stringify(config),
          status: 'ready',
          next_match_id: null,
          created_at: Math.floor(Date.now() / 1000),
        });

        matchIdCounter++;

        // Distribute matches across rounds
        if (matchIdCounter % Math.ceil(teamCount / 2) === 0) {
          round++;
        }
      }
    }

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
    let matchIdCounter = 1;
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
          tournament_id: 1,
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

        matchIdCounter++;
      }
    }

    return this.getMatches();
  }

  /**
   * Calculate total rounds needed
   */
  private calculateTotalRounds(teamCount: number, type: string): number {
    switch (type) {
      case 'single_elimination':
        return Math.ceil(Math.log2(teamCount));
      case 'double_elimination':
        const upperRounds = Math.ceil(Math.log2(teamCount));
        const lowerRounds = (upperRounds - 1) * 2;
        return upperRounds + lowerRounds + 1; // +1 for grand finals
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
    const teams = db.query<any>(
      `SELECT id, name, tag FROM teams WHERE id IN (${placeholders})`,
      teamIds
    );

    return teams;
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
