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
};
