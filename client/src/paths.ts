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
  /** First sign-in of an account an admin made: own password, email, two-step. */
  firstSignIn: '/login/welcome',
  /** Ask for a password reset link by email. */
  forgotPassword: '/login/forgot',
  /** Choose a new password from a reset email's link (?token=). */
  resetPassword: '/login/reset',
  /** A confirmation email's link (?token=). */
  emailVerify: '/me/email/verify',
  /** A tournament email's unsubscribe link (?token=). */
  emailUnsubscribe: '/email/unsubscribe',
  /** First-admin setup and reset-admin recovery. */
  setup: '/setup',
  connectSteam: '/connect-steam',

  // Viewer and player-facing pages
  /**
   * The match room: the result, its maps and what the game recorded, and for
   * a player in it, the veto, the server and the live score. The only place a
   * match is played from.
   */
  match: '/match/:slug',
  /** A team's page: roster, record, matches, and its next match (a link to the room). */
  teamProfile: '/team/:teamId',
  /** Running the team: roster, invites, captains. */
  teamManage: '/team/:teamId/manage',
  teamJoin: '/join/team/:code',
  tournamentOverview: '/tournament/:id',
  // The tournament page's other tabs, nested under `tournamentOverview`.
  tournamentBracket: '/tournament/:id/bracket',
  tournamentMatches: '/tournament/:id/matches',
  tournamentTeams: '/tournament/:id/teams',
  tournamentStandings: '/tournament/:id/standings',
  tournamentRules: '/tournament/:id/rules',
  /** The old "Your match" tab: sends a player to their match room. */
  tournamentYourMatch: '/tournament/:id/match',
  tournamentSignup: '/tournament/:id/signup',
  /** The old address of Standings; redirects there. */
  tournamentLeaderboard: '/tournament/:id/leaderboard',
  findPlayer: '/player',
  playerProfile: '/player/:steamId',
  /** Every tournament on the site: open sign-ups, live, finished. Was `/browse`. */
  tournamentList: '/tournaments',
  /** Every player: search, sort by rating / matches / name (public, signed in). */
  communityPlayers: '/community/players',
  /** Every team, and the teams looking for players. */
  communityTeams: '/community/teams',
  /** Ratings per game; `?mode=matchmaking` for the matchmaking ladder. */
  leaderboards: '/leaderboards',
  /** Matchmaking: find a match, party, the match room. */
  play: '/play',
  /** Sends the signed-in player to where their match lives (veto, server, score, what is next). */
  matchNow: '/match/now',
  playLobby: '/play/:lobbyId',
  /** Your friends, friend requests, and adding friends. */
  friends: '/friends',
  /** Every notice the bell showed, with filters. */
  notifications: '/notifications',
  me: '/me',
  meConnections: '/me/connections',
  welcomeGames: '/welcome/games',
  /** Accept the license terms: admin only, required once before the admin UI. */
  licenseConsent: '/welcome/license',
  /** Ready Up compatibility with the latest CS2 build. Public, no sign-in. */
  compatibility: '/compatibility',

  // Admin shell: every admin page under /manage (the site root is the public
  // site's). The pages' old root addresses redirect (LEGACY_ADMIN_PATHS).
  manage: '/manage',
  /** Admin: every match on a server now, one row each (the live overview). */
  liveMatches: '/manage/live',
  teams: '/manage/teams',
  players: '/manage/players',
  /** Admin: player reports. */
  reports: '/manage/reports',
  servers: '/manage/servers',
  tournament: '/manage/tournament',
  /** Admin: every tournament, and creating another. */
  tournaments: '/manage/tournaments',
  /**
   * One tournament in Manage (2026-10): its id in the address, its pages as
   * tabs below it (matches, bracket, disputes, setup). `new` is the one being
   * created.
   */
  manageTournament: '/manage/tournaments/:id',
  bracket: '/manage/bracket',
  matches: '/manage/matches',
  /** Results nobody agrees on (3.0 phase D, PR D8). */
  disputes: '/manage/disputes',
  /** Every played match, any tournament (deleted ones too), with demos. */
  playedMatches: '/manage/played',
  /** Admin: highlights (settings, music, each game's recorders). */
  highlights: '/manage/highlights',
  /** Admin: import a match played elsewhere from its demos. */
  importMatch: '/manage/played/import',
  /** System: match recovery and the app log (was Admin tools at /admin). */
  admin: '/manage/system',
  settings: '/manage/settings',
  /** The license key, its standing and the public "Licensed" line. */
  license: '/manage/license',
  maps: '/manage/maps',
  /** What this instance can run, and the packs an admin imported. */
  modules: '/manage/modules',
  templates: '/manage/templates',
  /** Rating templates (how ratings are calculated). Was `/elo-templates`. */
  eloTemplates: '/manage/ratings',
  /** The old address of the Ratings page; redirects to `eloTemplates`. */
  eloTemplatesLegacy: '/elo-templates',
  dev: '/manage/dev',
} as const;

/**
 * Public addresses that moved (2026-10, one home per page): each redirects to
 * its new place with the query, so shared links and bookmarks keep working.
 */
