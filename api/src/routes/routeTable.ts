/**
 * Where every router is mounted.
 *
 * This used to be a run of `app.use(...)` calls in `index.ts`. It is a list
 * now so that something other than the running server can read it — namely
 * `scripts/generate-api-reference.ts`, which walks these routers to produce
 * the complete endpoint reference in `docs/API-REFERENCE.md`.
 *
 * That matters because the alternative is documenting 180-odd endpoints by
 * hand, which is how both of the previous attempts drifted: `docs/API.md`
 * describes the endpoints a bot would want and no more, and the OpenAPI
 * annotations cover about a third of the surface, with `rcon`, `players`,
 * `servers`, `matches`, `teams` and `veto` carrying none at all.
 *
 * **Order is significant.** Express matches in registration order, and several
 * prefixes are shared by more than one router — `/api/servers` has three and
 * `/api/team` has two. Keep the entries in the order they should be matched.
 */

import type { Router } from 'express';

import { listIntegrations } from '../integrations/registry';

import teamRoutes from './teams';
import matchRoutes from './matches';
import steamRoutes from './steam';
import tournamentRoutes from './tournament';
import tournamentsRoutes from './tournaments';
import chatRoutes from './chat';
import tournamentSignupRoutes from './tournamentSignup';
import logsRoutes from './logs';
import teamMatchRoutes from './teamMatch';
import teamStatsRoutes from './teamStats';
import teamDirectoryRoutes from './teamDirectory';
import settingsRoutes from './settings';
import signInProvidersRoutes from './signInProviders';
import templatesRoutes from './templates';
import manualMatchTemplatesRoutes from './manualMatchTemplates';
import recoveryRoutes from './recovery';
import playersRoutes from './players';
import eloTemplatesRoutes from './eloTemplates';
import generationRoutes from './generation';
import testRoutes from './test';
import authRoutes from './auth';
import { setupRouter, localAuthRouter, localAccountsRouter } from './localAdmin';
import gamesRoutes from './games';
import gamePackRoutes from './gamePacks';
import moduleRoutes from './modules';
import catalogRoutes from './catalog';
import systemRoutes from './system';
import meRoutes from './me';
import compatRoutes from './compat';
import adminCallRoutes from './adminCalls';
import licenseRoutes from './license';
import webhookRoutes from './webhooks';
import integrationTeamRoutes from './integrationTeams';
import experimentalRoutes from './experimental';
import matchmakingRoutes from './matchmaking';
import leaderboardRoutes from './leaderboard';
import socialRoutes from './social';

export interface MountedRouter {
  /** Path prefix the router is mounted under. */
  prefix: string;
  router: Router;
  /** Group heading in the generated reference. */
  title: string;
  /** One line on what this group is for. */
  description: string;
  /** Mounted, but left out of the API reference (see LegacyRouteMount.testOnly). */
  testOnly?: boolean;
}

