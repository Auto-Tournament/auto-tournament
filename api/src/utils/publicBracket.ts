import type { BracketMatch, BracketResponse } from '../types/tournament.types';

/**
 * One bracket match as anyone may see it: who plays whom, where it stands and
 * the score. Built from an allow-list, so a field added to `BracketMatch`
 * later stays admin-only until someone decides otherwise here.
 *
 * Left out on purpose:
 * - `serverId`: which game server a match runs on is the organizer's.
 * - `config`: the game module's match config holds every player's Steam ID,
 *   the in-game admins and the server cvars.
 * - `team1Players` / `team2Players`: per-player stats with Steam IDs; the
 *   player and team pages already show those where they belong.
 */
export type PublicBracketMatch = Pick<
  BracketMatch,
  | 'id'
  | 'slug'
  | 'round'
  | 'matchNumber'
  | 'status'
  | 'nextMatchId'
  | 'createdAt'
  | 'loadedAt'
  | 'completedAt'
  | 'team1Score'
  | 'team2Score'
  | 'team1SeriesScore'
  | 'team2SeriesScore'
  | 'team1MapScore'
  | 'team2MapScore'
  | 'mapResults'
> & {
  team1?: { id: string; name: string; tag?: string } | null;
  team2?: { id: string; name: string; tag?: string } | null;
  winner?: { id: string; name: string; tag?: string } | null;
};

function publicTeam(
  team: BracketMatch['team1']
): { id: string; name: string; tag?: string } | null | undefined {
  if (!team) return team;
  return { id: team.id, name: team.name, ...(team.tag ? { tag: team.tag } : {}) };
}

export function toPublicBracketMatch(match: BracketMatch): PublicBracketMatch {
  return {
    id: match.id,
    slug: match.slug,
    round: match.round,
    matchNumber: match.matchNumber,
    status: match.status,
    nextMatchId: match.nextMatchId ?? null,
    createdAt: match.createdAt,
    loadedAt: match.loadedAt,
    completedAt: match.completedAt,
    team1: publicTeam(match.team1),
    team2: publicTeam(match.team2),
    winner: publicTeam(match.winner),
    team1Score: match.team1Score,
    team2Score: match.team2Score,
    team1SeriesScore: match.team1SeriesScore,
    team2SeriesScore: match.team2SeriesScore,
    team1MapScore: match.team1MapScore,
    team2MapScore: match.team2MapScore,
    ...(match.mapResults
      ? {
          mapResults: match.mapResults.map((result) => ({
            mapNumber: result.mapNumber,
            mapName: result.mapName ?? null,
            team1Score: result.team1Score,
            team2Score: result.team2Score,
            winnerTeam: result.winnerTeam,
            completedAt: result.completedAt,
          })),
        }
      : {}),
  };
}

/** The whole bracket, for the public Bracket and Matches tabs. */
export function toPublicBracket(bracket: BracketResponse): {
  tournament: BracketResponse['tournament'];
  matches: PublicBracketMatch[];
  totalRounds: number;
  swissStandings?: BracketResponse['swissStandings'];
  roundRobinStandings?: BracketResponse['roundRobinStandings'];
} {
  return {
    tournament: bracket.tournament,
    matches: bracket.matches.map(toPublicBracketMatch),
    totalRounds: bracket.totalRounds,
    ...(bracket.swissStandings ? { swissStandings: bracket.swissStandings } : {}),
    ...(bracket.roundRobinStandings ? { roundRobinStandings: bracket.roundRobinStandings } : {}),
  };
}
