#!/usr/bin/env tsx
/**
 * Automated upgrade test (Phase E prep).
 *
 * Proves that upgrading an existing install to the current build keeps the
 * data, automatically, without a human doing a manual pg_dump/restore dance
 * (which is how PR #293 and PR #290 verified their migrations by hand).
 *
 * What it does:
 *   1. Starts a fresh Postgres and the released OLD_IMAGE.
 *   2. Seeds real data through THAT version's own API: players, teams, a
 *      single-elimination tournament played to completion (ratings + stats),
 *      two auth-identity "sign-ins", and a settings change.
 *   3. Snapshots what the API returns.
 *   4. Stops the old container, builds the current checkout into an image,
 *      and starts it against the SAME Postgres data.
 *   5. Asserts: the hand-written migrations ran (and are idempotent), the API
 *      returns the same data as before the upgrade, and booting twice more
 *      changes nothing. CS2's tables were renamed in place: cs2_servers,
 *      cs2_maps and cs2_map_pools hold exactly the rows servers, maps and
 *      map_pools held (read from Postgres before and after), the rows that
 *      point into them still do, the old names are gone, CS2's 001-tables
 *      migration is recorded, and running the handover again does nothing.
 *   6. Repeats the boot-and-check step (minus the seeding) against a second,
 *      completely empty database, so the same script covers both paths, and
 *      checks that CS2's tables there have the same columns, indexes,
 *      constraints, sequences and keys as on the upgraded one.
 *
 * Usage:
 *   yarn test:upgrade
 *
 * Requires Docker. Pulls OLD_IMAGE from Docker Hub and builds the current
 * checkout with `docker build -f docker/Dockerfile .` (same as CI's E2E
 * image build). Containers, volumes and the network(s) they use are always
 * removed on exit, including on failure.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { request as pwRequest, type APIRequestContext } from '@playwright/test';

// Bump this when a newer released version becomes the "known upgradeable
// from" baseline.
const OLD_IMAGE = 'sivertio/matchzy-auto-tournament:2.4.15';

const NEW_IMAGE_TAG = 'matchzy-tournament:upgrade-test';
const RUN_ID = `${Date.now()}`;
const NETWORK = `mat-upgrade-net-${RUN_ID}`;
const POSTGRES_NAME = `mat-upgrade-pg-${RUN_ID}`;
const APP_NAME = `mat-upgrade-app-${RUN_ID}`;
const HOST_PORT = process.env.UPGRADE_TEST_PORT ?? '31370';
const BASE_URL = `http://localhost:${HOST_PORT}`;
const SERVER_TOKEN = 'upgrade-test-server-token-0123456789';
const SESSION_SECRET = 'upgrade-test-session-secret-0123456789';
const DB_NAME = 'matchzy_tournament';
const DB_USER = 'postgres';
const DB_PASSWORD = 'postgres';

// Skip the (slow) docker build and reuse an image already built/tagged with
// this name — handy for iterating on the seeding/assertion logic locally.
const SKIP_BUILD = process.env.UPGRADE_TEST_SKIP_BUILD === '1';

let step = '(not started)';

function log(msg: string) {
  console.log(`[upgrade-test] ${msg}`);
}

function sh(cmd: string, args: string[], opts: { quiet?: boolean } = {}): string {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    if (!opts.quiet) {
      const e = err as { stdout?: string; stderr?: string; message?: string };
      log(`command failed: ${cmd} ${args.join(' ')}`);
      if (e.stdout) log(`stdout: ${e.stdout}`);
      if (e.stderr) log(`stderr: ${e.stderr}`);
    }
    throw err;
  }
}

function shQuiet(cmd: string, args: string[]) {
  try {
    execFileSync(cmd, args, { stdio: 'ignore' });
  } catch {
    // best effort
  }
}

/**
 * For commands that can produce a lot of output (the Docker build in
 * particular: `yarn install --verbose` inside it logs every file it
 * unpacks). Streams straight to this process's stdio instead of buffering it
 * in memory — buffering that much through `execFileSync`'s pipe overflowed
 * Node's default buffer and failed with ENOBUFS rather than a real build
 * error.
 */
function shStream(cmd: string, args: string[]) {
  const result = spawnSync(cmd, args, { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(
      `command failed (exit ${result.status ?? result.signal}): ${cmd} ${args.join(' ')}`
    );
  }
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(
  description: string,
  check: () => Promise<boolean>,
  { timeoutMs = 90_000, intervalMs = 2_000 } = {}
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      if (await check()) {
        return;
      }
    } catch (err) {
      lastError = err;
    }
    await sleep(intervalMs);
  }
  const suffix = lastError ? ` Last error: ${String(lastError)}` : '';
  throw new Error(`Timed out waiting for: ${description}.${suffix}`);
}

