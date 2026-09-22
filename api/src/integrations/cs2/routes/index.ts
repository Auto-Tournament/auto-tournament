/**
 * The CS2 routers and the URLs they keep.
 *
 * These are the built-in endpoints that lived in `routes/` before the module
 * split. MatchZy servers, the client and existing API users are configured
 * with these exact paths, so they are mounted at their old prefixes (through
 * `GameIntegration.legacyRoutes`) rather than under `/api/game/cs2`.
 *
 * Order is significant: `/api/servers` has three routers and Express matches
 * in registration order.
 */

import type { LegacyRouteMount } from '../../types';
import serverBootstrapRoutes from './serverBootstrap';
import serverRoutes from './servers';
import serverStatusRoutes from './serverStatus';
import rconRoutes from './rcon';
import demoRoutes from './demos';
import matchzyRoutes from './matchzy';
import eventRoutes from '../events/routes';
import vetoRoutes from '../veto/routes';
import mapRoutes from '../maps/routes';
import mapPoolRoutes from '../maps/poolRoutes';
import testHelperRoutes from './testHelpers';

export const cs2LegacyRoutes: LegacyRouteMount[] = [
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
    prefix: '/api/rcon',
    router: rconRoutes,
    title: 'RCON',
    description: 'Direct server control — pause, say, end match, raw commands.',
  },
  {
    prefix: '/api/demos',
    router: demoRoutes,
    title: 'Demos',
    description: 'Demo upload from the game server, and download.',
  },
  {
    prefix: '/api/matchzy',
    router: matchzyRoutes,
    title: 'MatchZy',
    description: 'Auto Tournament CS2 plugin (formerly MatchZy Enhanced) version information.',
  },
  {
    prefix: '/api/events',
    router: eventRoutes,
    title: 'Events',
    description: 'MatchZy webhooks in, and the recorded event log out.',
  },
  {
    prefix: '/api/veto',
    router: vetoRoutes,
    title: 'Veto',
    description: 'Map veto state and actions.',
  },
  {
    prefix: '/api/maps',
    router: mapRoutes,
    title: 'Maps',
    description: 'The map catalogue.',
  },
  {
    prefix: '/api/map-pools',
    router: mapPoolRoutes,
    title: 'Map pools',
    description: 'Named sets of maps for veto and match config.',
  },
  {
    prefix: '/api/test',
    router: testHelperRoutes,
    title: 'Test helpers (CS2)',
    description:
      'E2E helpers that stand in for a CS2 server. Disabled in production unless ENABLE_TEST_ENDPOINTS is set.',
  },
];
