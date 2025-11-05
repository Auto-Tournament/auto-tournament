import { db } from '../config/database';
import type { DbTeamRow } from '../types/database.types';
import type { TournamentResponse } from '../types/tournament.types';

export const generateMatchConfig = (
  tournament: TournamentResponse,
  team1Id?: string,
  team2Id?: string,
  slug?: string
): Record<string, unknown> => {
  const team1 = team1Id
    ? db.queryOne<DbTeamRow & { players: string }>('SELECT * FROM teams WHERE id = ?', [team1Id])
    : null;
  const team2 = team2Id
    ? db.queryOne<DbTeamRow & { players: string }>('SELECT * FROM teams WHERE id = ?', [team2Id])
    : null;

  const numMaps = tournament.format === 'bo1' ? 1 : tournament.format === 'bo3' ? 3 : 5;

  // Calculate players based on actual team sizes
  const team1PlayerObj = team1 ? JSON.parse(team1.players) : {};
  const team2PlayerObj = team2 ? JSON.parse(team2.players) : {};
  const team1PlayerCount = Object.keys(team1PlayerObj).length;
  const team2PlayerCount = Object.keys(team2PlayerObj).length;
  
  // MatchZy needs players_per_team to be the max of both teams
  const playersPerTeam = Math.max(team1PlayerCount, team2PlayerCount, 1);
  
  // Store actual player counts for frontend display
  const totalExpectedPlayers = team1PlayerCount + team2PlayerCount;

  const config: Record<string, unknown> = {
    matchid: slug || 'tbd',
    match_title: `Map 1 of ${numMaps}`,
    side_type: 'standard', // Can be: standard, always_knife, never_knife
    veto_first: 'team1', // team1 or team2
    skip_veto: false,
    min_players_to_ready: 1, // Allow match to start with at least 1 player (flexible for small matches)
    players_per_team: playersPerTeam,
    num_maps: numMaps,
    maplist: tournament.maps,
    min_spectators_to_ready: 0,
    wingman: false,
    clinch_series: true,
    spectators: {
      players: {},
    },
    // Custom fields for our frontend
    expected_players_total: totalExpectedPlayers,
    expected_players_team1: team1PlayerCount,
    expected_players_team2: team2PlayerCount,
    team1: team1
      ? {
          id: team1.id,
          name: team1.name,
          tag: team1.tag || team1.name.substring(0, 4).toUpperCase(),
          players: team1PlayerObj,
          series_score: 0,
        }
      : { name: 'TBD', tag: 'TBD', players: {}, series_score: 0 },
    team2: team2
      ? {
          id: team2.id,
          name: team2.name,
          tag: team2.tag || team2.name.substring(0, 4).toUpperCase(),
          players: team2PlayerObj,
          series_score: 0,
        }
      : { name: 'TBD', tag: 'TBD', players: {}, series_score: 0 },
  };

  return config;
};
