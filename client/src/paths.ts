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
  /** Local admin sign-in (username + password). */
  adminLogin: '/login/admin',
  /** First-admin setup and reset-admin recovery. */
  setup: '/setup',
  connectSteam: '/connect-steam',

  // Viewer and player-facing pages
  teamMatch: '/team/:teamId',
  teamProfile: '/t/team/:teamId',
  teamManage: '/t/team/:teamId/manage',
  teamJoin: '/join/team/:code',
  tournamentOverview: '/tournament/:id',
  // The tournament page's other tabs, nested under `tournamentOverview`.
  tournamentBracket: '/tournament/:id/bracket',
  tournamentMatches: '/tournament/:id/matches',
  tournamentTeams: '/tournament/:id/teams',
  tournamentStandings: '/tournament/:id/standings',
  tournamentRules: '/tournament/:id/rules',
  tournamentYourMatch: '/tournament/:id/match',
  tournamentSignup: '/tournament/:id/signup',
  /** Your virtual skins; `/player/:steamId/inventory` for someone else's. */
  inventory: '/inventory',
  playerInventory: '/player/:steamId/inventory',
  /** The old address of Standings; redirects there. */
  tournamentLeaderboard: '/tournament/:id/leaderboard',
  findPlayer: '/player',
  playerProfile: '/player/:steamId',
  browse: '/browse',
  /** Every player: search, sort by rating / matches / name (public, signed in). */
  browsePlayers: '/browse/players',
  browseTeams: '/browse/teams',
  /** Matchmaking (experimental): find a match, party, the match room. */
  play: '/play',
  playLobby: '/play/:lobbyId',
  playLeaderboard: '/play/leaderboard',
  me: '/me',
  meConnections: '/me/connections',
  welcomeGames: '/welcome/games',
  /** Accept the license terms: admin only, required once before the admin UI. */
  licenseConsent: '/welcome/license',
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

/** The admin Matches page with one match open (a link an admin can share). */
export function matchDetailsPath(slug: string): string {
  return `${paths.matches}?match=${encodeURIComponent(slug)}`;
}

/** `/play/:lobbyId`: a matchmaking match room. */
export function playLobbyPath(lobbyId: string): string {
  return `/play/${lobbyId}`;
}

/** `/player/:steamId` for one player. */
export function playerProfilePath(steamId: string): string {
  return `/player/${steamId}`;
}

/** The public tournament page's tabs, in the order they are shown. */
export const TOURNAMENT_TABS = [
  'overview',
  'match',
  'bracket',
  'matches',
  'teams',
  'standings',
  'rules',
  // Not a tab you click: the sign-up form, reached from the Overview's button.
  'signup',
] as const;
export type TournamentTab = (typeof TOURNAMENT_TABS)[number];

/** While the tournament runs, a player in it lands on "Your match" instead of Overview. */
export function yourMatchFirst(status: string | undefined, hasTeam: boolean | undefined): boolean {
  return status === 'in_progress' && Boolean(hasTeam);
}

/**
 * The tabs one tournament shows: Rules only when the organizer wrote some, or
 * a description too long for the header to show in full. While it runs, a
 * player whose team is in it gets "Your match" in place of Overview: that is
 * what they came for.
 */
export function visibleTournamentTabs(
  tournament: {
    status?: string;
    settings?: { rules?: string[]; rulebookUrl?: string; description?: string } | null;
  },
  viewer: { hasTeam?: boolean } = {}
): TournamentTab[] {
  // The header shows three lines of the description; a longer one is read in full on Rules.
  const hasRules = Boolean(
    tournament.settings?.rules?.length ||
      tournament.settings?.rulebookUrl ||
      (tournament.settings?.description?.length ?? 0) > 240
  );
  const tabs: TournamentTab[] = [
    yourMatchFirst(tournament.status, viewer.hasTeam) ? 'match' : 'overview',
    'bracket',
    'matches',
    'teams',
    'standings',
  ];
  if (hasRules) tabs.push('rules');
  return tabs;
}

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

/** `/t/team/:teamId/manage`: the team's owner view. */
export function teamManagePath(teamId: string): string {
  return paths.teamManage.replace(':teamId', teamId);
}
