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
const server = new McpServer(
  { name: 'auto-tournament', version: '0.1.0' },
  {
    instructions: [
      "Never change the license: not the key, not free or paid, not the terms. It is the admin's own decision, and the platform refuses it from an API token anyway.",
      'When the license blocks something (no room for more servers, autoscale could not add one), that is the license working as sold, not a platform fault. Say so plainly: the license covers a number of game servers, and running more for a paid or commercial event means adding servers to the license (https://autotournament.gg/pricing). Never suggest switching to a free key to get around it: free is for non-commercial use only.',
    ].join(' '),
  }
);

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

server.registerTool(
  'platform_logs',
  {
    title: 'Platform logs',
    description:
      "The platform's own recent log lines (the last 1000 are kept): errors, warnings, what it did. level narrows to one level.",
    inputSchema: {
      limit: z.number().int().min(1).max(1000).default(200),
      level: z.enum(['error', 'warn', 'info', 'debug']).optional(),
    },
    annotations: read,
  },
  async ({ limit, level }) =>
    call(() => api.get(`/api/logs?limit=${limit}${level ? `&level=${level}` : ''}`))
);

server.registerTool(
  'settings',
  {
    title: 'Site settings',
    description:
      "Every site setting and its value (the core's and the modules', e.g. CS2's server defaults, break between matches, veto turn times). Change them with settings_update.",
    inputSchema: {},
    annotations: read,
  },
  async () => call(() => api.get('/api/settings'))
);

server.registerTool(
  'recorders',
  {
    title: 'Highlight recorders',
    description:
      "The CS2 highlight recorders (the machines that render clips and reels): online, version, what they are doing; with name, that recorder's recent runs.",
    inputSchema: { name: z.string().optional() },
    annotations: read,
  },
  async ({ name }) =>
    call(() =>
      api.get(name ? `/api/game/cs2/recorders/${enc(name)}/runs` : '/api/game/cs2/recorders')
    )
);

server.registerTool(
  'skins_settings',
  {
    title: 'Skins settings',
    description:
      'The CS2 skins settings: on or off, drop chances per mode, rarity weights, trade-ups, StatTrak chance and the tournament rewards for places 1 to 3. Change them with skins_settings_update.',
    inputSchema: {},
    annotations: read,
  },
  async () =>
    call(async () => {
      const [config, stats] = await Promise.all([
        api.get('/api/skins/admin/config'),
        api.get('/api/skins/admin/stats').catch((e) => ({ error: String(e) })),
      ]);
      return { config, stats };
    })
);