const coreRoutes: MountedRouter[] = [
  {
    prefix: '/api/teams',
    router: teamRoutes,
    title: 'Teams',
    description: 'Team roster CRUD, including batch create and delete.',
  },
  {
    prefix: '/api/matches',
    router: matchRoutes,
    title: 'Matches',
    description: 'Create, load, restart and cancel matches; read match state.',
  },
  {
    prefix: '/api/steam',
    router: steamRoutes,
    title: 'Steam',
    description: 'Steam Web API lookups (profiles, avatars, key health).',
  },
  {
    prefix: '/api/tournament',
    router: tournamentRoutes,
    title: 'Tournament',
    description: 'The tournament itself — setup, bracket, rounds, standings.',
  },
  {
    prefix: '/api/tournaments',
    router: tournamentsRoutes,
    title: 'Tournaments',
    description: 'Every tournament: the list, creating another one, which is featured, archiving.',
  },
  {
    prefix: '/api/chat',
    router: chatRoutes,
    title: 'Chat',
    description: 'Your match (both teams and the admins), your team and your party.',
  },
  {
    prefix: '/api/tournament-signup',
    router: tournamentSignupRoutes,
    title: 'Tournament sign-up',
    description: 'Teams signing themselves up with a lineup, and check-in on the day.',
  },
  {
    prefix: '/api/logs',
    router: logsRoutes,
    title: 'Logs',
    description: 'Server-side event logs.',
  },
  {
    prefix: '/api/team',
    router: teamMatchRoutes,
    title: 'Team match view',
    description: "A team's current match, oriented to that team. Public.",
  },
  {
    prefix: '/api/team',
    router: teamStatsRoutes,
    title: 'Team stats',
    description: 'Past results and aggregates for a team. Public.',
  },
  {
    prefix: '/api/social',
    router: socialRoutes,
    title: 'Social',
    description: "Friends, friend requests, finding players, and the signed-in player's notifications (the bell).",
  },
  {
    prefix: '/api/leaderboard',
    router: leaderboardRoutes,
    title: 'Leaderboard',
    description: "Players ranked by their rating in one game. Public.",
  },
  {
    prefix: '/api/team-directory',
    router: teamDirectoryRoutes,
    title: 'Team directory',
    description: "Every team (public), and the signed-in player's own teams: list them, make one (one owned team per account).",
  },
  {
    prefix: '/api/settings',
    router: settingsRoutes,
    title: 'Settings',
    description: 'Instance-wide settings.',
  },
  {
    prefix: '/api/sign-in-providers',
    router: signInProvidersRoutes,
    title: 'Sign-in providers',
    description: 'Steam, Discord, Google, GitHub and Twitch sign-in, set up from Settings -> Sign-in. Admin only; secrets are write-only.',
  },
  {
    prefix: '/api/templates',
    router: templatesRoutes,
    title: 'Tournament templates',
    description: 'Saved tournament configurations.',
  },
  {
    prefix: '/api/manual-match-templates',
    router: manualMatchTemplatesRoutes,
    title: 'Manual match templates',
    description: 'Saved configurations for one-off matches.',
  },
  {
    prefix: '/api/recovery',
    router: recoveryRoutes,
    title: 'Recovery',
    description: 'Reconcile matches after an API restart or a server going away.',
  },
  {
    prefix: '/api/players',
    router: playersRoutes,
    title: 'Players',
    description: 'Player records, ratings, match history and profiles.',
  },
  {
    prefix: '/api/elo-templates',
    router: eloTemplatesRoutes,
    title: 'ELO templates',
    description: 'Rating calculation presets.',
  },
  {
    prefix: '/api/generation',
    router: generationRoutes,
    title: 'Generation',
    description: 'Shared generators, e.g. random team names.',
  },
  {
    prefix: '/api/games',
    router: gamesRoutes,
    title: 'Games',
    description:
      'The game catalogue players pick from (Wikidata-backed search, the built-in games). Public.',
  },
  {
    prefix: '/api/packs',
    router: gamePackRoutes,
    title: 'Game packs',
    description:
      'Games an admin imported as a pack file: list, import, remove, and the pack tile. Admin only, except the tile.',
  },
  {
    prefix: '/api/modules',
    router: moduleRoutes,
    title: 'Modules',
    description:
      'Code modules: list built-in and on-disk modules, enable or disable one from the next restart, and serve its client files. Admin only, except the client files and the public manifest of modules to load. Modules are installed from the signed catalog (/api/catalog) or on disk, never uploaded.',
  },
  {
    prefix: '/api/catalog',
    router: catalogRoutes,
    title: 'Catalog',
    description:
      'The game catalog: every pack and code module this instance has or can install, from the feed, its cache and the offline snapshot, with install, update, enable, disable, uninstall and purge. Code modules install only from signed releases. Admin only; writes must be same-site JSON.',
  },
  {
    prefix: '/api/system',
    router: systemRoutes,
    title: 'System',
    description:
      'The platform process: whether it can restart itself, and a restart (so a module update that waits for one can finish). Admin only; writes must be same-site JSON.',
  },
  {
    prefix: '/api/me',
    router: meRoutes,
    title: 'Me',
    description: "The signed-in player's own data, e.g. the games they play.",
  },
  {
    prefix: '/api/compat',
    router: compatRoutes,
    title: 'Compatibility',
    description:
      'Ready Up compatibility with the latest CS2 build: the runs its CI reports (token-guarded push), and public reads for the /compatibility page and a shields.io badge. 404 unless COMPAT_INGEST_TOKEN or COMPAT_FEED_URL is set.',
  },
  {
    prefix: '/api/admin-calls',
    router: adminCallRoutes,
    title: 'Admin calls',
    description:
      'Players calling for an admin from a game server (CS2: `.admin [message]` in Ready Up, sent as the admin_called event): list open and recently resolved calls, resolve one or all. Admin only. Live updates go to signed-in admins as the Socket.IO events admin:call and admin:call:resolved.',
  },
  {
    prefix: '/api/license',
    router: licenseRoutes,
    title: 'License',
    description:
      'The Auto Tournament license key: save, remove and read its status, checked offline; and the one-time acceptance of the license terms (non-commercial or commercial use) that the admin UI waits for. Admin only, except the public badge. Nothing else is ever blocked: a missing or problematic key is a notice for admins.',
  },
  {
    prefix: '/api/webhooks',
    router: webhookRoutes,
    title: 'Webhooks',
    description:
      'Integrator webhooks: register endpoints for match events (ready to connect, live, map and score, finished, cancelled, reset), rotate the signing secret, send a test event, read the delivery log (connect details redacted) and resend. Admin only. See docs/WEBHOOKS.md.',
  },
  {
    prefix: '/api/integrations/teams',
    router: integrationTeamRoutes,
    title: 'Integrations: teams',
    description:
      "Teams API for integrators: idempotent upsert of teams by the integrator's own externalId (single and batch), and reads by externalId. Integrator token (API_TOKENS_INTEGRATOR), admin token or admin session. See docs/WEBHOOKS.md.",
  },
  {
    prefix: '/api/experimental',
    router: experimentalRoutes,
    title: 'Experimental features',
    description:
      'Work in progress that ships dark: list the experimental features and turn one on or off. Off by default; an environment variable overrides the admin toggle. Empty while no feature is experimental. Admin only; writes must be same-site JSON.',
  },
  {
    prefix: '/api/matchmaking',
    router: matchmakingRoutes,
    title: 'Matchmaking',
    description:
      'Parties, the queue, matches and the matchmaking leaderboard (docs/design/matchmaking.md). On by default for signed-in players; an admin can limit it to admins.',
  },
  {
    prefix: '/api/test',
    router: testRoutes,
    title: 'Test helpers',
    description:
      'E2E helpers. Disabled in production unless ENABLE_TEST_ENDPOINTS is set.',
  },
  {
    prefix: '/api/setup',
    router: setupRouter,
    title: 'Setup',
    description: 'First-admin setup and reset-admin recovery with a one-time code. 404 once an admin exists.',
  },
  {
    prefix: '/api/local-accounts',
    router: localAccountsRouter,
    title: 'Local accounts',
    description: 'Username + password accounts an admin creates, makes admin or not, gives a new password, or removes. Admin only.',
  },
  {
    prefix: '/api/auth/local',
    router: localAuthRouter,
    title: 'Local admin login',
    description: 'Username + password (+ TOTP) sign-in for local admin accounts, and TOTP enrolment.',
  },
  {
    prefix: '/api/auth',
    router: authRoutes,
    title: 'Auth',
    description: 'Sign-in flows, admin identity, impersonation.',
  },
];

/**
 * Routes owned by game integrations that keep their pre-module URLs
 * (CS2: /api/servers ×3, /api/rcon, /api/demos, /api/cs2-plugin, /api/events, /api/veto,
 * /api/maps, /api/map-pools). They come first:
 * no core prefix overlaps them, and each integration returns its own routers
 * in match order.
 */
const integrationRoutes: MountedRouter[] = listIntegrations().flatMap(
  (integration) => integration.legacyRoutes?.() ?? []
);

export const routeTable: MountedRouter[] = [...integrationRoutes, ...coreRoutes];
