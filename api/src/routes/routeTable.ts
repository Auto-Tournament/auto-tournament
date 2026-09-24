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
import logsRoutes from './logs';
import teamMatchRoutes from './teamMatch';
import teamStatsRoutes from './teamStats';
import settingsRoutes from './settings';
import templatesRoutes from './templates';
import manualMatchTemplatesRoutes from './manualMatchTemplates';
import recoveryRoutes from './recovery';
import playersRoutes from './players';
import eloTemplatesRoutes from './eloTemplates';
import generationRoutes from './generation';
import testRoutes from './test';
import authRoutes from './auth';
import gamesRoutes from './games';
import gamePackRoutes from './gamePacks';
import moduleRoutes from './modules';
import catalogRoutes from './catalog';
import meRoutes from './me';

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
    prefix: '/api/settings',
    router: settingsRoutes,
    title: 'Settings',
    description: 'Instance-wide settings.',
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
      'The game catalogue players pick from (IGDB or Wikidata-backed search, suggestions). Public.',
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
    prefix: '/api/me',
    router: meRoutes,
    title: 'Me',
    description: "The signed-in player's own data, e.g. the games they play.",
  },
  {
    prefix: '/api/test',
    router: testRoutes,
    title: 'Test helpers',
    description:
      'E2E helpers. Disabled in production unless ENABLE_TEST_ENDPOINTS is set.',
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
