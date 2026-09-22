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
  tournamentLeaderboard: '/tournament/:id/leaderboard',
  findPlayer: '/player',
  playerProfile: '/player/:steamId',
  browse: '/browse',
  me: '/me',
  meConnections: '/me/connections',
  welcomeGames: '/welcome/games',

  // Admin shell
  manage: '/manage',
  teams: '/teams',
  players: '/players',
  servers: '/servers',
  tournament: '/tournament',
  bracket: '/bracket',
  matches: '/matches',
  admin: '/admin',
  settings: '/settings',
  maps: '/maps',
  templates: '/templates',
  eloTemplates: '/elo-templates',
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