server.registerTool(
  'skins_catalog',
  {
    title: 'Search the skin catalogue',
    description:
      'Search CS2 skins by weapon or name (e.g. "karambit doppler", "ak redline"). Up to 50 rows with weapon, paintKit, rarity and image; knives and gloves carry priceUsd (Skinport market price, at most a day old) to suggest rewards by value. all=true lists every paint kit (each Doppler phase).',
    inputSchema: { query: z.string().default(''), all: z.boolean().default(false) },
    annotations: read,
  },
  async ({ query, all }) =>
    call(() => api.get(`/api/skins/admin/catalog?q=${enc(query)}${all ? '&all=1' : ''}`))
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
      'Create the tournament, from a saved template (templateId) or from scratch. A template gives type, format, maps, teams and settings; anything given here wins. type: single_elimination, double_elimination, round_robin, swiss, shuffle. format: bo1, bo3, bo5. teamSize: players per team (2 for wingman). fillBots: CS2 bots take empty roster slots.',
    inputSchema: {
      name: z.string().min(1).max(100),
      templateId: z.number().int().optional(),
      type: z.string().optional(),
      format: z.string().optional(),
      teamSize: z.number().int().min(1).max(10).optional(),
      maps: z.array(z.string()).optional(),
      teamIds: z.array(z.string()).optional(),
      fillBots: z.boolean().optional(),
      settings: z.record(z.unknown()).optional().describe('Merged over the template settings'),
    },
    annotations: write,
  },
  async ({ name, templateId, type, format, teamSize, maps, teamIds, fillBots, settings }) =>
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
        // Top level: the API reads the roster size from here, not from settings.
        ...((teamSize ?? base.teamSize) !== undefined
          ? { teamSize: teamSize ?? base.teamSize }
          : {}),
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
      'Change the tournament before it starts: name, maps, teams, team size, settings (PUT /api/tournament). fillBots: CS2 bots take empty roster slots.',
    inputSchema: {
      name: z.string().min(1).max(100).optional(),
      teamSize: z.number().int().min(1).max(10).optional(),
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

// --- Settings and skins -------------------------------------------------------

server.registerTool(
  'settings_update',
  {
    title: 'Change site settings',
    description:
      'Change site settings: only the keys given (as named by the settings tool); null clears one. A rejected key answers with why, and the keys before it stay saved.',
    inputSchema: { settings: z.record(z.unknown()) },
    annotations: write,
  },
  async ({ settings }) => call(() => api.send('PUT', '/api/settings', settings))
);

server.registerTool(
  'skins_settings_update',
  {
    title: 'Change the skins settings',
    description:
      'Change the skins settings: only the fields given (see skins_settings). rewards is the whole list for places 1 to 3: { place, mode: "random", rarity } or { place, mode: "skin", weapon, name, floatMin?, floatMax?, seeds? }.',
    inputSchema: { config: z.record(z.unknown()) },
    annotations: write,
  },
  async ({ config }) => call(() => api.send('PUT', '/api/skins/admin/config', config))
);

server.registerTool(
  'skin_give',
  {
    title: 'Give a player a skin',
    description:
      'Give one exact skin (weapon and paintKit from skins_catalog) to a player by Steam ID. Float and pattern are rolled when left out.',
    inputSchema: {
      steamId: z.string().regex(/^\d{17}$/),
      weapon: z.string(),
      paintKit: z.number().int(),
      float: z.number().min(0).max(1).optional(),
      pattern: z.number().int().min(0).max(1000).optional(),
    },
    annotations: write,
  },
  async ({ steamId, ...body }) =>
    call(() => api.send('POST', `/api/skins/admin/players/${enc(steamId)}/skins`, body))
);

server.registerTool(
  'skin_drop',
  {
    title: 'Give a drop (a choice of three)',
    description:
      'Give a drop, a choice of three skins, to a player (Steam ID), everyone online, a team (id), a match (slug) or a tournament (id). rarity makes all three options that rarity; without it, the drop odds. ancient is the rarest tier with real choice (covert guns and the priciest knives and gloves); immortal is a single skin (M4A4 | Howl), so it offers just that one. preview=true only names who would get one.',
    inputSchema: {
      kind: z.enum(['player', 'online', 'team', 'match', 'tournament']),
      id: z.string().optional(),
      label: z.string().max(60).optional(),
      rarity: z
        .enum(['common', 'uncommon', 'rare', 'mythical', 'legendary', 'ancient', 'immortal'])
        .optional(),
      preview: z.boolean().default(true),
    },
    annotations: write,
  },
  async ({ kind, id, label, rarity, preview }) =>
    call(() =>
      api.send('POST', '/api/skins/admin/drops', { target: { kind, id }, label, rarity, preview })
    )
);

// --- Anything else -------------------------------------------------------------

server.registerTool(
  'skins_inventory',
  {
    title: "A player's skins",
    description:
      "Every skin a player (Steam ID) owns, with each skin's id (for skin_equip and skin_remove) and what is equipped.",
    inputSchema: { steamId: z.string().regex(/^\d{17}$/) },
    annotations: read,
  },
  async ({ steamId }) => call(() => api.get(`/api/skins/admin/players/${enc(steamId)}/inventory`))
);

server.registerTool(
  'skin_equip',
  {
    title: "Equip a skin on a player's loadout",
    description:
      "Equip one of a player's skins (skinId from skins_inventory), as they would: team 0 both sides, 2 T, 3 CT (a knife or gloves can differ per side). Reaches their server at once when they are on one.",
    inputSchema: {
      steamId: z.string().regex(/^\d{17}$/),
      skinId: z.number().int(),
      team: z.union([z.literal(0), z.literal(2), z.literal(3)]).optional(),
    },
    annotations: write,
  },
  async ({ steamId, skinId, team }) =>
    call(() =>
      api.send('POST', `/api/skins/admin/players/${enc(steamId)}/equip`, {
        skinId,
        team: team ?? 0,
      })
    )
);

server.registerTool(
  'skin_unequip',
  {
    title: "Empty a slot of a player's loadout",
    description:
      'Empty a loadout slot (e.g. knife, gloves, weapon_ak47) of a player: one side (team 2 T, 3 CT) or every side.',
    inputSchema: {
      steamId: z.string().regex(/^\d{17}$/),
      slot: z.string(),
      team: z.union([z.literal(2), z.literal(3)]).optional(),
    },
    annotations: write,
  },
  async ({ steamId, slot, team }) =>
    call(() =>
      api.send(
        'DELETE',
        `/api/skins/admin/players/${enc(steamId)}/equip/${enc(slot)}${team ? `?team=${team}` : ''}`
      )
    )
);

server.registerTool(
  'skin_remove',
  {
    title: 'Take a skin away',
    description: "Delete one skin (id from skins_inventory) from a player's inventory.",
    inputSchema: { skinId: z.number().int() },
    annotations: destructive,
  },
  async ({ skinId }) => call(() => api.send('DELETE', `/api/skins/admin/skins/${skinId}`))
);

server.registerTool(
  'skins_clear',
  {
    title: "Empty a player's skins",
    description:
      "Remove every skin a player (Steam ID) has: the inventory, what is equipped, the showcase, open drops to pick from and the skin notices. Check skins_inventory first; this can't be undone.",
    inputSchema: { steamId: z.string().regex(/^\d{17}$/) },
    annotations: destructive,
  },
  async ({ steamId }) =>
    call(() => api.send('DELETE', `/api/skins/admin/players/${enc(steamId)}/inventory`))
);

server.registerTool(
  'player_update',
  {
    title: 'Change a player',
    description:
      'Change a player (Steam ID or player id): name, admin rights (isAdmin), avatar URL. Only the fields given change.',
    inputSchema: {
      id: z.string(),
      name: z.string().min(1).max(64).optional(),
      isAdmin: z.boolean().optional(),
      avatar: z.string().url().optional(),
    },
    annotations: write,
  },
  async ({ id, ...body }) => call(() => api.send('PUT', `/api/players/${enc(id)}`, body))
);

server.registerTool(
  'machines',
  {
    title: 'Machines (csm) and their servers',
    description:
      'Every linked machine with its inventory: CPU, memory, disk and each server-N (running, Ready Up version, the fleet server it is) and recent commands.',
    inputSchema: {},
    annotations: read,
  },
  async () => call(() => api.get('/api/fleet/hosts'))
);

server.registerTool(
  'machine_add',
  {
    title: 'Add a machine',
    description:
      'A pending machine and the one line to paste on it (installs csm when missing, links it, starts the agent). The code works once, for 15 minutes.',
    inputSchema: { name: z.string().max(100).optional() },
    annotations: write,
  },
  async ({ name }) => call(() => api.send('POST', '/api/fleet/hosts', name ? { name } : {}))
);

server.registerTool(
  'machine_command',
  {
    title: 'Run a csm command on a machine',
    description:
      'Send a machine (id from machines) one csm command: server.start / server.stop / server.restart {server: "server-2"}, server.create {count, enroll: true}, server.remove, host.update_game {servers?}, host.update_plugins {servers?, readyup: {version: "latest", bundle: "default"|"skins"}}, host.updates_hold {mode}. Disruptive ones are refused during a match unless force {reason} is given.',
    inputSchema: {
      hostId: z.string(),
      type: z.enum([
        'server.start',
        'server.stop',
        'server.restart',
        'server.create',
        'server.remove',
        'server.enroll',
        'host.update_game',
        'host.update_plugins',
        'host.updates_hold',
      ]),
      payload: z.record(z.unknown()).optional(),
      force: z.object({ reason: z.string().min(1).max(500) }).optional(),
    },
    annotations: destructive,
  },
  async ({ hostId, type, payload, force }) =>
    call(() =>
      api.send('POST', `/api/fleet/hosts/${enc(hostId)}/commands`, {
        type,
        payload: payload ?? {},
        ...(force ? { force } : {}),
      })
    )
);

server.registerTool(
  'server_plugins',
  {
    title: "Set a server's Ready Up plugins",
    description:
      'Put a fleet server (id from servers or machines) on a plugin preset: tournament (matches), practice, fun, tryout (skin tryout server), or a custom list.',
    inputSchema: {
      serverId: z.string(),
      preset: z.enum(['tournament', 'practice', 'fun', 'tryout', 'custom']),
      plugins: z.array(z.string()).optional(),
    },
    annotations: write,
  },
  async ({ serverId, preset, plugins }) =>
    call(() =>
      api.send('POST', `/api/fleet/servers/${enc(serverId)}/plugins`, {
        preset,
        ...(plugins ? { plugins } : {}),
      })
    )
);

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
  async ({ method, path, body }) =>
    call(() => {
      // The platform refuses these from a token too; say why, in words the model acts on.
      if (path.startsWith('/api/license'))
        throw new Error(
          'Refused: only an admin changes the license, in Manage -> License. Tell the admin what is needed instead.'
        );
      return api.send(method, path, body);
    })
);

await server.connect(new StdioServerTransport());