// ---------------------------------------------------------------------------
// Docker orchestration
// ---------------------------------------------------------------------------

function buildCurrentImage() {
  if (SKIP_BUILD) {
    log(`UPGRADE_TEST_SKIP_BUILD=1: reusing existing ${NEW_IMAGE_TAG} image`);
    return;
  }
  step = 'build current image';
  log(`Building current checkout as ${NEW_IMAGE_TAG} ...`);
  shStream('docker', [
    'build',
    '-f',
    'docker/Dockerfile',
    '-t',
    NEW_IMAGE_TAG,
    '--build-arg',
    'VITE_ENABLE_DEV_PAGE=true',
    '.',
  ]);
}

function createNetwork(name: string) {
  step = `create network (${name})`;
  sh('docker', ['network', 'create', name]);
}

function startPostgres(name: string, network: string) {
  step = `start postgres (${name})`;
  log(`Starting Postgres container ${name} ...`);
  sh('docker', [
    'run',
    '-d',
    '--name',
    name,
    '--network',
    network,
    '-e',
    `POSTGRES_USER=${DB_USER}`,
    '-e',
    `POSTGRES_PASSWORD=${DB_PASSWORD}`,
    '-e',
    `POSTGRES_DB=${DB_NAME}`,
    'postgres:16-alpine',
  ]);
}

async function waitForPostgres(name: string) {
  await waitFor(`Postgres (${name}) to be ready`, async () => {
    try {
      sh('docker', ['exec', name, 'pg_isready', '-U', DB_USER], { quiet: true });
      return true;
    } catch {
      return false;
    }
  });
}

function runApp(image: string, network: string, postgresName: string) {
  step = `start app (${image})`;
  log(`Starting ${image} against ${postgresName} ...`);
  sh('docker', [
    'run',
    '-d',
    '--name',
    APP_NAME,
    '--network',
    network,
    '-p',
    `${HOST_PORT}:3069`,
    '-e',
    'NODE_ENV=production',
    '-e',
    'PORT=3000',
    '-e',
    `DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@${postgresName}:5432/${DB_NAME}`,
    '-e',
    `FRONTEND_BASE_URL=${BASE_URL}`,
    '-e',
    `SESSION_SECRET=${SESSION_SECRET}`,
    '-e',
    `SERVER_TOKEN=${SERVER_TOKEN}`,
    '-e',
    'ENABLE_TEST_ENDPOINTS=true',
    '-e',
    'GAMES_ENRICH=off',
    '-e',
    'STEAM_API_KEY=',
    '-e',
    'LOG_LEVEL=info',
    image,
  ]);
}

function removeApp() {
  step = 'remove app container';
  shQuiet('docker', ['rm', '-f', APP_NAME]);
}

async function waitForAppHealthy() {
  await waitFor(`${BASE_URL}/health to answer`, async () => {
    try {
      const res = await globalThis.fetch(`${BASE_URL}/health`);
      return res.ok;
    } catch {
      return false;
    }
  });
}

function containerLogs(name: string, tail = 200): string {
  try {
    return sh('docker', ['logs', '--tail', String(tail), name], { quiet: true });
  } catch {
    return '(logs unavailable)';
  }
}

// ---------------------------------------------------------------------------
// Seeding + snapshotting via the API (real HTTP, same as a browser/bot would)
// ---------------------------------------------------------------------------

const REAL_STEAM_IDS = [
  '76561197960287930',
  '76561198013825972',
  '76561198067146383',
  '76561198021466528',
];

interface SeedResult {
  team1Id: string;
  team2Id: string;
  team1Players: string[];
  team2Players: string[];
  matchSlug: string;
  tournamentName: string;
}

async function loginAdmin(ctx: APIRequestContext) {
  const res = await ctx.post('/api/test/login-admin', { data: {} });
  if (!res.ok()) {
    throw new Error(`login-admin failed: ${res.status()} ${await res.text()}`);
  }
}

