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

import serverBootstrapRoutes from './serverBootstrap';
import serverRoutes from './servers';
import serverStatusRoutes from './serverStatus';
import teamRoutes from './teams';
import rconRoutes from './rcon';
import matchRoutes from './matches';
import eventRoutes from './events';
import steamRoutes from './steam';
import tournamentRoutes from './tournament';
import demoRoutes from './demos';
import logsRoutes from './logs';
import teamMatchRoutes from './teamMatch';
import teamStatsRoutes from './teamStats';
import vetoRoutes from './veto';
import settingsRoutes from './settings';
import mapsRoutes from './maps';
import mapPoolsRoutes from './mapPools';
import templatesRoutes from './templates';
import manualMatchTemplatesRoutes from './manualMatchTemplates';
import recoveryRoutes from './recovery';
import playersRoutes from './players';
import eloTemplatesRoutes from './eloTemplates';
import generationRoutes from './generation';
import testRoutes from './test';
import authRoutes from './auth';
import matchzyRoutes from './matchzy';

export interface MountedRouter {
  /** Path prefix the router is mounted under. */
  prefix: string;
  router: Router;
  /** Group heading in the generated reference. */
  title: string;
  /** One line on what this group is for. */
  description: string;
}

export const routeTable: MountedRouter[] = [
  {
    prefix: '/api/servers',
    router: serverBootstrapRoutes,
    title: 'Server bootstrap',
    description: 'Self-registration for a CS2 server coming online.',
  },
  {
    prefix: '/api/servers',
    router: serverRoutes,
    title: 'Servers',
    description: 'The CS2 server fleet — add, edit, enable, remove.',
  },
  {
    prefix: '/api/servers',
    router: serverStatusRoutes,
    title: 'Server status',
    description: 'Liveness, connectivity and CS2 update state per server.',
  },
  {
    prefix: '/api/teams',
    router: teamRoutes,
    title: 'Teams',
    description: 'Team roster CRUD, including batch create and delete.',
  },
  {
    prefix: '/api/rcon',
    router: rconRoutes,
    title: 'RCON',
    description: 'Direct server control — pause, say, end match, raw commands.',
  },
  {
    prefix: '/api/matches',
    router: matchRoutes,
    title: 'Matches',
    description: 'Create, load, restart and cancel matches; read match state.',
  },
  {
    prefix: '/api/events',
    router: eventRoutes,
    title: 'Events',
    description: 'MatchZy webhooks in, and the recorded event log out.',
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
    prefix: '/api/demos',
    router: demoRoutes,
    title: 'Demos',
    description: 'Demo upload from the game server, and download.',
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
    prefix: '/api/veto',
    router: vetoRoutes,
    title: 'Veto',
    description: 'Map veto state and actions.',
  },
  {
    prefix: '/api/settings',
    router: settingsRoutes,
    title: 'Settings',
    description: 'Instance-wide settings.',
  },
  {
    prefix: '/api/maps',
    router: mapsRoutes,
    title: 'Maps',
    description: 'The map catalogue.',
  },
  {
    prefix: '/api/map-pools',
    router: mapPoolsRoutes,
    title: 'Map pools',
    description: 'Named sets of maps for veto and match config.',
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
  {
    prefix: '/api/matchzy',
    router: matchzyRoutes,
    title: 'MatchZy',
    description: 'MatchZy Enhanced version information.',
  },
];
