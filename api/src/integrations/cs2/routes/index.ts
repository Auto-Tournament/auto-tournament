/**
 * The CS2 routers and the URLs they keep.
 *
 * These are the built-in endpoints that lived in `routes/` before the module
 * split. Auto Tournament CS2 servers, the client and existing API users are configured
 * with these exact paths, so they are mounted at their old prefixes (through
 * `GameIntegration.legacyRoutes`) rather than under `/api/game/cs2`.
 *
 * Order is significant: `/api/servers` has four routers and Express matches
 * in registration order.
 */

import type { LegacyRouteMount } from '../../types';
import serverBootstrapRoutes from './serverBootstrap';
import serverUpdateHoldRoutes from './serverUpdateHold';
import serverRoutes from './servers';
import serverStatusRoutes from './serverStatus';
import rconRoutes from './rcon';
import demoRoutes from './demos';
import pluginVersionRoutes from './pluginVersion';
import eventRoutes from '../events/routes';
import vetoRoutes from '../veto/routes';
import mapRoutes from '../maps/routes';
import mapPoolRoutes from '../maps/poolRoutes';
import matchConnectRoutes from './matchConnect';
import testHelperRoutes from './testHelpers';
import { fleetAdminRouter, fleetEnrollRouter } from '../fleet/routes';

export const cs2LegacyRoutes: LegacyRouteMount[] = [
  {
    prefix: '/api/servers',
    router: serverBootstrapRoutes,
    title: 'Server bootstrap',
    description: 'Self-registration for a CS2 server coming online.',
  },
  {
    // Before `serverRoutes`, whose `/:id` would otherwise swallow
    // `/update-hold`, and which is admin-only.
    prefix: '/api/servers',
    router: serverUpdateHoldRoutes,
    title: 'Update hold',
    description: 'Whether a game host should pause automatic CS2 updates.',
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
    prefix: '/api/cs2-plugin',
    router: pluginVersionRoutes,
    title: 'Auto Tournament CS2',
    description: 'Auto Tournament CS2 plugin version information.',
  },
  {
    prefix: '/api/events',
    router: eventRoutes,
    title: 'Events',
    description: 'Auto Tournament CS2 webhooks in, and the recorded event log out.',
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
    // Not a legacy URL: new with the module client API 0.2.0, so under the
    // module's own prefix.
    prefix: '/api/game/cs2',
    router: matchConnectRoutes,
    title: 'Match connect',
    description: 'How a player joins a CS2 match: its server, status and current map.',
  },
  {
    // Ready Up fleet (FLEET.md). Enrollment is public (a code or fleet key is
    // the credential) and must come before the admin router's requireAuth.
    prefix: '/api/fleet',
    router: fleetEnrollRouter,
    title: 'Fleet enrollment',
    description: 'A Ready Up server trades a one-time code or fleet key for its server token.',
  },
  {
    prefix: '/api/fleet',
    router: fleetAdminRouter,
    title: 'Fleet',
    description:
      'Ready Up servers on the fleet link: registry, one-time codes, fleet keys, revoke and rotate. The server WebSocket is /api/fleet/ws.',
  },
  {
    prefix: '/api/test',
    router: testHelperRoutes,
    title: 'Test helpers (CS2)',
    description:
      'E2E helpers that stand in for a CS2 server. Disabled in production unless ENABLE_TEST_ENDPOINTS is set.',
  },
];