async function seed(ctx: APIRequestContext): Promise<SeedResult> {
  step = 'seed data';
  await loginAdmin(ctx);

  const stamp = Date.now();
  const tournamentName = `Upgrade Test Tournament ${stamp}`;

  // Two teams, two players each, real-looking Steam ids (so they can be
  // resolved through the same identity path a signed-in player would use).
  const team1Id = `upgrade-a-${stamp}`;
  const team2Id = `upgrade-b-${stamp}`;
  const team1Players = [REAL_STEAM_IDS[0], REAL_STEAM_IDS[1]];
  const team2Players = [REAL_STEAM_IDS[2], REAL_STEAM_IDS[3]];

  const createTeam = async (id: string, name: string, steamIds: string[]) => {
    const res = await ctx.post('/api/teams', {
      data: {
        id,
        name,
        players: steamIds.map((steamId, i) => ({ steamId, name: `${name} Player ${i + 1}` })),
      },
    });
    if (!res.ok()) {
      throw new Error(`creating team ${id} failed: ${res.status()} ${await res.text()}`);
    }
  };
  await createTeam(team1Id, `Upgrade Team A ${stamp}`, team1Players);
  await createTeam(team2Id, `Upgrade Team B ${stamp}`, team2Players);

  // A fake (0.0.0.0) server so tournament start's RCON preflight passes without
  // a real CS2 server.
  const serverId = `upgrade-server-${stamp}`;
  const serverRes = await ctx.post('/api/servers', {
    data: {
      id: serverId,
      name: `Upgrade Server ${stamp}`,
      host: '0.0.0.0',
      port: 27015,
      password: 'upgrade-test',
      enabled: true,
    },
  });
  if (!serverRes.ok()) {
    throw new Error(`creating server failed: ${serverRes.status()} ${await serverRes.text()}`);
  }

  // Settings: seed a distinctive, checkable value.
  const settingsRes = await ctx.put('/api/settings', {
    data: { webhookUrl: BASE_URL },
  });
  if (!settingsRes.ok()) {
    throw new Error(`setting webhookUrl failed: ${settingsRes.status()} ${await settingsRes.text()}`);
  }

  // Sign-ins: link two of the players to external auth providers, the way a
  // real Discord/GitHub sign-in would (test-only helper; no OAuth required).
  for (const [provider, steamId] of [
    ['discord', team1Players[0]],
    ['github', team2Players[0]],
  ] as const) {
    const res = await ctx.post('/api/test/auth-identities', {
      data: { provider, providerUserId: `${provider}-${steamId}`, steamId },
    });
    if (!res.ok()) {
      throw new Error(`seeding ${provider} sign-in failed: ${res.status()} ${await res.text()}`);
    }
  }

  // Tournament: create, start, then play the single match to completion via
  // the real MatchZy event-ingest path (same as tests/api/series-stats.spec.ts
  // and tests/api/swapped-team-player-stats.spec.ts).
  await ctx.delete('/api/tournament').catch(() => undefined);
  const tournamentRes = await ctx.post('/api/tournament', {
    data: {
      name: tournamentName,
      type: 'single_elimination',
      format: 'bo1',
      maps: ['de_dust2'],
      teamIds: [team1Id, team2Id],
    },
  });
  if (!tournamentRes.ok()) {
    throw new Error(`creating tournament failed: ${tournamentRes.status()} ${await tournamentRes.text()}`);
  }

  const startRes = await ctx.post('/api/tournament/start', { data: {} });
  if (!startRes.ok()) {
    throw new Error(`starting tournament failed: ${startRes.status()} ${await startRes.text()}`);
  }

  let matchSlug = '';
  await waitFor(
    'the single match to be allocated',
    async () => {
      const res = await ctx.get('/api/matches');
      if (!res.ok()) return false;
      const body = (await res.json()) as {
        matches?: Array<{ slug: string; team1?: { id: string }; team2?: { id: string } }>;
      };
      const match = (body.matches ?? []).find(
        (m) =>
          (m.team1?.id === team1Id && m.team2?.id === team2Id) ||
          (m.team1?.id === team2Id && m.team2?.id === team1Id)
      );
      if (match) {
        matchSlug = match.slug;
        return true;
      }
      return false;
    },
    { timeoutMs: 30_000, intervalMs: 1_000 }
  );

  const serverHeaders = { 'Content-Type': 'application/json', 'X-MatchZy-Token': SERVER_TOKEN };
  const playerBlock = (steamIds: string[], kills: number, damage: number) => ({
    players: steamIds.map((steamId, i) => ({
      steamid: steamId,
      name: `Player ${i + 1}`,
      stats: { kills, deaths: 5, assists: 2, damage, rounds_played: 16, kast: 70 },
    })),
  });

  const roundEnd = await ctx.post(`/api/events/${matchSlug}`, {
    headers: serverHeaders,
    data: {
      event: 'round_end',
      matchid: matchSlug,
      map_number: 0,
      round_number: 16,
      winner: 'team1',
      team1_score: 13,
      team2_score: 3,
      team1: playerBlock(team1Players, 18, 1800),
      team2: playerBlock(team2Players, 6, 600),
    },
  });
  if (!roundEnd.ok()) {
    throw new Error(`round_end rejected: ${roundEnd.status()} ${await roundEnd.text()}`);
  }

  const seriesEnd = await ctx.post(`/api/events/${matchSlug}`, {
    headers: serverHeaders,
    data: {
      event: 'series_end',
      matchid: matchSlug,
      team1_series_score: 1,
      team2_series_score: 0,
      winner: 'team1',
      num_maps: 1,
      time_until_restore: 0,
    },
  });
  if (!seriesEnd.ok()) {
    throw new Error(`series_end rejected: ${seriesEnd.status()} ${await seriesEnd.text()}`);
  }

  await waitFor(
    'the tournament to complete',
    async () => {
      const res = await ctx.get('/api/tournament');
      if (!res.ok()) return false;
      const body = (await res.json()) as { tournament?: { status?: string } };
      return body.tournament?.status === 'completed';
    },
    { timeoutMs: 30_000, intervalMs: 1_000 }
  );

  return { team1Id, team2Id, team1Players, team2Players, matchSlug, tournamentName };
}

