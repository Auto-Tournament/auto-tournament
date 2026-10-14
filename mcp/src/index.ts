#!/usr/bin/env node
/**
 * Auto Tournament MCP server: tournaments, matches, teams and servers through
 * the platform's API, for Claude (or any MCP client).
 *
 * It signs in with an API token made in Settings -> API tokens (AT_TOKEN) on
 * the platform at AT_URL. A read-only token gets the read tools to work and
 * the write tools refused by the platform; an admin token can do what an admin
 * can. Every write is its own tool, so a client's permission rules can allow
 * them one by one.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ApiClient } from './api.js';

const url = process.env.AT_URL?.trim();
const token = process.env.AT_TOKEN?.trim();
if (!url || !token) {
  process.stderr.write(
    'auto-tournament-mcp: set AT_URL (the platform, e.g. https://tournament.example.com) and AT_TOKEN (Settings -> API tokens).\n'
  );
  process.exit(1);
}

const api = new ApiClient(url, token);
const server = new McpServer({ name: 'auto-tournament', version: '0.1.0' });

const read = { readOnlyHint: true, openWorldHint: false } as const;
const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
const destructive = { readOnlyHint: false, destructiveHint: true, openWorldHint: false } as const;

type Json = unknown;
const text = (value: Json) => ({
  content: [{ type: 'text' as const, text: ApiClient.show(value) }],
});
const call = async (fn: () => Promise<Json>) => {
  try {
    return text(await fn());
  } catch (error) {
    return { ...text({ error: (error as Error).message }), isError: true };
  }
};
const enc = encodeURIComponent;

// --- Read --------------------------------------------------------------------

server.registerTool(
  'health',
  {
    title: 'Platform health',
    description:
      'Version, installed modules, the CS2 fleet summary and what needs an admin (the admin notices bell).',
    inputSchema: {},
    annotations: read,
  },
  async () =>
    call(async () => {
      const [version, catalog, fleet, notices] = await Promise.all([
        api.get('/api/settings/version').catch((e) => ({ error: String(e) })),
        api.get('/api/catalog').catch((e) => ({ error: String(e) })),
        api.get('/api/health/fleet').catch((e) => ({ error: String(e) })),
        api.get('/api/admin-notices').catch((e) => ({ error: String(e) })),
      ]);
      return { version, modules: ApiClient.modules(catalog), fleet, needsYou: notices };
    })
);

server.registerTool(
  'tournament_current',
  {
    title: 'Current tournament',
    description:
      'The tournament the site is running: settings, status and teams. With bracket: true, its bracket too.',
    inputSchema: { bracket: z.boolean().optional() },
    annotations: read,
  },
  async ({ bracket }) =>
    call(async () => {
      const tournament = await api.get('/api/tournament');
      return bracket
        ? { tournament, bracket: await api.get('/api/tournament/bracket') }
        : tournament;
    })
);

server.registerTool(
  'tournaments_list',
  {
    title: 'Tournaments',
    description: 'Every tournament on the site, with status.',
    inputSchema: {},
    annotations: read,
  },
  async () => call(() => api.get('/api/tournaments'))
);

server.registerTool(
  'matches_list',
  {
    title: 'Matches',
    description:
      'Matches with status, teams, scores and server. Filter by status (pending, ready, loaded, live, completed, cancelled).',
    inputSchema: {
      status: z.string().optional(),
      limit: z.number().int().min(1).max(500).optional(),
    },
    annotations: read,
  },
  async ({ status, limit }) =>
    call(async () => {
      const body = (await api.get('/api/matches')) as { matches?: Array<Record<string, unknown>> };
      let matches = body.matches ?? [];
      if (status) matches = matches.filter((m) => m.status === status);
      return matches.slice(0, limit ?? 100).map(ApiClient.matchLine);
    })
);

server.registerTool(
  'match',
  {
    title: 'One match',
    description:
      'A match in full: teams, rosters, maps, scores, server, and its live Ready Up state (phase, round, players) when it runs on a fleet server.',
    inputSchema: { slug: z.string().describe('The match id, e.g. r1m1') },
    annotations: read,
  },
  async ({ slug }) =>
    call(async () => {
      const [match, live] = await Promise.all([
        api.get(`/api/matches/${enc(slug)}`),
        api.get(`/api/fleet/matches/${enc(slug)}`).catch(() => null),
      ]);
      return { match, live };
    })
);

server.registerTool(
  'match_log',
  {
    title: 'Match log',
    description:
      "A match's event log: what the server reported (Ready Up events and console lines) and what admins did, newest last.",
    inputSchema: { slug: z.string(), last: z.number().int().min(1).max(500).optional() },
    annotations: read,
  },
  async ({ slug, last }) =>
    call(async () => {
      const body = (await api.get(`/api/events/${enc(slug)}`)) as
        { events?: unknown[] } | unknown[];
      const events = Array.isArray(body) ? body : (body.events ?? []);
      return events.slice(-(last ?? 100));
    })
);

server.registerTool(
  'teams_list',
  {
    title: 'Teams',
    description: 'Every team, with its players.',
    inputSchema: { search: z.string().optional() },
    annotations: read,
  },
  async ({ search }) =>
    call(async () => {
      const body = (await api.get('/api/teams')) as { teams?: Array<Record<string, unknown>> };
      const teams = body.teams ?? [];
      const q = search?.toLowerCase();
      return q
        ? teams.filter((t) => `${t.id} ${t.name} ${t.tag}`.toLowerCase().includes(q))
        : teams;
    })
);

server.registerTool(
  'team',
  {
    title: 'One team',
    description: 'A team with its roster.',
    inputSchema: { id: z.string() },
    annotations: read,
  },
  async ({ id }) => call(() => api.get(`/api/teams/${enc(id)}`))
);

server.registerTool(
  'players_find',
  {
    title: 'Find players',
    description: 'Find players by name or Steam ID.',
    inputSchema: { query: z.string().min(1) },
    annotations: read,
  },
  async ({ query }) => call(() => api.get(`/api/players/find?query=${enc(query)}`))
);

server.registerTool(
  'servers',
  {
    title: 'Servers and machines',
    description:
      'The csm machines (hosts) with their servers, and every Ready Up fleet server: online, availability, version, the match it holds.',
    inputSchema: {},
    annotations: read,
  },
  async () =>
    call(async () => {
      const [hosts, fleet] = await Promise.all([
        api.get('/api/fleet/hosts'),
        api.get('/api/fleet/servers'),
      ]);
      return { hosts: ApiClient.hosts(hosts), servers: ApiClient.fleetServers(fleet) };
    })
);

server.registerTool(
  'api_get',
  {
    title: 'GET any API path',
    description:
      "Read anything the tools above do not cover: GET an /api/... path (see the platform's /api-docs). Read only.",
    inputSchema: { path: z.string().regex(/^\/api\//, 'starts with /api/') },
    annotations: read,
  },
  async ({ path }) => call(() => api.get(path))
);

// --- Tournament ----------------------------------------------------------------

server.registerTool(
  'templates_list',
  {
    title: 'Tournament templates',
    description: 'Saved tournament templates: type, format, maps, teams and settings.',
    inputSchema: {},
    annotations: read,
  },
  async () => call(() => api.get('/api/templates'))
);

server.registerTool(
  'tournament_create',
  {
    title: 'Create a tournament',
    description:
      'Create the tournament, from a saved template (templateId) or from scratch. A template gives type, format, maps, teams and settings; anything given here wins. type: single_elimination, double_elimination, round_robin, swiss, shuffle. format: bo1, bo3, bo5. fillBots: CS2 bots take empty roster slots.',
    inputSchema: {
      name: z.string().min(1).max(100),
      templateId: z.number().int().optional(),
      type: z.string().optional(),
      format: z.string().optional(),
      maps: z.array(z.string()).optional(),
      teamIds: z.array(z.string()).optional(),
      fillBots: z.boolean().optional(),
      settings: z.record(z.unknown()).optional().describe('Merged over the template settings'),
    },
    annotations: write,
  },
  async ({ name, templateId, type, format, maps, teamIds, fillBots, settings }) =>
    call(async () => {
      let base: Record<string, unknown> = {};
      if (templateId !== undefined) {
        const r = (await api.get(`/api/templates/${templateId}`)) as {
          template?: Record<string, unknown>;
        };
        if (!r.template) throw new Error(`template ${templateId} not found`);
        base = r.template;
      }
      const merged = {
        ...((base.settings as Record<string, unknown>) ?? {}),
        ...(settings ?? {}),
      };
      if (fillBots !== undefined) {
        merged.cs2 = {
          ...((merged.cs2 as Record<string, unknown>) ?? {}),
          fillTeamsWithBots: fillBots,
        };
      }
      const body = {
        name,
        game: base.game,
        type: type ?? base.type,
        format: format ?? base.format,
        maps: maps ?? base.maps ?? [],
        teamIds: teamIds ?? base.teamIds ?? [],
        settings: merged,
        ...(fillBots !== undefined ? { fillTeamsWithBots: fillBots } : {}),
      };
      return api.send('POST', '/api/tournament', body);
    })
);

server.registerTool(
  'tournament_update',
  {
    title: 'Change the tournament',
    description:
      'Change the tournament before it starts: name, maps, teams, settings (PUT /api/tournament). fillBots: CS2 bots take empty roster slots.',
    inputSchema: {
      name: z.string().min(1).max(100).optional(),
      maps: z.array(z.string()).optional(),
      teamIds: z.array(z.string()).optional(),
      fillBots: z.boolean().optional(),
      settings: z.record(z.unknown()).optional(),
    },
    annotations: write,
  },
  async ({ fillBots, ...rest }) =>
    call(() =>
      api.send('PUT', '/api/tournament', {
        ...rest,
        ...(fillBots !== undefined ? { fillTeamsWithBots: fillBots } : {}),
      })
    )
);

for (const [name, path, title, description] of [
  [
    'tournament_start',
    '/api/tournament/start',
    'Start the tournament',
    'Start the tournament: matches go to servers as they are ready.',
  ],
  [
    'tournament_pause',
    '/api/tournament/pause',
    'Hold the bracket',
    'Hold the bracket: no new match starts until it is resumed. Matches already running go on.',
  ],
  ['tournament_resume', '/api/tournament/resume', 'Resume the bracket', 'Resume a held bracket.'],
] as const) {
  server.registerTool(name, { title, description, inputSchema: {}, annotations: write }, async () =>
    call(() => api.send('POST', path, {}))
  );
}

server.registerTool(
  'tournament_end',
  {
    title: 'End (cancel) the tournament',
    description:
      "Cancel the running tournament: every open match is ended. Not undoable. confirmName is the tournament's name, as in the app.",
    inputSchema: { confirmName: z.string().min(1) },
    annotations: destructive,
  },
  async ({ confirmName }) =>
    call(() => api.send('POST', '/api/tournament/cancel', { confirm: confirmName }))
);

server.registerTool(
  'tournament_archive',
  {
    title: 'Archive the tournament',
    description: 'Archive the finished tournament so a new one can be made; its results stay.',
    inputSchema: { confirm: z.literal(true) },
    annotations: destructive,
  },
  async () => call(() => api.send('POST', '/api/tournament/archive', {}))
);

// --- Matches -------------------------------------------------------------------

server.registerTool(
  'match_set_winner',
  {
    title: 'Set a match winner',
    description: 'Decide a series by hand (a forfeit, a dispute): the bracket moves on.',
    inputSchema: { slug: z.string(), winner: z.enum(['team1', 'team2']) },
    annotations: destructive,
  },
  async ({ slug, winner }) =>
    call(() => api.send('POST', `/api/matches/${enc(slug)}/winner`, { winner }))
);

server.registerTool(
  'match_restart',
  {
    title: 'Restart a match',
    description: 'Load the match again from the start on its server.',
    inputSchema: { slug: z.string() },
    annotations: destructive,
  },
  async ({ slug }) => call(() => api.send('POST', `/api/matches/${enc(slug)}/restart`, {}))
);

server.registerTool(
  'match_move_server',
  {
    title: 'Move a match to another server',
    description:
      'Give a match that is not live yet another server (e.g. its server is out of date or down).',
    inputSchema: { slug: z.string() },
    annotations: write,
  },
  async ({ slug }) => call(() => api.send('POST', `/api/matches/${enc(slug)}/reallocate`, {}))
);

server.registerTool(
  'match_cancel',
  {
    title: 'Cancel a match',
    description:
      'Force-cancel a match: the server is told to stop and the match is marked cancelled.',
    inputSchema: { slug: z.string(), confirm: z.literal(true) },
    annotations: destructive,
  },
  async ({ slug }) => call(() => api.send('POST', `/api/matches/${enc(slug)}/force-cancel`, {}))
);

server.registerTool(
  'match_hold',
  {
    title: 'Hold or release a match',
    description:
      'Hold a match back from starting for some minutes (with a reason), or release it (hold: false).',
    inputSchema: {
      slug: z.string(),
      hold: z.boolean(),
      minutes: z.number().int().min(1).max(240).optional(),
      reason: z.string().max(200).optional(),
    },
    annotations: write,
  },
  async ({ slug, hold, minutes, reason }) =>
    call(() =>
      hold
        ? api.send('POST', `/api/matches/${enc(slug)}/hold`, { minutes: minutes ?? 15, reason })
        : api.send('DELETE', `/api/matches/${enc(slug)}/hold`)
    )
);

server.registerTool(
  'match_restore_round',
  {
    title: 'Restore a round',
    description:
      "Restore the match on its server to the start of a round (Ready Up's round backup).",
    inputSchema: {
      serverId: z.string().describe("The match's server id"),
      round: z.number().int().min(1),
    },
    annotations: destructive,
  },
  async ({ serverId, round }) =>
    call(() => api.send('POST', '/api/rcon/restore-backup', { serverId, round }))
);

// --- Servers -------------------------------------------------------------------

server.registerTool(
  'server_command',
  {
    title: 'Start, stop or restart a server',
    description:
      'Send a csm machine a command for one of its servers: server.start, server.stop or server.restart. Refused for a server with a live match unless force is given with a reason.',
    inputSchema: {
      hostId: z.string(),
      type: z.enum(['server.start', 'server.stop', 'server.restart']),
      server: z.string().describe("The server's name on the machine, e.g. server-2 or instance-3"),
      forceReason: z.string().max(500).optional(),
    },
    annotations: destructive,
  },
  async ({ hostId, type, server: name, forceReason }) =>
    call(() =>
      api.send('POST', `/api/fleet/hosts/${enc(hostId)}/commands`, {
        type,
        payload: { server: name },
        ...(forceReason ? { force: { reason: forceReason } } : {}),
      })
    )
);

server.registerTool(
  'server_console',
  {
    title: 'Run a console command',
    description:
      "Run one console line on Ready Up servers (audited; needs a root admin's token). Use it for status checks like `status` or `ru status`; the answer comes back when the server sends one.",
    inputSchema: {
      serverIds: z.array(z.string()).min(1).max(20),
      command: z.string().min(1).max(512),
    },
    annotations: destructive,
  },
  async ({ serverIds, command }) =>
    call(() =>
      api.send('POST', '/api/rcon/command', { serverIds, command: 'custom', value: command })
    )
);

server.registerTool(
  'say',
  {
    title: 'Announce in game',
    description: 'Say a message in chat on every server, or on the ones listed, as the admins.',
    inputSchema: { message: z.string().min(1).max(190), serverIds: z.array(z.string()).optional() },
    annotations: write,
  },
  async ({ message, serverIds }) =>
    call(() => api.send('POST', '/api/rcon/broadcast', { message, serverIds }))
);

// --- Teams ---------------------------------------------------------------------

server.registerTool(
  'team_create',
  {
    title: 'Create a team',
    description: 'Create a team. players: [{ steamId, name }].',
    inputSchema: {
      id: z.string().regex(/^[a-z0-9-]{1,64}$/),
      name: z.string().min(1).max(64),
      tag: z.string().max(8).optional(),
      players: z.array(z.object({ steamId: z.string(), name: z.string() })).default([]),
    },
    annotations: write,
  },
  async (body) => call(() => api.send('POST', '/api/teams', body))
);

server.registerTool(
  'team_update',
  {
    title: 'Edit a team',
    description: 'Change a team: name, tag or the whole roster (players: [{ steamId, name }]).',
    inputSchema: {
      id: z.string(),
      name: z.string().min(1).max(64).optional(),
      tag: z.string().max(8).optional(),
      players: z.array(z.object({ steamId: z.string(), name: z.string() })).optional(),
    },
    annotations: write,
  },
  async ({ id, ...body }) => call(() => api.send('PUT', `/api/teams/${enc(id)}`, body))
);

// --- Anything else -------------------------------------------------------------

server.registerTool(
  'api_write',
  {
    title: 'POST, PUT, PATCH or DELETE any API path',
    description:
      "Change something the tools above do not cover (see the platform's /api-docs). Prefer a named tool when there is one.",
    inputSchema: {
      method: z.enum(['POST', 'PUT', 'PATCH', 'DELETE']),
      path: z.string().regex(/^\/api\//, 'starts with /api/'),
      body: z.record(z.unknown()).optional(),
    },
    annotations: destructive,
  },
  async ({ method, path, body }) => call(() => api.send(method, path, body))
);

await server.connect(new StdioServerTransport());
