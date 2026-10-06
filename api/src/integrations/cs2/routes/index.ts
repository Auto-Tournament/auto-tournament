/**
 * The CS2 routers and the URLs they keep.
 *
 * These are the built-in endpoints that lived in `routes/` before the module
 * split. MatchZy Enhanced servers, the client and existing API users are configured
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
import playerProfileRoutes from './playerProfile';
import demoAnalysisRoutes from './demoAnalysis';
import radarRoutes from './radars';
import highlightRoutes from './highlights';
import teamProfileRoutes from './teamProfile';
import roundBackupRoutes from './roundBackups';
import { failoverMatchRouter, failoverSettingsRouter } from './failover';
import testHelperRoutes from './testHelpers';
import { fleetAdminRouter, fleetEnrollRouter } from '../fleet/routes';
import { fleetHostAdminRouter } from '../fleet/hosts/routes';
import { fleetPushRouter } from '../fleet/push/routes';
import { fleetAutoscaleRouter } from '../fleet/autoscale/routes';
import skinsRoutes from '../skins/routes';

export const cs2LegacyRoutes: LegacyRouteMount[] = [
  {
    prefix: '/api/skins',
    router: skinsRoutes,
    title: 'Skins',
    description: 'Virtual CS2 skins: inventories, loadouts, showcases and the admin inventory manager (platform only).',
  },
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
    title: 'MatchZy Enhanced',
    description: 'MatchZy Enhanced version information.',
  },
  {
    prefix: '/api/events',
    router: eventRoutes,
    title: 'Events',
    description: 'MatchZy Enhanced webhooks in, and the recorded event log out.',
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
    // Public, like the match connect route above.
    prefix: '/api/game/cs2',
    router: playerProfileRoutes,
    title: 'Player profile',
    description: "A player's CS2 totals, everyone's totals to compare with, and their results per map.",
  },
  {
    // The worker's routes take an API token (requireAuth on each); a map's
    // analysis and replay are public, like its demo.
    prefix: '/api/game/cs2',
    router: demoAnalysisRoutes,
    title: 'Demo analysis',
    description:
      'The worker container reads stored demos after the match: its job queue, and each map\'s rounds, kills and 2D replay.',
  },
  {
    // A player's clips are public; the recorder's routes take an API token.
    prefix: '/api/game/cs2',
    router: highlightRoutes,
    title: 'Highlights',
    description: "Each player's best moments, picked from the demo analysis, and the clips the recorder makes of them.",
  },
  {
    // Reading is public (the 2D replay); the worker's upload takes an API token.
    prefix: '/api/game/cs2',
    router: radarRoutes,
    title: 'Map radars',
    description: "Map radar images and coordinates for the 2D replay, read from a CS2 install's own files by the worker.",
  },
  {
    // Public, like the player profile route above.
    prefix: '/api/game/cs2',
    router: teamProfileRoutes,
    title: 'Team profile',
    description: "A team's CS2 results per map, and the maps it bans and picks most in the veto.",
  },
  {
    // Admin only, per route (requireAuth on each): the router shares its
    // prefix with the public match connect route above.
    prefix: '/api/game/cs2',
    router: roundBackupRoutes,
    title: 'Round backups',
    description:
      "A CS2 match's round backups (Ready Up servers send them inline) and \"restore to round N\" over the fleet link or RCON, audited.",
  },
  {
    // Admin only, per route, like the round backups above.
    prefix: '/api/game/cs2',
    router: failoverMatchRouter,
    title: 'Fleet failover',
    description:
      'A Ready Up server that died or hung mid-match: the failover proposal (spare server, round backup to resume from), "move match" and dismiss (FLEET.md §11).',
  },
  {
    // Ready Up fleet (FLEET.md). Enrollment is public (a code or fleet key is
    // the credential) and must come before the admin router's requireAuth.
    prefix: '/api/fleet',
    router: fleetEnrollRouter,
    title: 'Fleet enrollment',
    description:
      'A Ready Up server trades a one-time code or fleet key for its server token; csm (kind "host") gets its host token the same way.',
  },
  {
    prefix: '/api/fleet',
    router: fleetAdminRouter,
    title: 'Fleet',
    description:
      'Ready Up servers on the fleet link: registry, one-time codes, fleet keys, revoke and rotate. The server WebSocket is /api/fleet/ws.',
  },
  {
    prefix: '/api/fleet',
    router: fleetHostAdminRouter,
    title: 'Fleet machines',
    description:
      'Machines running csm as host agent: add (one-time code), inventory, health, create/start/stop/restart servers, update CS2 and Ready Up, revoke and rotate. The host WebSocket is /api/fleet/host.',
  },
  {
    prefix: '/api/fleet',
    router: fleetPushRouter,
    title: 'Fleet pushes',
    description:
      'What the platform pushes to Ready Up servers: the admin list (admins.set), server settings (server.config, settings.set), whitelist / practice / plugins, and roster edits of a running match (match.update).',
  },
  {
    prefix: '/api/fleet',
    router: failoverSettingsRouter,
    title: 'Fleet failover settings',
    description: 'Auto-failover (off by default): move a match off a dead Ready Up server without waiting for an admin.',
  },
  {
    prefix: '/api/fleet',
    router: fleetAutoscaleRouter,
    title: 'Fleet autoscaling',
    description:
      'Automatic server scaling on csm machines: start stopped Ready Up servers ahead of the bracket, stop idle ones after a cool-down, create one when the pool is short. Settings, what the scaler sees, its activity, and a pass on request.',
  },
  {
    prefix: '/api/test',
    router: testHelperRoutes,
    title: 'Test helpers (CS2)',
    description:
      'E2E helpers that stand in for a CS2 server. Disabled in production unless ENABLE_TEST_ENDPOINTS is set.',
  },
];