/** Deterministic snapshot of everything the seed step wrote, read back purely through the API. */
async function snapshot(ctx: APIRequestContext, seeded: SeedResult) {
  await loginAdmin(ctx);

  const playersRes = await ctx.get('/api/players');
  const playersBody = (await playersRes.json()) as {
    players?: Array<{ id: string; name: string; currentElo: number; startingElo: number }>;
  };
  const seededIds = new Set([...seeded.team1Players, ...seeded.team2Players]);
  const players = (playersBody.players ?? [])
    .filter((p) => seededIds.has(p.id))
    .map((p) => ({ id: p.id, name: p.name, currentElo: p.currentElo, startingElo: p.startingElo }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const teamsRes = await ctx.get('/api/teams');
  const teamsBody = (await teamsRes.json()) as {
    teams?: Array<{ id: string; name: string; players: Array<{ steamId: string }> }>;
  };
  const teams = (teamsBody.teams ?? [])
    .filter((t) => t.id === seeded.team1Id || t.id === seeded.team2Id)
    .map((t) => ({
      id: t.id,
      name: t.name,
      playerIds: t.players.map((p) => p.steamId).sort(),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const tournamentRes = await ctx.get('/api/tournament');
  const tournamentBody = (await tournamentRes.json()) as {
    tournament?: {
      name?: string;
      type?: string;
      format?: string;
      status?: string;
      game?: string;
      winner?: { id: string } | null;
    };
  };
  const t = tournamentBody.tournament;
  const tournament = t && {
    name: t.name,
    type: t.type,
    format: t.format,
    status: t.status,
    game: t.game,
    winnerId: t.winner?.id ?? null,
  };

  const matchesRes = await ctx.get('/api/matches');
  const matchesBody = (await matchesRes.json()) as {
    matches?: Array<{
      slug: string;
      status: string;
      winner?: { id: string } | null;
      team1?: { id: string } | null;
      team2?: { id: string } | null;
    }>;
  };
  const seededMatch = (matchesBody.matches ?? []).find((m) => m.slug === seeded.matchSlug);
  const match = seededMatch && {
    slug: seededMatch.slug,
    status: seededMatch.status,
    winnerId: seededMatch.winner?.id ?? null,
    team1Id: seededMatch.team1?.id ?? null,
    team2Id: seededMatch.team2?.id ?? null,
  };

  const settingsRes = await ctx.get('/api/settings');
  const settingsBody = (await settingsRes.json()) as { settings?: { webhookUrl?: string } };
  const settings = { webhookUrl: settingsBody.settings?.webhookUrl };

  const perPlayer: Record<
    string,
    {
      ratingHistory: Array<{
        match_slug: string | null;
        elo_before: number;
        elo_after: number;
        elo_change: number;
        match_result: string;
      }>;
      stats: {
        kills: number;
        deaths: number;
        assists: number;
        total_damage: number;
        won_match: boolean;
      } | null;
    }
  > = {};

  for (const steamId of [...seeded.team1Players, ...seeded.team2Players].sort()) {
    const historyRes = await ctx.get(`/api/players/${steamId}/rating-history`);
    const historyBody = (await historyRes.json()) as {
      history?: Array<{
        match_slug: string | null;
        elo_before: number;
        elo_after: number;
        elo_change: number;
        match_result: string;
      }>;
    };
    const ratingHistory = (historyBody.history ?? [])
      .filter((h) => h.match_slug === seeded.matchSlug)
      .map((h) => ({
        match_slug: h.match_slug,
        elo_before: h.elo_before,
        elo_after: h.elo_after,
        elo_change: h.elo_change,
        match_result: h.match_result,
      }));

    const summaryRes = await ctx.get(`/api/players/${steamId}/summary`);
    const summaryBody = (await summaryRes.json()) as {
      matches?: Array<{
        slug?: string;
        match_slug?: string;
        kills: number;
        deaths: number;
        assists: number;
        total_damage: number;
        won_match: boolean;
      }>;
    };
    const row = (summaryBody.matches ?? []).find(
      (m) => (m.match_slug ?? m.slug) === seeded.matchSlug
    );
    const stats = row
      ? {
          kills: row.kills,
          deaths: row.deaths,
          assists: row.assists,
          total_damage: row.total_damage,
          won_match: row.won_match,
        }
      : null;

    perPlayer[steamId] = { ratingHistory, stats };
  }

  return { players, teams, tournament, match, settings, perPlayer };
}

type Snapshot = Awaited<ReturnType<typeof snapshot>>;

function assertEqual(label: string, before: Snapshot, after: Snapshot) {
  const a = JSON.stringify(before, Object.keys(before).sort());
  const b = JSON.stringify(after, Object.keys(after).sort());
  if (a !== b) {
    throw new Error(
      `${label}: snapshots differ.\n--- before ---\n${JSON.stringify(before, null, 2)}\n--- after ---\n${JSON.stringify(after, null, 2)}`
    );
  }
  log(`${label}: snapshots match.`);
}

// ---------------------------------------------------------------------------
// Migration assertions (generic: reads the same ledger PR #293 introduced)
// ---------------------------------------------------------------------------

async function assertMigrationsApplied(ctx: APIRequestContext): Promise<string[]> {
  const res = await ctx.get('/api/test/schema-migrations');
  if (!res.ok()) {
    throw new Error(`GET /api/test/schema-migrations failed: ${res.status()} ${await res.text()}`);
  }
  const body = (await res.json()) as { applied?: string[] };
  const applied = body.applied ?? [];
  if (applied.length === 0) {
    throw new Error('Expected at least one hand-written migration to have run on boot, got none.');
  }
  log(`Migrations applied and recorded: ${applied.join(', ')}`);
  return applied;
}

async function assertMigrationsAreNoOpNow(ctx: APIRequestContext) {
  const res = await ctx.post('/api/test/schema-migrations/run', { data: {} });
  if (!res.ok()) {
    throw new Error(
      `POST /api/test/schema-migrations/run failed: ${res.status()} ${await res.text()}`
    );
  }
  const body = (await res.json()) as { applied?: string[] };
  if ((body.applied ?? []).length !== 0) {
    throw new Error(
      `Re-running the migrations applied more work: ${JSON.stringify(body.applied)}. They must be idempotent.`
    );
  }
  log('Re-running schema migrations applied nothing (idempotent).');
}

// ---------------------------------------------------------------------------
// CS2's tables (DESIGN-modules §6 item 10): 2.x's servers, maps and map_pools
// become cs2_servers, cs2_maps and cs2_map_pools, renamed in place by
// api/src/config/cs2TableHandover.ts. Rows are read straight from Postgres,
// so the check does not depend on either version's API shape.
// ---------------------------------------------------------------------------

/** One JSON value from a query run inside the Postgres container. */
function psqlJson<T>(postgresName: string, sql: string): T {
  const out = sh('docker', [
    'exec',
    postgresName,
    'psql',
    '-U',
    DB_USER,
    '-d',
    DB_NAME,
    '-At',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    sql,
  ]).trim();
  return JSON.parse(out) as T;
}

function psqlExec(postgresName: string, sql: string) {
  sh('docker', [
    'exec',
    postgresName,
    'psql',
    '-U',
    DB_USER,
    '-d',
    DB_NAME,
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    sql,
  ]);
}

interface Cs2TableNames {
  servers: string;
  maps: string;
  map_pools: string;
}

const LEGACY_CS2_TABLE_NAMES: Cs2TableNames = {
  servers: 'servers',
  maps: 'maps',
  map_pools: 'map_pools',
};
const CS2_TABLE_NAMES: Cs2TableNames = {
  servers: 'cs2_servers',
  maps: 'cs2_maps',
  map_pools: 'cs2_map_pools',
};

const UPGRADE_POOL_NAME = 'Upgrade Test Pool';
const UPGRADE_TEMPLATE_NAME = 'Upgrade Test Template';

/**
 * On the OLD version's database: a custom map pool (an id the pools sequence
 * handed out for the host, not only the seeded ones) and a tournament
 * template that references it, so core's key from tournament_templates onto
 * the pools table is exercised by real rows.
 */
function seedCs2Rows(postgresName: string) {
  step = 'seed CS2 rows on the old database';
  psqlExec(
    postgresName,
    `INSERT INTO map_pools (name, map_ids, is_default, enabled)
       VALUES ('${UPGRADE_POOL_NAME}', '["de_dust2","de_mirage"]', 0, 1);
     INSERT INTO tournament_templates (name, type, format, settings, map_pool_id)
       SELECT '${UPGRADE_TEMPLATE_NAME}', 'single_elimination', 'bo1', '{}', id
         FROM map_pools WHERE name = '${UPGRADE_POOL_NAME}';`
  );
}

/**
 * The rows of CS2's three tables, in the columns neither version rewrites on
 * its own (status, last_seen and updated_at move with the health monitor),
 * plus the core rows that point into them.
 */
function cs2Rows(postgresName: string, names: Cs2TableNames) {
  const agg = (select: string, order: string) =>
    psqlJson<unknown[]>(
      postgresName,
      `SELECT COALESCE(json_agg(t ORDER BY ${order}), '[]'::json) FROM (${select}) t`
    );
  return {
    servers: agg(
      `SELECT id, name, host, port, password, enabled, created_at FROM ${names.servers}`,
      'id'
    ),
    maps: agg(`SELECT id, display_name, image_url, created_at FROM ${names.maps}`, 'id'),
    mapPools: agg(
      `SELECT id, name, map_ids, is_default, enabled, created_at FROM ${names.map_pools}`,
      'id'
    ),
    templates: agg(
      `SELECT t.name, t.map_pool_id, p.name AS pool_name
         FROM tournament_templates t LEFT JOIN ${names.map_pools} p ON p.id = t.map_pool_id`,
      'name'
    ),
    matchServers: agg('SELECT slug, server_id FROM matches', 'slug'),
  };
}

type Cs2Rows = ReturnType<typeof cs2Rows>;

function assertCs2RowsSurvived(label: string, before: Cs2Rows, after: Cs2Rows) {
  const a = JSON.stringify(before);
  const b = JSON.stringify(after);
  if (a !== b) {
    throw new Error(
      `${label}: CS2 rows differ.\n--- before ---\n${JSON.stringify(before, null, 2)}\n--- after ---\n${JSON.stringify(after, null, 2)}`
    );
  }
  if (before.servers.length === 0 || before.maps.length === 0 || before.mapPools.length === 0) {
    throw new Error(`${label}: expected the old database to have servers, maps and map pools.`);
  }
  log(
    `${label}: ${before.servers.length} server(s), ${before.maps.length} map(s), ` +
      `${before.mapPools.length} map pool(s) and the rows pointing at them survived unchanged.`
  );
}

interface Cs2TablesView {
  tables: Record<string, boolean>;
  legacyTables: Record<string, boolean>;
  ledger: Array<{ id: string; checksum: string }>;
  firstMigration: { id: string; checksum: string } | null;
  state: { status: string; applied: string[]; reason?: string } | null;
  schema: { tables: Record<string, unknown>; foreignKeys: unknown[] };
}

interface Cs2HandoverReport {
  renamed: unknown[];
  renamedObjects: unknown[];
  columnsAdded: unknown[];
  recorded: boolean;
  conflicts: unknown[];
  pending: unknown[];
}

/**
 * After boot: the three cs2_* tables exist, the 2.x names are gone, CS2's
 * first migration is recorded (with the checksum of the SQL CS2 ships), the
 * module is ok, and running the handover again does nothing. Returns the
 * schema, so the fresh-database path can be compared with it.
 */
async function assertCs2TablesHandedOver(ctx: APIRequestContext, label: string) {
  const res = await ctx.get('/api/test/cs2-tables');
  if (!res.ok()) {
    throw new Error(`GET /api/test/cs2-tables failed: ${res.status()} ${await res.text()}`);
  }
  const view = (await res.json()) as Cs2TablesView;
  for (const name of Object.values(CS2_TABLE_NAMES)) {
    if (!view.tables[name]) throw new Error(`${label}: ${name} does not exist.`);
  }
  for (const name of Object.values(LEGACY_CS2_TABLE_NAMES)) {
    if (view.legacyTables[name]) throw new Error(`${label}: the old table ${name} is still there.`);
  }
  if (view.firstMigration?.id !== '001-tables') {
    throw new Error(
      `${label}: CS2 declares no 001-tables migration: ${JSON.stringify(view.firstMigration)}`
    );
  }
  if (JSON.stringify(view.ledger) !== JSON.stringify([view.firstMigration])) {
    throw new Error(
      `${label}: CS2's ledger is ${JSON.stringify(view.ledger)}, expected ${JSON.stringify([view.firstMigration])}.`
    );
  }
  if (view.state?.status !== 'ok') {
    throw new Error(`${label}: the CS2 module is not ok: ${JSON.stringify(view.state)}`);
  }

  const again = await ctx.post('/api/test/cs2-tables/handover', { data: {} });
  if (!again.ok()) {
    throw new Error(
      `POST /api/test/cs2-tables/handover failed: ${again.status()} ${await again.text()}`
    );
  }
  const { report } = (await again.json()) as { report: Cs2HandoverReport };
  const changed =
    report.renamed.length +
    report.renamedObjects.length +
    report.columnsAdded.length +
    report.conflicts.length +
    report.pending.length;
  if (changed > 0 || report.recorded) {
    throw new Error(
      `${label}: running the CS2 handover again did something: ${JSON.stringify(report)}`
    );
  }
  log(
    `${label}: cs2_servers, cs2_maps and cs2_map_pools in place, old names gone, ` +
      '001-tables recorded, handover idempotent.'
  );
  return view.schema;
}

function assertSameCs2Schema(label: string, expected: unknown, actual: unknown) {
  const a = JSON.stringify(expected);
  const b = JSON.stringify(actual);
  if (a !== b) {
    throw new Error(
      `${label}: CS2's tables differ.\n--- upgraded ---\n${JSON.stringify(expected, null, 2)}\n--- this database ---\n${JSON.stringify(actual, null, 2)}`
    );
  }
  log(`${label}: same CS2 columns, indexes, constraints, sequences and keys as the upgraded database.`);
}

/** Set by path 1, compared against by the reboots and by path 2. */
let upgradedCs2Schema: unknown = null;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function runUpgradedDatabasePath() {
  log('=== Path 1: upgrading an existing 1x/2x database ===');
  createNetwork(NETWORK);
  startPostgres(POSTGRES_NAME, NETWORK);
  await waitForPostgres(POSTGRES_NAME);

  runApp(OLD_IMAGE, NETWORK, POSTGRES_NAME);
  await waitForAppHealthy();

  const ctx = await pwRequest.newContext({ baseURL: BASE_URL });
  try {
    const seeded = await seed(ctx);
    const before = await snapshot(ctx, seeded);
    seedCs2Rows(POSTGRES_NAME);
    const cs2Before = cs2Rows(POSTGRES_NAME, LEGACY_CS2_TABLE_NAMES);
    log(`Seeded and snapshotted data on ${OLD_IMAGE}.`);

    step = 'stop old container';
    removeApp();

    runApp(NEW_IMAGE_TAG, NETWORK, POSTGRES_NAME);
    await waitForAppHealthy();

    step = 'verify migrations ran';
    const appliedFirstBoot = await assertMigrationsApplied(ctx);
    await assertMigrationsAreNoOpNow(ctx);

    step = 'verify data survived the upgrade';
    const afterUpgrade = await snapshot(ctx, seeded);
    assertEqual('Upgrade (old -> current build)', before, afterUpgrade);

    step = 'verify CS2 took over its tables';
    upgradedCs2Schema = await assertCs2TablesHandedOver(ctx, 'Upgrade');
    const cs2AfterUpgrade = cs2Rows(POSTGRES_NAME, CS2_TABLE_NAMES);
    assertCs2RowsSurvived('Upgrade (old -> current build)', cs2Before, cs2AfterUpgrade);

    // Boot twice more: nothing should change, and no new migration should
    // ever be (re-)applied.
    for (let boot = 2; boot <= 3; boot++) {
      step = `reboot #${boot}`;
      removeApp();
      runApp(NEW_IMAGE_TAG, NETWORK, POSTGRES_NAME);
      await waitForAppHealthy();

      const applied = await assertMigrationsApplied(ctx);
      if (JSON.stringify(applied) !== JSON.stringify(appliedFirstBoot)) {
        throw new Error(
          `Boot #${boot} recorded different migrations than boot #1: ${JSON.stringify(applied)} vs ${JSON.stringify(appliedFirstBoot)}`
        );
      }
      await assertMigrationsAreNoOpNow(ctx);

      const snap = await snapshot(ctx, seeded);
      assertEqual(`Reboot #${boot}`, afterUpgrade, snap);
      const schema = await assertCs2TablesHandedOver(ctx, `Reboot #${boot}`);
      assertSameCs2Schema(`Reboot #${boot}`, upgradedCs2Schema, schema);
      assertCs2RowsSurvived(
        `Reboot #${boot}`,
        cs2AfterUpgrade,
        cs2Rows(POSTGRES_NAME, CS2_TABLE_NAMES)
      );
    }

    log('Path 1 (upgrade) passed: migrations ran once, data survived, reboots changed nothing.');
  } finally {
    await ctx.dispose();
    // Path 2 reuses APP_NAME (on its own network/database) — remove this
    // path's app container so its name is free, and drop the rest of this
    // path's resources rather than leaving them running until final cleanup.
    step = 'tear down path 1 resources';
    shQuiet('docker', ['rm', '-f', APP_NAME]);
    shQuiet('docker', ['rm', '-f', POSTGRES_NAME]);
    shQuiet('docker', ['network', 'rm', NETWORK]);
  }
}

async function runFreshDatabasePath() {
  log('=== Path 2: booting the current build on a fresh, empty database ===');
  const freshNetwork = `${NETWORK}-fresh`;
  const freshPg = `${POSTGRES_NAME}-fresh`;
  createNetwork(freshNetwork);
  try {
    startPostgres(freshPg, freshNetwork);
    await waitForPostgres(freshPg);

    runApp(NEW_IMAGE_TAG, freshNetwork, freshPg);
    await waitForAppHealthy();

    const ctx = await pwRequest.newContext({ baseURL: BASE_URL });
    try {
      step = 'sign in on the fresh database';
      await loginAdmin(ctx);

      step = 'verify migrations ran on a fresh database';
      await assertMigrationsApplied(ctx);
      await assertMigrationsAreNoOpNow(ctx);

      step = 'verify CS2 created its tables on a fresh database';
      const freshCs2Schema = await assertCs2TablesHandedOver(ctx, 'Fresh database');
      if (!upgradedCs2Schema) throw new Error('Path 1 did not record the upgraded CS2 schema.');
      assertSameCs2Schema('Fresh database', upgradedCs2Schema, freshCs2Schema);

      step = 'verify a fresh database starts empty';
      const playersRes = await ctx.get('/api/players');
      const playersBody = (await playersRes.json()) as { players?: unknown[] };
      const playerCount = (playersBody.players ?? []).length;
      // login-admin itself creates exactly one (admin) player row.
      if (playerCount > 1) {
        throw new Error(`Expected a fresh database to have at most the admin player, got ${playerCount}.`);
      }
      const teamsRes = await ctx.get('/api/teams');
      const teamsBody = (await teamsRes.json()) as { teams?: unknown[] };
      if ((teamsBody.teams ?? []).length !== 0) {
        throw new Error('Expected a fresh database to have no teams.');
      }
      const tournamentRes = await ctx.get('/api/tournament');
      const tournamentBody = (await tournamentRes.json()) as { tournament?: unknown };
      if (tournamentBody.tournament) {
        throw new Error('Expected a fresh database to have no tournament.');
      }

      log('Path 2 (fresh database) passed: migrations ran, and the app boots clean and empty.');
    } finally {
      await ctx.dispose();
    }
  } finally {
    shQuiet('docker', ['rm', '-f', APP_NAME]);
    shQuiet('docker', ['rm', '-f', freshPg]);
    shQuiet('docker', ['network', 'rm', freshNetwork]);
  }
}

async function cleanup() {
  log('Cleaning up containers, volumes and network...');
  shQuiet('docker', ['rm', '-f', APP_NAME]);
  shQuiet('docker', ['rm', '-f', POSTGRES_NAME]);
  shQuiet('docker', ['rm', '-f', `${POSTGRES_NAME}-fresh`]);
  shQuiet('docker', ['network', 'rm', NETWORK]);
  shQuiet('docker', ['network', 'rm', `${NETWORK}-fresh`]);
}

async function main() {
  const start = Date.now();
  try {
    buildCurrentImage();
    await runUpgradedDatabasePath();
    await runFreshDatabasePath();
    const seconds = Math.round((Date.now() - start) / 1000);
    log(`All good. Total time: ${seconds}s.`);
  } catch (err) {
    log(`FAILED at step "${step}": ${(err as Error).message}`);
    log(`--- app container logs (${APP_NAME}) ---`);
    log(containerLogs(APP_NAME));
    log(`--- postgres container logs (${POSTGRES_NAME}) ---`);
    log(containerLogs(POSTGRES_NAME));
    process.exitCode = 1;
  } finally {
    await cleanup();
  }
}

void main();
