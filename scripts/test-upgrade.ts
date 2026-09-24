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
 *      CS2's tournament columns (the tournament's maps, map sequence, max
 *      rounds and overtime; a template's map pool and maps) were folded into
 *      CS2's own settings object, `settings.cs2`, with the same values, and
 *      the columns are gone; the API still returns the 2.x fields.
 *      The database itself was renamed too: 2.4.15 keeps its data in
 *      `matchzy_tournament`, 3.0 in `auto_tournament`. Before the successful
 *      start, the new build is started three times in states where it must
 *      refuse to rename and exit, and each is checked to have changed nothing:
 *      configured with the old name, with another session connected to the
 *      old database (which must still be connected afterwards), and as a role
 *      without the right to rename it. Then the real start renames it in
 *      place, and every check above reads the data back from
 *      `auto_tournament`. The plugin names 2.4.15 stored (`matchzy_*`
 *      settings keys, the `cvars` of stored match configs, the `matchzy_*`
 *      columns of the servers table) read back under `at_*` with the same
 *      values.
 *   6. Repeats the boot-and-check step (minus the seeding) against a second,
 *      completely empty database, so the same script covers both paths, and
 *      checks that CS2's tables there have the same columns, indexes,
 *      constraints, sequences and keys as on the upgraded one. An empty
 *      `matchzy_tournament` sits beside it: with both names present the new
 *      build must log an error, leave both alone and use `auto_tournament`.
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

const NEW_IMAGE_TAG = 'auto-tournament:upgrade-test';
const RUN_ID = `${Date.now()}`;
const NETWORK = `mat-upgrade-net-${RUN_ID}`;
const POSTGRES_NAME = `mat-upgrade-pg-${RUN_ID}`;
const APP_NAME = `mat-upgrade-app-${RUN_ID}`;
const HOST_PORT = process.env.UPGRADE_TEST_PORT ?? '31370';
const BASE_URL = `http://localhost:${HOST_PORT}`;
const SERVER_TOKEN = 'upgrade-test-server-token-0123456789';
const SESSION_SECRET = 'upgrade-test-session-secret-0123456789';
/** 2.4.15's database name, and the name 3.0 renames it to on first start. */
const OLD_DB_NAME = 'matchzy_tournament';
const DB_NAME = 'auto_tournament';
const DB_USER = 'postgres';
const DB_PASSWORD = 'postgres';
/** The header 2.4.15 reads the server token from (3.0: X-Auto-Tournament-Token). */
const OLD_TOKEN_HEADER = 'X-MatchZy-Token';
const UPGRADE_CHAT_PREFIX = 'UPGRADE';
const UPGRADE_FFW_TIME = 123;
/** The seeded tournament's max rounds: not the default 24. */
const UPGRADE_MAX_ROUNDS = 16;

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