export const MOVED_PUBLIC_PATHS: ReadonlyArray<{ from: string; to: string }> = [
  { from: '/t/team/:teamId', to: '/team/:teamId' },
  { from: '/t/team/:teamId/manage', to: '/team/:teamId/manage' },
  { from: '/browse', to: paths.tournamentList },
  { from: '/browse/teams', to: paths.communityTeams },
  { from: '/browse/players', to: paths.communityPlayers },
  { from: '/play/leaderboard', to: `${paths.leaderboards}?mode=matchmaking` },
];

/** `/leaderboards`, on the matchmaking ladder when asked. */
export function leaderboardsPath(mode?: 'tournament' | 'matchmaking'): string {
  return mode === 'matchmaking' ? `${paths.leaderboards}?mode=matchmaking` : paths.leaderboards;
}

export type AppPath = (typeof paths)[keyof typeof paths];

/**
 * The admin pages' addresses before they moved under /manage (2026-10): each
 * redirects to `/manage<old>`, with the rest of the path and the query, so
 * bookmarks and old links keep working. Modules' admin pages moved too
 * (CS2: servers, maps, skins, match rules). `/highlights` is the public
 * highlights library now (CS2's site route), not the admin page.
 */
export const LEGACY_ADMIN_PATHS = [
  '/teams',
  '/players',
  '/reports',
  '/servers',
  '/tournament',
  '/tournaments',
  '/bracket',
  '/matches',
  '/disputes',
  '/played',
  '/settings',
  '/maps',
  '/modules',
  '/templates',
  '/ratings',
  '/dev',
  '/skins',
  '/match-rules',
] as const;

/** Nested route form of an admin shell path: '/manage/servers' → 'manage/servers'. */
export function adminRoute(path: string): string {
  return path.replace(/^\//, '');
}

/** `/match/:slug`: a match's own page, the one link to a match everywhere. */
export function matchPagePath(slug: string): string {
  return `/match/${encodeURIComponent(slug)}`;
}

/** A tournament's tabs in Manage. */
export type ManageTournamentTab =
  'matches' | 'bracket' | 'disputes' | 'setup' | 'prizes' | 'schedule';

/** `/manage/tournaments/:id/<tab>`: one tournament in Manage (`new` while it is created). */
export function manageTournamentPath(
  id: number | 'new',
  tab: ManageTournamentTab = 'matches'
): string {
  return `${paths.tournaments}/${id}/${tab}`;
}

/**
 * The admin match page: in its tournament's Manage, or on its own for a
 * standalone match.
 */
export function manageMatchPath(slug: string, tournamentId?: number | null): string {
  const s = encodeURIComponent(slug);
  return tournamentId
    ? `${manageTournamentPath(tournamentId, 'matches')}/${s}`
    : `/manage/match/${s}`;
}

/** A match's room, where players and admins run it (the old admin dialog is gone). */
export function matchDetailsPath(slug: string, _tournamentId?: number | null): string {
  return `/match/${encodeURIComponent(slug)}`;
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
  'bracket',
  'matches',
  'teams',
  'standings',
  'rules',
  // Not a tab you click: the sign-up form, reached from the Overview's button.
  'signup',
] as const;
export type TournamentTab = (typeof TOURNAMENT_TABS)[number];

/**
 * The tabs one tournament shows, in the drafts' fixed order: Overview, then
 * Bracket (elimination) or Standings (round robin, Swiss, shuffle), Matches,
 * Teams, the modules' tabs (CS2: Highlights), and Rules, which every
 * tournament has (how a match is played comes from its settings). Before it
 * starts: Overview, Teams and Rules.
 */
export function visibleTournamentTabs(tournament: {
  status?: string;
  type?: string;
  /** Archived: a finished tournament a new one replaced. Only its results tabs are its own. */
  archived_at?: number | null;
  settings?: { rules?: string[]; rulebookUrl?: string; description?: string } | null;
}): TournamentTab[] {
  const elim = tournament.type === 'single_elimination' || tournament.type === 'double_elimination';
  // An archived tournament's matches and teams tabs would read the current
  // tournament's, so it shows its results only.
  if (tournament.archived_at) {
    return elim ? ['overview', 'bracket', 'rules'] : ['overview', 'standings', 'rules'];
  }
  if (tournament.status === 'setup' || tournament.status === 'ready') {
    return ['overview', 'teams', 'rules'];
  }
  if (tournament.type === 'shuffle') return ['overview', 'standings', 'matches', 'rules'];
  return elim
    ? ['overview', 'bracket', 'matches', 'teams', 'rules']
    : ['overview', 'standings', 'matches', 'teams', 'rules'];
}

/** `/tournament/:id` for Overview, `/tournament/:id/<tab>` for the other tabs. */
export function tournamentTabPath(
  tournamentId: number | string,
  tab: TournamentTab = 'overview'
): string {
  const base = `/tournament/${tournamentId}`;
  return tab === 'overview' ? base : `${base}/${tab}`;
}

/** `/team/:teamId` for one team's page. */
export function teamProfilePath(teamId: string): string {
  return paths.teamProfile.replace(':teamId', teamId);
}

/** `/team/:teamId/manage`: the team's owner view. */
export function teamManagePath(teamId: string): string {
  return paths.teamManage.replace(':teamId', teamId);
}
