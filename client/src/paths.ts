/**
 * Client route paths, in one place.
 *
 * Core pages and game integrations both link to these, so a page that moves
 * behind an integration (Servers, Maps, Steam connect) keeps its URL and the
 * core can still link to it without importing the integration. `App.tsx`
 * mounts every route from here.
 *
 * Admin pages live inside the admin shell (`/` + `Layout`) and are mounted
 * as nested routes; `adminRoute()` gives the relative form for that.
 */

export const paths = {
  root: '/',
  login: '/login',
  connectSteam: '/connect-steam',

  // Viewer and player-facing pages
  teamMatch: '/team/:teamId',
  teamProfile: '/t/team/:teamId',
  tournamentOverview: '/tournament/:id',
  // The tournament page's other tabs, nested under `tournamentOverview`.
  tournamentBracket: '/tournament/:id/bracket',
  tournamentMatches: '/tournament/:id/matches',
  tournamentTeams: '/tournament/:id/teams',
  tournamentStandings: '/tournament/:id/standings',
  /** The old address of Standings; redirects there. */
  tournamentLeaderboard: '/tournament/:id/leaderboard',
  findPlayer: '/player',
  playerProfile: '/player/:steamId',
  browse: '/browse',
  me: '/me',
  meConnections: '/me/connections',
  welcomeGames: '/welcome/games',
  /** Ready Up compatibility with the latest CS2 build. Public, no sign-in. */
  compatibility: '/compatibility',

  // Admin shell
  manage: '/manage',
  teams: '/teams',
  players: '/players',
  servers: '/servers',
  tournament: '/tournament',
  bracket: '/bracket',
  matches: '/matches',
  /** Results nobody agrees on (3.0 phase D, PR D8). */
  disputes: '/disputes',
  admin: '/admin',
  settings: '/settings',
  maps: '/maps',
  /** What this instance can run, and the packs an admin imported. */
  modules: '/modules',
  templates: '/templates',
  /** Rating templates (how ratings are calculated). Was `/elo-templates`. */
  eloTemplates: '/ratings',
  /** The old address of the Ratings page; redirects to `eloTemplates`. */
  eloTemplatesLegacy: '/elo-templates',
  dev: '/dev',
} as const;

export type AppPath = (typeof paths)[keyof typeof paths];

/** Nested route form of an admin shell path: '/servers' → 'servers'. */
export function adminRoute(path: string): string {
  return path.replace(/^\//, '');
}

/** `/player/:steamId` for one player. */
export function playerProfilePath(steamId: string): string {
  return `/player/${steamId}`;
}

/** The public tournament page's tabs, in the order they are shown. */
export const TOURNAMENT_TABS = ['overview', 'bracket', 'matches', 'teams', 'standings'] as const;
export type TournamentTab = (typeof TOURNAMENT_TABS)[number];

/** `/tournament/:id` for Overview, `/tournament/:id/<tab>` for the other tabs. */
export function tournamentTabPath(
  tournamentId: number | string,
  tab: TournamentTab = 'overview'
): string {
  const base = `/tournament/${tournamentId}`;
  return tab === 'overview' ? base : `${base}/${tab}`;
}

/** `/t/team/:teamId` for one team's public profile page. */
export function teamProfilePath(teamId: string): string {
  return paths.teamProfile.replace(':teamId', teamId);
}