function startPostgres(name: string, network: string, database: string) {
  step = `start postgres (${name})`;
  log(`Starting Postgres container ${name} (database ${database}) ...`);
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
    `POSTGRES_DB=${database}`,
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

interface AppDatabase {
  database?: string;
  user?: string;
  password?: string;
}

function runApp(
  image: string,
  network: string,
  postgresName: string,
  { database = DB_NAME, user = DB_USER, password = DB_PASSWORD }: AppDatabase = {}
) {
  step = `start app (${image})`;
  log(`Starting ${image} against ${postgresName} (database ${database}, role ${user}) ...`);
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
    `DATABASE_URL=postgresql://${user}:${password}@${postgresName}:5432/${database}`,
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

/**
 * Everything a container wrote, stdout and stderr together, with JSON-escaped
 * quotes unescaped (the production logger may write a line as JSON).
 */
function containerOutput(name: string): string {
  const result = spawnSync('docker', ['logs', name], { encoding: 'utf8' });
  return `${result.stdout ?? ''}${result.stderr ?? ''}`.replace(/\\"/g, '"');
}

/** Wait for a container to exit by itself; returns its exit code. */
async function waitForExit(name: string, timeoutMs = 90_000): Promise<number> {
  let exitCode = -1;
  await waitFor(
    `${name} to exit`,
    async () => {
      const state = sh('docker', ['inspect', '-f', '{{.State.Status}} {{.State.ExitCode}}', name], {
        quiet: true,
      }).trim();
      const [status, code] = state.split(' ');
      if (status !== 'exited' && status !== 'dead') return false;
      exitCode = Number(code);
      return true;
    },
    { timeoutMs, intervalMs: 1_000 }
  );
  return exitCode;
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

  // Plugin settings, under 2.4.15's names: stored as matchzy_* keys, which
  // 3.0 reads back as at_* (checked in pluginSettingsOf).
  const pluginSettingsRes = await ctx.put('/api/settings', {
    data: { matchzyChatPrefix: UPGRADE_CHAT_PREFIX, matchzyFfwTime: UPGRADE_FFW_TIME },
  });
  if (!pluginSettingsRes.ok()) {
    throw new Error(
      `setting the plugin settings failed: ${pluginSettingsRes.status()} ${await pluginSettingsRes.text()}`
    );
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
  // the real event-ingest path (same as tests/api/series-stats.spec.ts
  // and tests/api/swapped-team-player-stats.spec.ts).
  await ctx.delete('/api/tournament').catch(() => undefined);
  // Round rules other than the defaults, so the fold of the CS2 columns into
  // settings.cs2 is checked on values that could not come from a default.
  const tournamentRes = await ctx.post('/api/tournament', {
    data: {
      name: tournamentName,
      type: 'single_elimination',
      format: 'bo1',
      maps: ['de_dust2'],
      teamIds: [team1Id, team2Id],
      maxRounds: UPGRADE_MAX_ROUNDS,
      overtimeMode: 'disabled',
      overtimeSegments: 0,
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

  // 2.4.15 reads the server token from its old header name.
  const serverHeaders = { 'Content-Type': 'application/json', [OLD_TOKEN_HEADER]: SERVER_TOKEN };
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
async function snapshot(
  ctx: APIRequestContext,
  seeded: SeedResult,
  apiVersion: 'old' | 'new' = 'new'
) {
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
      maps?: string[];
      maxRounds?: number;
      overtimeMode?: string;
      overtimeSegments?: number;
    };
  };
  const t = tournamentBody.tournament;
  // The CS2 fields are 2.4.15's columns and 3.0's settings.cs2: the API
  // returns them at the top level either way.
  const tournament = t && {
    name: t.name,
    type: t.type,
    format: t.format,
    status: t.status,
    game: t.game,
    winnerId: t.winner?.id ?? null,
    maps: t.maps ?? null,
    maxRounds: t.maxRounds ?? null,
    overtimeMode: t.overtimeMode ?? null,
    overtimeSegments: t.overtimeSegments ?? null,
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
  const settingsBody = (await settingsRes.json()) as {
    settings?: Record<string, unknown> & { webhookUrl?: string };
  };
  // The plugin settings under each version's own field names: 2.4.15 answers
  // matchzyChatPrefix, 3.0 atChatPrefix. Each is read strictly by its own name.
  const prefix = apiVersion === 'old' ? 'matchzy' : 'at';
  const settings = {
    webhookUrl: settingsBody.settings?.webhookUrl,
    pluginChatPrefix: settingsBody.settings?.[`${prefix}ChatPrefix`],
    pluginFfwTime: settingsBody.settings?.[`${prefix}FfwTime`],
  };

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
function psqlJson<T>(postgresName: string, sql: string, database = DB_NAME): T {
  const out = sh('docker', [
    'exec',
    postgresName,
    'psql',
    '-U',
    DB_USER,
    '-d',
    database,
    '-At',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    sql,
  ]).trim();
  return JSON.parse(out) as T;
}

function psqlExec(postgresName: string, sql: string, database = DB_NAME) {
  sh('docker', [
    'exec',
    postgresName,
    'psql',
    '-U',
    DB_USER,
    '-d',
    database,
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

/** Where a version keeps CS2's rows: its database, tables and plugin columns. */
interface Cs2Layout {
  database: string;
  tables: Cs2TableNames;
  /** Prefix of the plugin's columns on the servers table. */
  pluginColumns: 'matchzy_' | 'at_';
  /**
   * Where the tournament's and templates' CS2 fields are: 2.4.15's columns, or
   * 3.0's `settings.cs2` object.
   */
  tournamentFields: 'columns' | 'settings';
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

const LEGACY_CS2_LAYOUT: Cs2Layout = {
  database: OLD_DB_NAME,
  tables: LEGACY_CS2_TABLE_NAMES,
  pluginColumns: 'matchzy_',
  tournamentFields: 'columns',
};
const CS2_LAYOUT: Cs2Layout = {
  database: DB_NAME,
  tables: CS2_TABLE_NAMES,
  pluginColumns: 'at_',
  tournamentFields: 'settings',
};

const UPGRADE_SERVER_PLUGIN_CONFIG = '{"chatPrefix":"UPG","minimumReadyRequired":3}';

const UPGRADE_POOL_NAME = 'Upgrade Test Pool';
const UPGRADE_TEMPLATE_NAME = 'Upgrade Test Template';

/**
 * On the OLD version's database: a custom map pool (an id the pools sequence
 * handed out for the host, not only the seeded ones), a tournament template
 * that references it and lists maps, and one with neither, so the template
 * columns 3.0 folds into settings.cs2 hold real values. And values in the
 * servers table's matchzy_* columns, which 3.0 renames to at_*.
 */
function seedCs2Rows(postgresName: string) {
  step = 'seed CS2 rows on the old database';
  psqlExec(
    postgresName,
    `INSERT INTO map_pools (name, map_ids, is_default, enabled)
       VALUES ('${UPGRADE_POOL_NAME}', '["de_dust2","de_mirage"]', 0, 1);
     INSERT INTO tournament_templates (name, type, format, settings, map_pool_id, maps)
       SELECT '${UPGRADE_TEMPLATE_NAME}', 'single_elimination', 'bo1', '{"matchFormat":"bo1"}', id,
              '["de_dust2","de_mirage"]'
         FROM map_pools WHERE name = '${UPGRADE_POOL_NAME}';
     INSERT INTO tournament_templates (name, type, format, settings)
       VALUES ('${UPGRADE_TEMPLATE_NAME} (no pool)', 'swiss', 'bo3', '{}');
     UPDATE servers
        SET matchzy_config = '${UPGRADE_SERVER_PLUGIN_CONFIG}',
            matchzy_db_type = 'sqlite',
            matchzy_db_error = 'upgrade-test error text';`,
    OLD_DB_NAME
  );
}

/**
 * The rows of CS2's three tables, in the columns neither version rewrites on
 * its own (status, last_seen and updated_at move with the health monitor),
 * plus the core rows that point into them.
 */
function cs2Rows(postgresName: string, layout: Cs2Layout) {
  const names = layout.tables;
  const p = layout.pluginColumns;
  const agg = (select: string, order: string) =>
    psqlJson<unknown[]>(
      postgresName,
      `SELECT COALESCE(json_agg(t ORDER BY ${order}), '[]'::json) FROM (${select}) t`,
      layout.database
    );
  return {
    servers: agg(
      `SELECT id, name, host, port, password, enabled, created_at,
              ${p}config AS plugin_config, ${p}db_type AS plugin_db_type,
              ${p}db_error AS plugin_db_error
         FROM ${names.servers}`,
      'id'
    ),
    maps: agg(`SELECT id, display_name, image_url, created_at FROM ${names.maps}`, 'id'),
    mapPools: agg(
      `SELECT id, name, map_ids, is_default, enabled, created_at FROM ${names.map_pools}`,
      'id'
    ),
    templates: agg(
      layout.tournamentFields === 'columns'
        ? `SELECT t.name, t.map_pool_id, p.name AS pool_name, t.maps::json AS maps
             FROM tournament_templates t LEFT JOIN ${names.map_pools} p ON p.id = t.map_pool_id`
        : `SELECT t.name, (t.settings::json #>> '{cs2,mapPoolId}')::int AS map_pool_id,
                  p.name AS pool_name, t.settings::json #> '{cs2,maps}' AS maps
             FROM tournament_templates t
             LEFT JOIN ${names.map_pools} p ON p.id = (t.settings::json #>> '{cs2,mapPoolId}')::int`,
      'name'
    ),
    tournaments: agg(
      layout.tournamentFields === 'columns'
        ? `SELECT id, maps::json AS maps, map_sequence::json AS map_sequence, max_rounds,
                  overtime_mode, overtime_segments
             FROM tournament`
        : `SELECT id, settings::json #> '{cs2,maps}' AS maps,
                  settings::json #> '{cs2,mapSequence}' AS map_sequence,
                  (settings::json #>> '{cs2,maxRounds}')::int AS max_rounds,
                  settings::json #>> '{cs2,overtimeMode}' AS overtime_mode,
                  (settings::json #>> '{cs2,overtimeSegments}')::int AS overtime_segments
             FROM tournament`,
      'id'
    ),
    matchServers: agg('SELECT slug, server_id FROM matches', 'slug'),
  };
}

/** The 2.x CS2 columns of core's tables, which the upgrade folds into settings.cs2. */
const LEGACY_CS2_TOURNAMENT_COLUMNS = [
  'tournament.maps',
  'tournament.map_sequence',
  'tournament.max_rounds',
  'tournament.overtime_mode',
  'tournament.overtime_segments',
  'tournament_templates.map_pool_id',
  'tournament_templates.maps',
];

/** Which of those columns a database still has. */
function legacyCs2TournamentColumns(postgresName: string, database = DB_NAME): string[] {
  return psqlJson<string[]>(
    postgresName,
    `SELECT COALESCE(json_agg(table_name || '.' || column_name ORDER BY table_name, column_name), '[]'::json)
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name || '.' || column_name IN (${LEGACY_CS2_TOURNAMENT_COLUMNS.map((c) => `'${c}'`).join(', ')})`,
    database
  );
}

function assertCs2TournamentColumnsGone(label: string, postgresName: string) {
  const left = legacyCs2TournamentColumns(postgresName);
  if (left.length > 0) {
    throw new Error(`${label}: core still has CS2 columns: ${left.join(', ')}`);
  }
  log(`${label}: core's tournament tables hold no CS2 columns.`);
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
  const seeded = before.tournaments as Array<{ max_rounds: number | null; maps: unknown }>;
  if (seeded.length !== 1 || seeded[0].max_rounds !== UPGRADE_MAX_ROUNDS) {
    throw new Error(
      `${label}: expected the seeded tournament with max rounds ${UPGRADE_MAX_ROUNDS}: ${JSON.stringify(seeded)}`
    );
  }
  if (before.templates.length < 2) {
    throw new Error(`${label}: expected the two seeded templates: ${JSON.stringify(before.templates)}`);
  }
  log(
    `${label}: ${before.servers.length} server(s), ${before.maps.length} map(s), ` +
      `${before.mapPools.length} map pool(s), the rows pointing at them, and the tournament's ` +
      `and ${before.templates.length} template(s)' CS2 fields (now settings.cs2) survived unchanged.`
  );
}

interface Cs2TablesView {
  tables: Record<string, boolean>;
  legacyTables: Record<string, boolean>;
  ledger: Array<{ id: string; checksum: string }>;
  firstMigration: { id: string; checksum: string } | null;
  declared: Array<{ id: string; checksum: string }>;
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
  // Every migration CS2 declares is recorded, with the checksum of its SQL:
  // 001-tables adopted by the handover, the later ones run by CS2's runner.
  if (JSON.stringify(view.ledger) !== JSON.stringify(view.declared)) {
    throw new Error(
      `${label}: CS2's ledger is ${JSON.stringify(view.ledger)}, expected ${JSON.stringify(view.declared)}.`
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
      `${view.declared.map((m) => m.id).join(', ')} recorded, handover idempotent.`
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
// The plugin names 2.4.15 stored (settings keys, match config cvars), and the
// database rename (api/src/config/databaseRename.ts)
// ---------------------------------------------------------------------------

const LEGACY_PLUGIN_PREFIX = 'matchzy_';
const PLUGIN_PREFIX = 'at_';

/** `matchzy_x` → `at_x`; anything else unchanged. */
function toNewPluginName(name: string): string {
  return name.startsWith(LEGACY_PLUGIN_PREFIX)
    ? PLUGIN_PREFIX + name.slice(LEGACY_PLUGIN_PREFIX.length)
    : name;
}

interface PluginNames {
  settings: Array<{ key: string; value: string | null }>;
  matchConfigs: Array<{ slug: string; config: string }>;
}

function pluginNamesIn(postgresName: string, database: string): PluginNames {
  return {
    settings: psqlJson(
      postgresName,
      `SELECT COALESCE(json_agg(t ORDER BY t.key), '[]'::json)
         FROM (SELECT key, value FROM app_settings
                WHERE starts_with(key, '${LEGACY_PLUGIN_PREFIX}')
                   OR starts_with(key, '${PLUGIN_PREFIX}')) t`,
      database
    ),
    matchConfigs: psqlJson(
      postgresName,
      `SELECT COALESCE(json_agg(t ORDER BY t.slug), '[]'::json)
         FROM (SELECT slug, config FROM matches) t`,
      database
    ),
  };
}

/**
 * Every setting and match config 2.4.15 stored under a matchzy_* name is
 * there under the at_* name with the same value, no matchzy_* name is left,
 * and nothing else in a stored config changed.
 */
function assertPluginNamesRenamed(label: string, before: PluginNames, after: PluginNames) {
  const legacySettings = before.settings.filter((s) => s.key.startsWith(LEGACY_PLUGIN_PREFIX));
  if (legacySettings.length === 0) {
    throw new Error(`${label}: 2.4.15 stored no matchzy_* settings; the seed did not take.`);
  }
  const afterByKey = new Map(after.settings.map((s) => [s.key, s.value]));
  for (const { key, value } of legacySettings) {
    const newKey = toNewPluginName(key);
    if (!afterByKey.has(newKey) || afterByKey.get(newKey) !== value) {
      throw new Error(
        `${label}: setting ${key}=${JSON.stringify(value)} did not become ${newKey} ` +
          `(found ${JSON.stringify(afterByKey.get(newKey))}).`
      );
    }
  }
  const leftOver = after.settings.filter((s) => s.key.startsWith(LEGACY_PLUGIN_PREFIX));
  if (leftOver.length > 0) {
    throw new Error(`${label}: settings still under a 2.x name: ${JSON.stringify(leftOver)}`);
  }

  const withLegacyCvars = before.matchConfigs.filter((m) =>
    m.config.includes(`"${LEGACY_PLUGIN_PREFIX}`)
  );
  if (withLegacyCvars.length === 0) {
    throw new Error(`${label}: 2.4.15 stored no match config with matchzy_* cvars.`);
  }
  const afterBySlug = new Map(after.matchConfigs.map((m) => [m.slug, m.config]));
  for (const { slug, config } of before.matchConfigs) {
    const old = JSON.parse(config) as { cvars?: Record<string, unknown> };
    const expected = {
      ...old,
      ...(old.cvars
        ? {
            cvars: Object.fromEntries(
              Object.entries(old.cvars).map(([k, v]) => [toNewPluginName(k), v])
            ),
          }
        : {}),
    };
    const actualText = afterBySlug.get(slug);
    if (actualText === undefined) throw new Error(`${label}: match ${slug} is gone.`);
    if (actualText.includes(`"${LEGACY_PLUGIN_PREFIX}`)) {
      throw new Error(`${label}: match ${slug}'s stored config still has matchzy_* names.`);
    }
    if (JSON.stringify(JSON.parse(actualText)) !== JSON.stringify(expected)) {
      throw new Error(
        `${label}: match ${slug}'s stored config changed beyond the rename.\n` +
          `--- expected ---\n${JSON.stringify(expected, null, 2)}\n--- found ---\n${actualText}`
      );
    }
  }
  log(
    `${label}: ${legacySettings.length} setting(s) and ${withLegacyCvars.length} stored match ` +
      'config(s) read back under at_* names with the same values.'
  );
}

/** The databases in the cluster that carry either name. */
function platformDatabases(postgresName: string): string[] {
  return psqlJson<string[]>(
    postgresName,
    `SELECT COALESCE(json_agg(datname ORDER BY datname), '[]'::json)
       FROM pg_database WHERE datname IN ('${OLD_DB_NAME}', '${DB_NAME}')`,
    'postgres'
  );
}

function assertDatabases(label: string, postgresName: string, expected: string[]) {
  const actual = platformDatabases(postgresName);
  if (JSON.stringify(actual) !== JSON.stringify([...expected].sort())) {
    throw new Error(`${label}: databases are ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}.`);
  }
}

/**
 * Start the new build in a state where it must refuse to rename the database:
 * it must exit by itself, say why, and leave both database names as they were.
 */
async function assertRefusedToStart(
  label: string,
  postgresName: string,
  appDatabase: AppDatabase,
  expectedInLogs: string
) {
  step = `refused start: ${label}`;
  removeApp();
  const databasesBefore = platformDatabases(postgresName);
  runApp(NEW_IMAGE_TAG, NETWORK, postgresName, appDatabase);
  const exitCode = await waitForExit(APP_NAME);
  const output = containerOutput(APP_NAME);
  if (exitCode === 0) {
    throw new Error(`${label}: the new build exited 0 instead of refusing.\n${output}`);
  }
  if (!output.includes(expectedInLogs)) {
    throw new Error(`${label}: the logs do not say ${JSON.stringify(expectedInLogs)}.\n${output}`);
  }
  assertDatabases(label, postgresName, databasesBefore);
  removeApp();
  log(`${label}: refused to start (exit ${exitCode}), said why, changed nothing.`);
}

const HOLDER_APP_NAME = 'upgrade-test-holder';

/** Keep a session connected to the old database, as a still-running 2.x would. */
async function holdOldDatabase(postgresName: string) {
  step = 'connect a session to the old database';
  sh('docker', [
    'exec',
    '-d',
    '-e',
    `PGAPPNAME=${HOLDER_APP_NAME}`,
    postgresName,
    'psql',
    '-U',
    DB_USER,
    '-d',
    OLD_DB_NAME,
    '-c',
    'SELECT pg_sleep(600)',
  ]);
  await waitFor('the holder session to connect', async () => holderSessions(postgresName) > 0, {
    timeoutMs: 30_000,
    intervalMs: 500,
  });
}

function holderSessions(postgresName: string): number {
  return psqlJson<number>(
    postgresName,
    `SELECT COUNT(*) FROM pg_stat_activity
      WHERE datname = '${OLD_DB_NAME}' AND application_name = '${HOLDER_APP_NAME}'`,
    'postgres'
  );
}

/** The test ends its own holder session; the platform never does. */
function releaseOldDatabase(postgresName: string) {
  psqlJson<unknown>(
    postgresName,
    `SELECT COALESCE(json_agg(pg_terminate_backend(pid)), '[]'::json) FROM pg_stat_activity
      WHERE datname = '${OLD_DB_NAME}' AND application_name = '${HOLDER_APP_NAME}'`,
    'postgres'
  );
}

const LIMITED_ROLE = 'upgrade_test_limited';
const LIMITED_PASSWORD = 'limited';

/**
 * The three states in which the new build must refuse to rename the 2.4.15
 * database, each checked to change nothing. Runs with the old app stopped.
 */
async function assertRenameRefusals(postgresName: string) {
  // DB_NAME still set to the 2.x name, as in a .env copied from 2.x's example.
  await assertRefusedToStart(
    'Configured with the old database name',
    postgresName,
    { database: OLD_DB_NAME },
    'its 2.x name'
  );

  // Something else is connected to the old database. It must still be
  // connected afterwards: the platform never terminates a connection.
  await holdOldDatabase(postgresName);
  await assertRefusedToStart(
    'Another session connected to the old database',
    postgresName,
    {},
    'other session(s) are connected to it'
  );
  if (holderSessions(postgresName) !== 1) {
    throw new Error('The session connected to the old database was closed by the platform.');
  }
  releaseOldDatabase(postgresName);
  await waitFor('the holder session to go', async () => holderSessions(postgresName) === 0, {
    timeoutMs: 30_000,
    intervalMs: 500,
  });

  // A role that may connect but may not rename the database.
  psqlExec(
    postgresName,
    `CREATE ROLE ${LIMITED_ROLE} LOGIN PASSWORD '${LIMITED_PASSWORD}' NOCREATEDB NOSUPERUSER`,
    'postgres'
  );
  await assertRefusedToStart(
    'A role without the right to rename',
    postgresName,
    { user: LIMITED_ROLE, password: LIMITED_PASSWORD },
    `ALTER DATABASE ${OLD_DB_NAME} RENAME TO ${DB_NAME};`
  );
  psqlExec(postgresName, `DROP ROLE ${LIMITED_ROLE}`, 'postgres');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function runUpgradedDatabasePath() {
  log('=== Path 1: upgrading an existing 1x/2x database ===');
  createNetwork(NETWORK);
  // 2.4.15's compose file created its database under the 2.x name.
  startPostgres(POSTGRES_NAME, NETWORK, OLD_DB_NAME);
  await waitForPostgres(POSTGRES_NAME);

  runApp(OLD_IMAGE, NETWORK, POSTGRES_NAME, { database: OLD_DB_NAME });
  await waitForAppHealthy();

  const ctx = await pwRequest.newContext({ baseURL: BASE_URL });
  try {
    const seeded = await seed(ctx);
    const before = await snapshot(ctx, seeded, 'old');
    seedCs2Rows(POSTGRES_NAME);
    const cs2Before = cs2Rows(POSTGRES_NAME, LEGACY_CS2_LAYOUT);
    const pluginNamesBefore = pluginNamesIn(POSTGRES_NAME, OLD_DB_NAME);
    log(`Seeded and snapshotted data on ${OLD_IMAGE}.`);

    step = 'stop old container';
    removeApp();

    step = 'verify the new build refuses to rename when it must not';
    await assertRenameRefusals(POSTGRES_NAME);

    step = 'start the new build; it renames the database';
    runApp(NEW_IMAGE_TAG, NETWORK, POSTGRES_NAME);
    await waitForAppHealthy();
    assertDatabases('Upgrade', POSTGRES_NAME, [DB_NAME]);
    if (!containerOutput(APP_NAME).includes(`Renamed the 2.x database "${OLD_DB_NAME}"`)) {
      throw new Error('The new build did not log the database rename.');
    }
    log(`Upgrade: ${OLD_DB_NAME} renamed to ${DB_NAME} in place.`);

    step = 'verify migrations ran';
    const appliedFirstBoot = await assertMigrationsApplied(ctx);
    await assertMigrationsAreNoOpNow(ctx);

    step = 'verify data survived the upgrade';
    const afterUpgrade = await snapshot(ctx, seeded);
    assertEqual('Upgrade (old -> current build)', before, afterUpgrade);

    step = 'verify CS2 took over its tables';
    upgradedCs2Schema = await assertCs2TablesHandedOver(ctx, 'Upgrade');
    const cs2AfterUpgrade = cs2Rows(POSTGRES_NAME, CS2_LAYOUT);
    assertCs2RowsSurvived('Upgrade (old -> current build)', cs2Before, cs2AfterUpgrade);
    if (!appliedFirstBoot.includes('2026-09-24-cs2-tournament-settings')) {
      throw new Error('The fold of the CS2 tournament columns did not run on the upgrade.');
    }
    assertCs2TournamentColumnsGone('Upgrade', POSTGRES_NAME);

    step = 'verify the stored plugin names were renamed';
    const pluginNamesAfter = pluginNamesIn(POSTGRES_NAME, DB_NAME);
    assertPluginNamesRenamed('Upgrade (old -> current build)', pluginNamesBefore, pluginNamesAfter);

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
      assertCs2RowsSurvived(`Reboot #${boot}`, cs2AfterUpgrade, cs2Rows(POSTGRES_NAME, CS2_LAYOUT));
      assertCs2TournamentColumnsGone(`Reboot #${boot}`, POSTGRES_NAME);
      assertDatabases(`Reboot #${boot}`, POSTGRES_NAME, [DB_NAME]);
      if (
        JSON.stringify(pluginNamesIn(POSTGRES_NAME, DB_NAME)) !== JSON.stringify(pluginNamesAfter)
      ) {
        throw new Error(`Reboot #${boot}: the stored plugin names changed again.`);
      }
    }

    log(
      'Path 1 (upgrade) passed: database renamed in place (refused when it must), migrations ' +
        'ran once, data survived, reboots changed nothing.'
    );
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
    startPostgres(freshPg, freshNetwork, DB_NAME);
    await waitForPostgres(freshPg);
    // An empty database under the 2.x name beside it: with both names there,
    // the new build must log an error, touch neither, and use the new one.
    psqlExec(freshPg, `CREATE DATABASE ${OLD_DB_NAME}`, 'postgres');

    runApp(NEW_IMAGE_TAG, freshNetwork, freshPg);
    await waitForAppHealthy();

    step = 'verify both database names were left alone';
    assertDatabases('Fresh database beside an old one', freshPg, [OLD_DB_NAME, DB_NAME]);
    if (!containerOutput(APP_NAME).includes(`Both "${OLD_DB_NAME}" and "${DB_NAME}" exist`)) {
      throw new Error('With both database names present, the new build did not log the error.');
    }
    const oldTables = psqlJson<number>(
      freshPg,
      "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public'",
      OLD_DB_NAME
    );
    if (oldTables !== 0) {
      throw new Error(`The new build wrote ${oldTables} table(s) into ${OLD_DB_NAME}.`);
    }
    log(`Fresh database: with ${OLD_DB_NAME} beside it, logged the error and used ${DB_NAME}.`);

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
      assertCs2TournamentColumnsGone('Fresh database', freshPg);

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
